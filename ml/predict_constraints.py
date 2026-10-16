"""
Draft constraint structure for the clauses no regex could parse.

This is the payoff. 6,589 clauses reached a human with nothing drafted, because
no pattern in the rule proposer recognised their phrasing. The model trained on
the 4,962 the proposer DID handle predicts, for each of them, which profile
fields the clause tests, which operators it uses, and whether it disqualifies
rather than qualifies.

THE DISTRIBUTION SHIFT, STATED BEFORE THE NUMBERS

Cross-validation scored this on regex-matched clauses. These are the clauses the
regexes MISSED, and they are not a random sample of the corpus — they are
systematically the awkward ones. The CV numbers are an upper bound on how well
the model does here, not an estimate of it.

That is exactly why the output is a draft and not a decision. Every prediction
arrives in front of a named reviewer who approves, corrects or rejects it, which
is the same gate every regex-proposed constraint already passes through. The
model's job is to turn "read this clause and start from nothing" into "check
whether these three fields are right".

The confidence attached to each prediction is what lets the reviewer work the
strong drafts first and treat the weak ones as untouched.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from constraints import OPERATORS, PROFILE_FIELDS, build, featurise, make_model
from triage import CUES, SEED, structural_features

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'src' / 'proposals' / 'predicted.json'
CARD = Path(__file__).resolve().parent / 'constraint_card.json'

# A field is proposed at p >= this. Chosen for precision rather than coverage: a
# wrong field sends a reviewer down the wrong path, which is worse than an empty
# draft that leaves them where they already were.
FIELD_THRESHOLD = 0.60
OP_THRESHOLD = 0.60
EXCLUSION_THRESHOLD = 0.70


def main() -> None:
    labelled, unlabelled = build()
    numeric_cols = list(structural_features('x', 0, 1).keys()) + list(CUES.keys())

    field_cols = [f'f_{f}' for f in PROFILE_FIELDS if labelled[f'f_{f}'].sum() > 0]
    op_cols = [f'o_{o}' for o in OPERATORS if labelled[f'o_{o}'].sum() > 0]

    print(f'training on {len(labelled):,} clauses the proposer handled')
    print(f'predicting for {len(unlabelled):,} it could not\n')

    tx, _ = featurise(labelled.text, labelled, numeric_cols)
    X_train = tx(labelled)
    X_new = tx(unlabelled)

    field_model = make_model().fit(X_train, labelled[field_cols].to_numpy())
    op_model = make_model().fit(X_train, labelled[op_cols].to_numpy())
    excl_model = make_model(single=True).fit(X_train, labelled.is_exclusion.to_numpy())

    # OneVsRest gives one probability column per label.
    field_p = np.column_stack([e.predict_proba(X_new)[:, 1] for e in field_model.estimators_])
    op_p = np.column_stack([e.predict_proba(X_new)[:, 1] for e in op_model.estimators_])
    excl_p = excl_model.predict_proba(X_new)[:, 1]

    field_names = [c[2:] for c in field_cols]
    op_names = [c[2:] for c in op_cols]

    drafts = {}
    with_any_field = 0
    for i, clause_id in enumerate(unlabelled.id):
        fields = {field_names[j]: round(float(field_p[i, j]), 3)
                  for j in range(len(field_names)) if field_p[i, j] >= FIELD_THRESHOLD}
        ops = [op_names[j] for j in range(len(op_names)) if op_p[i, j] >= OP_THRESHOLD]
        if not fields:
            continue
        with_any_field += 1
        drafts[clause_id] = {
            'fields': fields,
            'ops': ops,
            'exclusion': bool(excl_p[i] >= EXCLUSION_THRESHOLD),
            # The strongest field's probability: what the queue is ordered by.
            'confidence': round(float(max(fields.values())), 3),
        }

    coverage = with_any_field / len(unlabelled)
    print(f'drafted structure for {with_any_field:,} of {len(unlabelled):,} '
          f'({coverage:.1%}) at p >= {FIELD_THRESHOLD}')

    strong = sum(1 for d in drafts.values() if d['confidence'] >= 0.9)
    print(f'  of those, {strong:,} at p >= 0.90')
    print(f'  flagged as disqualifiers: {sum(1 for d in drafts.values() if d["exclusion"]):,}')

    print('\nmost-predicted fields across the drafts:')
    tally: dict[str, int] = {}
    for d in drafts.values():
        for f in d['fields']:
            tally[f] = tally.get(f, 0) + 1
    for f, n in sorted(tally.items(), key=lambda kv: -kv[1]):
        print(f'  {f:<22} {n:,}')

    print('\nexamples:')
    for clause_id, d in list(drafts.items())[:4]:
        text = unlabelled.loc[unlabelled.id == clause_id, 'text'].iloc[0]
        print(f'  {text[:96]}')
        print(f'    → fields {list(d["fields"])}  ops {d["ops"]}'
              f'{"  [DISQUALIFIER]" if d["exclusion"] else ""}  p={d["confidence"]}\n')

    payload = {
        'model': 'OneVsRest LogisticRegression over TF-IDF word 1-2 + char 3-5 grams',
        'trained_on': int(len(labelled)),
        'predicted_for': int(len(unlabelled)),
        'drafted': with_any_field,
        'coverage': round(coverage, 4),
        'thresholds': {'field': FIELD_THRESHOLD, 'op': OP_THRESHOLD, 'exclusion': EXCLUSION_THRESHOLD},
        'seed': SEED,
        'caveat': (
            'Cross-validated on clauses the regex proposer matched; these are the ones it '
            'missed, which are systematically harder. Treat the CV scores as an upper bound. '
            'Every draft requires a named reviewer to approve it before it can decide anything.'
        ),
        'drafts': drafts,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(',', ':')), encoding='utf-8')
    print(f'wrote {OUT.relative_to(ROOT)}  ({OUT.stat().st_size / 1024:.0f} KB)')

    card = {k: v for k, v in payload.items() if k != 'drafts'}
    card['field_tally'] = tally
    CARD.write_text(json.dumps(card, indent=2), encoding='utf-8')
    print(f'wrote {CARD.name}')


if __name__ == '__main__':
    main()
