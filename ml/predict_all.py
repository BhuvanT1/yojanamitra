"""
Generate the triage predictions the web app ships.

WHY A LOOKUP TABLE RATHER THAN INFERENCE IN THE APP

The winning model is a histogram gradient-boosting ensemble over 120,000 TF-IDF
features — 800 trees. Porting that to TypeScript would mean a multi-megabyte
model file, a hand-written vectoriser, and a permanent risk that the Python and
TypeScript feature extractors drift apart and every prediction becomes quietly
wrong with nothing to notice it.

None of that is necessary, because the corpus is fixed. Clauses change only when
`npm run ingest` runs, which is a batch step anyway. So inference happens here,
once, and the app reads the answer.

That choice also lets the app ship the BEST model rather than the most portable
one, which is the whole point of the exercise.

EVERY PREDICTION IS OUT-OF-FOLD

The table is not built by training on everything and predicting the training set —
those numbers would be fitted and optimistic. It uses 5-fold grouped
cross-validation and takes each clause's prediction from the fold where that
clause was held out. Every value shipped comes from a model that had never seen
that clause, and the reported macro-F1 describes exactly these predictions.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import classification_report, f1_score
from sklearn.model_selection import StratifiedGroupKFold

from triage import CUES, SEED, build_frame, structural_features

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'src' / 'triage' / 'predictions.json'
CARD = Path(__file__).resolve().parent / 'model_card.json'

N_SPLITS = 5
MAX_WORD_FEATURES = 1500


def main() -> None:
    df = build_frame()
    y = df.label.to_numpy()
    groups = df.group.to_numpy()
    numeric_cols = list(structural_features('x', 0, 1).keys()) + list(CUES.keys())
    classes = sorted(df.label.unique())

    print(f'{len(df):,} clauses · {df.group.nunique():,} dedup groups')
    print(f'generating out-of-fold predictions over {N_SPLITS} grouped folds\n')

    oof_label = np.empty(len(df), dtype=object)
    oof_conf = np.zeros(len(df), dtype=float)

    cv = StratifiedGroupKFold(n_splits=N_SPLITS, shuffle=True, random_state=SEED)
    for fold, (tr, te) in enumerate(cv.split(df, y, groups), 1):
        # The vectoriser is fitted on the training fold only. Fitting it on
        # everything would leak test-fold vocabulary and idf weights into the
        # model, which is a subtle and very common way to inflate a score.
        vec = TfidfVectorizer(
            analyzer='word', ngram_range=(1, 2), min_df=3,
            max_features=MAX_WORD_FEATURES, sublinear_tf=True,
        ).fit(df.text.iloc[tr])

        def build(idx):
            return np.hstack([
                vec.transform(df.text.iloc[idx]).toarray(),
                df[numeric_cols].to_numpy(dtype=float)[idx],
            ])

        model = HistGradientBoostingClassifier(
            max_iter=200, learning_rate=0.12, random_state=SEED
        ).fit(build(tr), y[tr])

        proba = model.predict_proba(build(te))
        best = proba.argmax(axis=1)
        oof_label[te] = model.classes_[best]
        oof_conf[te] = proba[np.arange(len(te)), best]

        print(f'  fold {fold}/{N_SPLITS}  macro-F1 {f1_score(y[te], oof_label[te], average="macro"):.3f}')

    macro = f1_score(y, oof_label.astype(str), average='macro')
    print(f'\nout-of-fold macro-F1 over the whole corpus: {macro:.3f}\n')
    print(classification_report(y, oof_label.astype(str), digits=3))

    # ------------------------------------------------------------- the table
    class_index = {c: i for i, c in enumerate(classes)}
    predictions = {
        row_id: [class_index[str(lbl)], round(float(conf), 3)]
        for row_id, lbl, conf in zip(df.id, oof_label, oof_conf)
    }

    payload = {
        'model': 'HistGradientBoostingClassifier',
        'features': f'TF-IDF word 1-2 grams (max {MAX_WORD_FEATURES}) + {len(numeric_cols)} engineered',
        'generated_from': 'out-of-fold predictions, 5-fold StratifiedGroupKFold on dedup_group_id',
        'seed': SEED,
        'classes': classes,
        'macro_f1_out_of_fold': round(float(macro), 4),
        'n_clauses': int(len(df)),
        'n_schemes': int(df.scheme_id.nunique()),
        'n_dedup_groups': int(df.group.nunique()),
        'caveat': (
            'Labels come from the rule-based proposer, so this predicts what the '
            'proposer would say, not ground truth. It orders a review queue and '
            'never decides eligibility.'
        ),
        'predictions': predictions,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(',', ':')), encoding='utf-8')
    print(f'\nwrote {OUT.relative_to(ROOT)}  ({OUT.stat().st_size / 1024:.0f} KB, {len(predictions):,} clauses)')

    card = {k: v for k, v in payload.items() if k != 'predictions'}
    card['per_class'] = classification_report(y, oof_label.astype(str), output_dict=True, digits=4)
    CARD.write_text(json.dumps(card, indent=2), encoding='utf-8')
    print(f'wrote {CARD.name}')


if __name__ == '__main__':
    main()
