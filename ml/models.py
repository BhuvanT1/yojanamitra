"""
Model selection for clause triage — pick on evidence, not on taste.

An earlier pass shipped a plain decision tree on hand-built features because it
could be read. That was the wrong objective for this task. The model orders a
REVIEW QUEUE: it decides which clause a human looks at third rather than ninth,
the human then reads the clause, and no citizen's eligibility depends on any of
it. The cost of a bad ordering is a few wasted seconds, so the thing to maximise
is accuracy, not auditability.

(Where auditability genuinely is the point — deciding whether a citizen qualifies
— there is no model at all, and that is not changing.)

So: a proper comparison. Same grouped splits for every candidate, one held-out
test set touched once at the end, macro-F1 throughout because the two small
classes are ~6% each and accuracy would hide them.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix, hstack
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, confusion_matrix, f1_score
from sklearn.model_selection import GroupShuffleSplit, StratifiedGroupKFold
from sklearn.preprocessing import MaxAbsScaler
from sklearn.svm import LinearSVC
from sklearn.tree import DecisionTreeClassifier

from triage import CUES, SEED, build_frame, structural_features

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(__file__).resolve().parent / 'model_selection.json'


def make_matrix(df: pd.DataFrame, fit_on: np.ndarray | None = None):
    """
    TF-IDF over the clause text, joined to the engineered numeric features.

    Word 1–2 grams plus character 3–5 grams. The character channel is what
    handles the multilingual half of this corpus: Devanagari and Telugu clauses
    have no whitespace-delimited tokens a word vectoriser can use, and a
    character n-gram picks up morphology an English-centric tokeniser drops.
    """
    numeric_cols = list(structural_features('x', 0, 1).keys()) + list(CUES.keys())

    word = TfidfVectorizer(
        analyzer='word', ngram_range=(1, 2), min_df=3, max_features=60_000, sublinear_tf=True
    )
    char = TfidfVectorizer(
        analyzer='char_wb', ngram_range=(3, 5), min_df=3, max_features=60_000, sublinear_tf=True
    )

    idx = np.arange(len(df)) if fit_on is None else fit_on
    word.fit(df.text.iloc[idx])
    char.fit(df.text.iloc[idx])

    scaler = MaxAbsScaler().fit(df[numeric_cols].to_numpy(dtype=float)[idx])

    def transform(sub: pd.DataFrame):
        return hstack(
            [
                word.transform(sub.text),
                char.transform(sub.text),
                csr_matrix(scaler.transform(sub[numeric_cols].to_numpy(dtype=float))),
            ]
        ).tocsr()

    return transform, {'word': word, 'char': char, 'scaler': scaler, 'numeric_cols': numeric_cols}


CANDIDATES = {
    'Baseline (majority)': lambda: DummyClassifier(strategy='most_frequent'),
    'Decision tree': lambda: DecisionTreeClassifier(
        max_depth=18, min_samples_leaf=5, class_weight='balanced', random_state=SEED
    ),
    'Random forest': lambda: RandomForestClassifier(
        n_estimators=300, min_samples_leaf=2, class_weight='balanced_subsample',
        n_jobs=-1, random_state=SEED
    ),
    'Linear SVM': lambda: LinearSVC(C=0.5, class_weight='balanced', random_state=SEED, max_iter=4000),
    'Logistic regression': lambda: LogisticRegression(
        C=4.0, class_weight='balanced', max_iter=2000, n_jobs=-1, random_state=SEED
    ),
}


def main() -> None:
    df = build_frame()
    y = df.label.to_numpy()
    groups = df.group.to_numpy()

    print(f'{len(df):,} clauses · {df.group.nunique():,} dedup groups · '
          f'majority class {df.label.value_counts(normalize=True).max():.1%}\n')

    # A held-out test set, split on groups, touched once at the very end.
    holdout = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=SEED)
    dev_idx, test_idx = next(holdout.split(df, y, groups))
    print(f'dev {len(dev_idx):,} · held-out test {len(test_idx):,} (grouped, never seen during selection)\n')

    transform, _ = make_matrix(df, fit_on=dev_idx)
    X = transform(df)
    print(f'feature matrix: {X.shape[0]:,} × {X.shape[1]:,}  ({X.nnz / X.shape[0]:.0f} non-zeros per row)\n')

    dev_df = df.iloc[dev_idx]
    X_dev, y_dev, g_dev = X[dev_idx], y[dev_idx], groups[dev_idx]

    cv = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=SEED)
    results = {}

    print('=' * 70)
    print('5-FOLD GROUPED CV ON THE DEV SET — macro-F1')
    print('=' * 70)
    for name, factory in CANDIDATES.items():
        t0 = time.time()
        scores = []
        for tr, te in cv.split(X_dev, y_dev, g_dev):
            m = factory()
            m.fit(X_dev[tr], y_dev[tr])
            scores.append(f1_score(y_dev[te], m.predict(X_dev[te]), average='macro'))
        s = np.array(scores)
        results[name] = {'mean': float(s.mean()), 'std': float(s.std()), 'seconds': time.time() - t0}
        print(f'{name:<24} {s.mean():.3f} ± {s.std():.3f}   ({time.time() - t0:.0f}s)')

    # Gradient boosting needs dense input, so it is run separately on a reduced
    # matrix rather than being excluded — it is a strong family on tabular data
    # and deserves a fair shot even if this is mostly text.
    print()
    print('Hist gradient boosting (dense, 1,500 features)…', flush=True)
    word_small = TfidfVectorizer(
        analyzer='word', ngram_range=(1, 2), min_df=3, max_features=1500, sublinear_tf=True
    ).fit(dev_df.text)
    numeric_cols = list(structural_features('x', 0, 1).keys()) + list(CUES.keys())
    Xd = np.hstack([word_small.transform(df.text).toarray(), df[numeric_cols].to_numpy(dtype=float)])
    t0 = time.time()
    scores = []
    for tr, te in cv.split(Xd[dev_idx], y_dev, g_dev):
        m = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.12, random_state=SEED)
        m.fit(Xd[dev_idx][tr], y_dev[tr])
        scores.append(f1_score(y_dev[te], m.predict(Xd[dev_idx][te]), average='macro'))
    s = np.array(scores)
    results['Hist gradient boosting'] = {'mean': float(s.mean()), 'std': float(s.std()), 'seconds': time.time() - t0}
    print(f'{"Hist gradient boosting":<24} {s.mean():.3f} ± {s.std():.3f}   ({time.time() - t0:.0f}s)')

    # ------------------------------------------------------------- the winner
    ranked = sorted(
        ((k, v) for k, v in results.items() if k != 'Baseline (majority)'),
        key=lambda kv: kv[1]['mean'],
        reverse=True,
    )
    winner = ranked[0][0]
    print(f'\nbest on dev: {winner}  ({ranked[0][1]["mean"]:.3f})')

    print()
    print('=' * 70)
    print(f'HELD-OUT TEST — {winner}, trained on the full dev set')
    print('=' * 70)
    if winner == 'Hist gradient boosting':
        final = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.12, random_state=SEED)
        final.fit(Xd[dev_idx], y_dev)
        pred = final.predict(Xd[test_idx])
    else:
        final = CANDIDATES[winner]()
        final.fit(X_dev, y_dev)
        pred = final.predict(X[test_idx])

    y_test = y[test_idx]
    test_f1 = f1_score(y_test, pred, average='macro')
    print(f'macro-F1 {test_f1:.3f}\n')
    print(classification_report(y_test, pred, digits=3))

    labels_sorted = sorted(df.label.unique())
    cm = confusion_matrix(y_test, pred, labels=labels_sorted)
    print('confusion matrix (rows = true)')
    print(pd.DataFrame(cm, index=labels_sorted, columns=labels_sorted).to_string())

    OUT.write_text(
        json.dumps(
            {
                'seed': SEED,
                'n_clauses': int(len(df)),
                'n_groups': int(df.group.nunique()),
                'dev_size': int(len(dev_idx)),
                'test_size': int(len(test_idx)),
                'n_features': int(X.shape[1]),
                'cv_macro_f1': results,
                'winner': winner,
                'holdout_macro_f1': float(test_f1),
            },
            indent=2,
        ),
        encoding='utf-8',
    )
    print(f'\nwrote {OUT.name}')


if __name__ == '__main__':
    main()
