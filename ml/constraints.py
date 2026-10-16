"""
Constraint prediction — the model that writes the rules.

THE PROBLEM IT SOLVES

The rule proposer is a bank of regexes. When one matches a clause it drafts a
constraint; when none matches, the clause lands in a pile of 5,253 that a human
has to read and formalise by hand. That pile is the bottleneck in the whole
project — it is the reason the corpus has zero approved clauses and the engine
can decide nothing for anyone.

A regex fails because it does not recognise the PHRASING. It says nothing about
whether the clause is formalisable. "Applicant must be a woman farmer owning not
more than 2 hectares" is perfectly checkable; no pattern happened to match it.

So: learn the structure from the clauses where a pattern did match, and predict
it for the ones where none did.

WHAT IS PREDICTED

Three heads, all supervised by constraints the proposer already produced:

  fields     which of the 11 profile fields the clause tests   (multi-label)
  operators  which comparison operators it uses                (multi-label)
  exclusion  whether the clause DISQUALIFIES rather than qualifies  (binary)

Structure only. The values — 18, 2 hectares, "telangana" — come from the
existing numeric and lexicon parsers, which are good at values and bad at
recognising phrasing. This splits the job along the line where each side is
strong.

WHAT IT DOES NOT DO

It does not decide eligibility, and a predicted constraint is not a decisive
one. The output is a DRAFT placed in front of a named reviewer, who approves,
corrects or rejects it — exactly the gate every regex-proposed constraint
already passes through. The model shortens the queue; it does not shorten the
review.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix, hstack
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, f1_score
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.multiclass import OneVsRestClassifier
from sklearn.preprocessing import MaxAbsScaler

from triage import CUES, SEED, build_frame, structural_features

ROOT = Path(__file__).resolve().parents[1]
CLAUSES = ROOT / 'data' / 'annotations' / 'clauses.json'

PROFILE_FIELDS = [
    'age', 'annual_income_inr', 'occupation', 'land_acres', 'state',
    'residence', 'gender', 'category', 'education_stage', 'special_categories',
    'dependents',
]

OPERATORS = ['lt', 'lte', 'gt', 'gte', 'eq', 'neq', 'contains_any', 'contains_all', 'in', 'not_in']


# ------------------------------------------------------------------ labels

def walk(node, fields: set[str], ops: set[str]) -> None:
    """Collect every field and operator anywhere in a constraint expression."""
    if not isinstance(node, dict):
        return
    kind = node.get('kind')
    if kind == 'predicate':
        if node.get('field'):
            fields.add(node['field'])
        if node.get('op'):
            ops.add(node['op'])
    elif kind in ('all', 'any'):
        for child in node.get('children', []):
            walk(child, fields, ops)
    elif kind == 'exclusion':
        walk(node.get('child'), fields, ops)


def labels_of(constraint) -> tuple[set[str], set[str], int]:
    fields: set[str] = set()
    ops: set[str] = set()
    walk(constraint, fields, ops)
    # An exclusion at the root is the clause saying "this disqualifies you".
    # Getting that backwards inverts the meaning of the rule, so it is its own
    # prediction rather than something inferred from the fields.
    is_exclusion = int(isinstance(constraint, dict) and constraint.get('kind') == 'exclusion')
    return fields, ops, is_exclusion


# ------------------------------------------------------------------ dataset

def build() -> tuple[pd.DataFrame, pd.DataFrame]:
    """Returns (labelled, unlabelled) — clauses with a constraint, and without."""
    base = build_frame()  # text, group, structural + cue features
    raw = {c['id']: c for c in json.loads(CLAUSES.read_text(encoding='utf-8'))}

    rows = []
    for _, r in base.iterrows():
        c = raw[r['id']]
        constraint = c.get('constraint')
        row = dict(r)
        row['has_constraint'] = constraint is not None
        if constraint:
            fields, ops, excl = labels_of(constraint)
            for f in PROFILE_FIELDS:
                row[f'f_{f}'] = int(f in fields)
            for o in OPERATORS:
                row[f'o_{o}'] = int(o in ops)
            row['is_exclusion'] = excl
        rows.append(row)

    df = pd.DataFrame(rows)
    return df[df.has_constraint].reset_index(drop=True), df[~df.has_constraint].reset_index(drop=True)


def featurise(train_text, all_df, numeric_cols):
    word = TfidfVectorizer(analyzer='word', ngram_range=(1, 2), min_df=2,
                           max_features=40_000, sublinear_tf=True).fit(train_text)
    char = TfidfVectorizer(analyzer='char_wb', ngram_range=(3, 5), min_df=3,
                           max_features=40_000, sublinear_tf=True).fit(train_text)
    scaler = MaxAbsScaler().fit(all_df[numeric_cols].to_numpy(dtype=float))

    def tx(sub):
        return hstack([
            word.transform(sub.text),
            char.transform(sub.text),
            csr_matrix(scaler.transform(sub[numeric_cols].to_numpy(dtype=float))),
        ]).tocsr()

    return tx, (word, char, scaler)


def make_model(single: bool = False):
    if single:
        # A single binary label is not a multi-label problem; OneVsRest returns a
        # 1-D vector here and the assignment below would fail.
        return LogisticRegression(C=4.0, class_weight='balanced', max_iter=2000)

    # One-vs-rest logistic regression. Linear models are the right family for
    # high-dimensional sparse text, they give calibrated probabilities (which the
    # reviewer UI needs to order drafts by confidence), and each label's
    # coefficients can be read to see which phrases drove it.
    return OneVsRestClassifier(
        LogisticRegression(C=4.0, class_weight='balanced', max_iter=2000),
        n_jobs=-1,
    )


def evaluate(df: pd.DataFrame, target_cols: list[str], title: str, numeric_cols) -> dict:
    y = df[target_cols].to_numpy()
    groups = df.group.to_numpy()
    # Stratify on a coarse signature of the label set so rare combinations are
    # spread across folds rather than landing in one.
    strat = y.sum(axis=1).clip(0, 3)

    single = len(target_cols) == 1
    if single:
        y = y.ravel()
        strat = y

    cv = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=SEED)
    preds = np.zeros_like(y)

    for tr, te in cv.split(df, strat, groups):
        tx, _ = featurise(df.text.iloc[tr], df, numeric_cols)
        model = make_model(single).fit(tx(df.iloc[tr]), y[tr])
        preds[te] = model.predict(tx(df.iloc[te]))

    micro = f1_score(y, preds, average='micro', zero_division=0)
    macro = f1_score(y, preds, average='macro', zero_division=0)
    # Subset accuracy: the whole label set exactly right. Harsh, and the number
    # that matters for a draft a reviewer can accept without editing.
    exact = float((preds == y).mean()) if single else float((preds == y).all(axis=1).mean())

    print(f'\n{"=" * 68}\n{title}\n{"=" * 68}')
    print(f'micro-F1 {micro:.3f} · macro-F1 {macro:.3f} · exact-set match {exact:.3f}\n')
    names = None if single else [c.split('_', 1)[1] for c in target_cols]
    print(classification_report(y, preds, target_names=names, zero_division=0, digits=3))

    return {'micro_f1': float(micro), 'macro_f1': float(macro), 'exact_match': exact}


def main() -> None:
    labelled, unlabelled = build()
    numeric_cols = list(structural_features('x', 0, 1).keys()) + list(CUES.keys())

    print(f'{len(labelled):,} clauses with a proposer-drafted constraint  (training signal)')
    print(f'{len(unlabelled):,} clauses with none                          (the bottleneck)')
    print(f'{labelled.group.nunique():,} dedup groups among the labelled set')

    field_cols = [f'f_{f}' for f in PROFILE_FIELDS]
    op_cols = [f'o_{o}' for o in OPERATORS]

    # Drop labels that never occur — a column of zeros is not a prediction task.
    field_cols = [c for c in field_cols if labelled[c].sum() > 0]
    op_cols = [c for c in op_cols if labelled[c].sum() > 0]

    print('\nfield frequencies:')
    print(labelled[field_cols].sum().sort_values(ascending=False).to_string())
    print(f'\nexclusion clauses: {int(labelled.is_exclusion.sum()):,} '
          f'({labelled.is_exclusion.mean():.1%})')

    results = {
        'fields': evaluate(labelled, field_cols, 'FIELDS — which profile fields the clause tests', numeric_cols),
        'operators': evaluate(labelled, op_cols, 'OPERATORS — which comparisons it uses', numeric_cols),
        'exclusion': evaluate(labelled, ['is_exclusion'], 'EXCLUSION — does the clause disqualify', numeric_cols),
    }

    out = Path(__file__).resolve().parent / 'constraint_results.json'
    out.write_text(json.dumps({
        'seed': SEED,
        'n_labelled': int(len(labelled)),
        'n_unlabelled': int(len(unlabelled)),
        'field_cols': field_cols,
        'op_cols': op_cols,
        'results': results,
    }, indent=2), encoding='utf-8')
    print(f'\nwrote {out.name}')


if __name__ == '__main__':
    main()
