"""
Clause triage: what kind of work does each eligibility clause need?

WHAT THIS IS, AND WHAT IT IS NOT

It is not an eligibility model. Nothing here decides whether a citizen qualifies
for anything — that is the rule engine's job, and it only ever acts on clauses a
named human reviewer has approved. This model never touches a verdict.

It is a triage model for the annotation backlog. 11,551 clauses were extracted
from 2,066 scheme documents, and each one needs a different kind of human
attention: some already have a machine-checkable constraint proposed and only
need confirming, some need a constraint written by hand, some need a profile
field the schema does not have yet, and some are not checkable by any machine
and need marking as such. Predicting which is which is a genuine supervised
problem with 11,551 labelled examples.

THE CIRCULARITY, STATED UP FRONT

The labels were assigned by the rule-based proposer in `src/annotations/`, not
by humans. So a model trained on them learns THE PROPOSER'S RULES, not ground
truth about clauses. This is distillation, and it has to be described as such.

That is still worth doing, for two reasons. Where the tree agrees with the
proposer using features the proposer does not look at, the labels have structure
beyond the regexes — the categories are real, not artefacts. Where it disagrees,
those clauses are worth a human's eye first. The experiment below is designed
around that: Model A deliberately uses only structural features the proposer
never inspects.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.dummy import DummyClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import classification_report, confusion_matrix, f1_score
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.tree import DecisionTreeClassifier, export_text

SEED = 20260915
ROOT = Path(__file__).resolve().parents[1]
CLAUSES = ROOT / 'data' / 'annotations' / 'clauses.json'

# ------------------------------------------------------------------ labels

def label_of(clause: dict) -> str:
    """
    Four classes, because the three annotation states hide the most useful
    distinction.

    `proposed` covers both "a constraint was produced" and "no pattern matched",
    and those need completely different human work — confirming a draft versus
    writing one from nothing. Splitting them also takes the majority class from
    87% to 44%, which makes the problem worth modelling at all.
    """
    state = clause['annotation_state']
    if state == 'proposed':
        return 'machine_checkable' if clause.get('constraint') else 'no_pattern'
    return state  # needs_schema_extension | not_machine_checkable


# ------------------------------------------------- Model A: structural only

NUM_RE = re.compile(r'\d')
YEAR_RE = re.compile(r'\b(19|20)\d{2}\b')

def structural_features(text: str, position: int, total_in_scheme: int) -> dict:
    """
    Shape, not vocabulary.

    Every feature here is something the rule proposer never inspects: it matches
    on words and number patterns, not on how long a sentence is or where it sits
    in the document. If a tree built only from these predicts the proposer's
    labels well above chance, the classes reflect something real about the
    clauses rather than just the regexes that produced them.
    """
    words = text.split()
    n_words = len(words) or 1
    return {
        'n_chars': len(text),
        'n_words': n_words,
        'avg_word_len': sum(len(w) for w in words) / n_words,
        'n_commas': text.count(','),
        'n_semicolons': text.count(';'),
        'n_parens': text.count('('),
        'n_slashes': text.count('/'),
        'n_digits': len(NUM_RE.findall(text)),
        'digit_density': len(NUM_RE.findall(text)) / max(len(text), 1),
        'n_uppercase_words': sum(1 for w in words if w.isupper() and len(w) > 1),
        'ends_with_colon': int(text.rstrip().endswith(':')),
        'starts_upper': int(bool(text[:1].isupper())),
        'has_year': int(bool(YEAR_RE.search(text))),
        # Position. Eligibility sections tend to open with the hard criteria and
        # trail off into procedural notes, so where a clause sits carries signal.
        'position': position,
        'position_frac': position / max(total_in_scheme, 1),
        'clauses_in_scheme': total_in_scheme,
    }


# --------------------------------------- Model B: structural + readable cues

# Deliberately plain-English cues a reviewer would recognise on sight. These DO
# overlap with what the proposer looks for; Model B is the practical model,
# Model A is the honest one.
CUES = {
    'cue_age': r'\b(age|aged|years? old|व(र्ष|य)|ఏళ్ల)\b',
    'cue_income': r'\b(income|salary|earning|annual income|आय|ఆదాయ)\b',
    'cue_money': r'(₹|rs\.?|rupees|lakh|crore)',
    'cue_land': r'\b(acre|hectare|land ?holding|एकड़|ఎకర)\b',
    'cue_gender': r'\b(women|woman|female|male|girl|transgender)\b',
    'cue_category': r'\b(sc|st|obc|ews|scheduled caste|scheduled tribe|general category)\b',
    'cue_state_resident': r'\b(resident|domicile|native of|permanent resident)\b',
    'cue_occupation': r'\b(farmer|weaver|artisan|labour|worker|entrepreneur|student)\b',
    'cue_education': r'\b(class|std|standard|matric|graduate|diploma|school|college)\b',
    'cue_negation': r'\b(not|no|except|excluding|ineligible|shall not|must not)\b',
    'cue_modal_must': r'\b(must|should|shall|required to|has to)\b',
    'cue_document': r'\b(certificate|aadhaar|ration card|document|proof|affidavit)\b',
    'cue_procedure': r'\b(apply|application|submit|portal|registration|website)\b',
    'cue_vague': r'\b(subject to|as per|may be|discretion|availability|from time to time)\b',
    'cue_range': r'\b(between|from .* to |up ?to|minimum|maximum|at least|not exceed)\b',
}
CUE_RES = {k: re.compile(v, re.I) for k, v in CUES.items()}

def cue_features(text: str) -> dict:
    return {k: int(bool(r.search(text))) for k, r in CUE_RES.items()}


# ------------------------------------------------------------------ dataset

def build_frame() -> pd.DataFrame:
    clauses = json.loads(CLAUSES.read_text(encoding='utf-8'))

    by_scheme: dict[str, int] = {}
    for c in clauses:
        by_scheme[c['scheme_id']] = by_scheme.get(c['scheme_id'], 0) + 1

    seen: dict[str, int] = {}
    rows = []
    for c in clauses:
        sid = c['scheme_id']
        pos = seen.get(sid, 0)
        seen[sid] = pos + 1
        text = c['source_text']
        row = {
            'id': c['id'],
            'scheme_id': sid,
            # The grouping key for the split. Identical clause text recurs across
            # hundreds of schemes; without grouping on it the same sentence lands
            # in train and test and the scores are fiction.
            'group': c.get('dedup_group_id') or c['id'],
            'text': text,
            'label': label_of(c),
        }
        row.update(structural_features(text, pos, by_scheme[sid]))
        row.update(cue_features(text))
        rows.append(row)

    return pd.DataFrame(rows)


# ---------------------------------------------------------------- evaluation

def cv_macro_f1(X, y, groups, model_factory, n_splits: int = 5):
    """
    Grouped, stratified cross-validation.

    Grouping is not optional here. 11,551 clauses collapse to far fewer distinct
    sentences, and a random split would put the same text on both sides.
    """
    cv = StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=SEED)
    scores, preds, truths = [], [], []
    for train_idx, test_idx in cv.split(X, y, groups):
        model = model_factory()
        model.fit(X[train_idx], y[train_idx])
        p = model.predict(X[test_idx])
        scores.append(f1_score(y[test_idx], p, average='macro'))
        preds.append(p)
        truths.append(y[test_idx])
    return np.array(scores), np.concatenate(truths), np.concatenate(preds)


def main() -> None:
    df = build_frame()

    print('=' * 72)
    print('DATASET')
    print('=' * 72)
    print(f'clauses            : {len(df):,}')
    print(f'schemes            : {df.scheme_id.nunique():,}')
    print(f'dedup groups       : {df.group.nunique():,}   <- the CV grouping key')
    print()
    print(df.label.value_counts().to_string())
    maj = df.label.value_counts(normalize=True).max()
    print(f'\nmajority class     : {maj:.1%}  (so accuracy is a useless metric here)')

    structural_cols = list(structural_features('x', 0, 1).keys())
    cue_cols = list(CUES.keys())

    y = df.label.to_numpy()
    groups = df.group.to_numpy()

    results = {}

    # --------------------------------------------------------- baseline
    Xs = df[structural_cols].to_numpy(dtype=float)
    base_scores, _, _ = cv_macro_f1(
        Xs, y, groups, lambda: DummyClassifier(strategy='most_frequent')
    )
    results['Baseline (majority class)'] = base_scores

    # ------------------------------------------- Model A: structural only
    a_scores, a_true, a_pred = cv_macro_f1(
        Xs, y, groups,
        lambda: DecisionTreeClassifier(
            max_depth=8, min_samples_leaf=40, class_weight='balanced', random_state=SEED
        ),
    )
    results['A · structural only'] = a_scores

    # ------------------------------------- Model B: structural + cue words
    Xb = df[structural_cols + cue_cols].to_numpy(dtype=float)
    b_scores, b_true, b_pred = cv_macro_f1(
        Xb, y, groups,
        lambda: DecisionTreeClassifier(
            max_depth=10, min_samples_leaf=25, class_weight='balanced', random_state=SEED
        ),
    )
    results['B · structural + cue words'] = b_scores

    # ------------------------------------------ Model C: TF-IDF reference
    tfidf = TfidfVectorizer(max_features=3000, ngram_range=(1, 2), min_df=3, sublinear_tf=True)
    Xc = tfidf.fit_transform(df.text).toarray()
    c_scores, _, _ = cv_macro_f1(
        Xc, y, groups,
        lambda: DecisionTreeClassifier(
            max_depth=18, min_samples_leaf=5, class_weight='balanced', random_state=SEED
        ),
    )
    results['C · TF-IDF (reference)'] = c_scores

    print()
    print('=' * 72)
    print('5-FOLD GROUPED CROSS-VALIDATION — macro-F1')
    print('=' * 72)
    for name, s in results.items():
        print(f'{name:<30} {s.mean():.3f}  ± {s.std():.3f}')

    print()
    print('=' * 72)
    print('MODEL B — per-class, pooled over folds')
    print('=' * 72)
    print(classification_report(b_true, b_pred, digits=3))

    labels_sorted = sorted(df.label.unique())
    cm = confusion_matrix(b_true, b_pred, labels=labels_sorted)
    print('confusion matrix (rows = true, cols = predicted)')
    print(pd.DataFrame(cm, index=labels_sorted, columns=labels_sorted).to_string())

    # ------------------------------------------------------ interpretability
    final = DecisionTreeClassifier(
        max_depth=10, min_samples_leaf=25, class_weight='balanced', random_state=SEED
    ).fit(Xb, y)

    imp = (
        pd.Series(final.feature_importances_, index=structural_cols + cue_cols)
        .sort_values(ascending=False)
        .head(12)
    )
    print()
    print('=' * 72)
    print('MODEL B — what it splits on')
    print('=' * 72)
    print(imp.to_string())

    shallow = DecisionTreeClassifier(
        max_depth=3, min_samples_leaf=25, class_weight='balanced', random_state=SEED
    ).fit(Xb, y)
    print()
    print('the readable version (depth 3):')
    print(export_text(shallow, feature_names=structural_cols + cue_cols, max_depth=3))

    out = Path(__file__).resolve().parent / 'results.json'
    out.write_text(
        json.dumps(
            {
                'seed': SEED,
                'n_clauses': int(len(df)),
                'n_schemes': int(df.scheme_id.nunique()),
                'n_groups': int(df.group.nunique()),
                'class_counts': df.label.value_counts().to_dict(),
                'macro_f1': {k: {'mean': float(v.mean()), 'std': float(v.std())} for k, v in results.items()},
                'top_features': imp.round(4).to_dict(),
            },
            indent=2,
        ),
        encoding='utf-8',
    )
    print(f'\nwrote {out}')


if __name__ == '__main__':
    main()
