# Clause triage — ordering the annotation backlog

```
ml/
  clause_triage.ipynb     the deliverable — the whole story, figures included
  triage.py               Part 1: interpretable baselines
  models.py               Part 2: model comparison + held-out test
  predict_all.py          Part 2: writes src/triage/predictions.json
  constraints.py          Part 3: constraint prediction — ML that writes rules
  predict_constraints.py  Part 3: writes src/proposals/predicted.json
  build_notebook.py       regenerates the notebook
  requirements.txt
```

```bash
pip install -r ml/requirements.txt
python ml/triage.py              #  ~30s
python ml/models.py              #  ~7min  model selection
python ml/predict_all.py         #  ~5min  → src/triage/predictions.json
python ml/constraints.py         #  ~6min  constraint prediction, evaluated
python ml/predict_constraints.py #  ~3min  → src/proposals/predicted.json
```

There are **two models**, and they do different jobs.

| | Triage (Part 2) | Constraint prediction (Part 3) |
|---|---|---|
| Predicts | what kind of work a clause needs | which fields/operators it tests |
| Used on | reviewer dashboard, to order the queue | reviewer dashboard, to draft the rule |
| If deleted | queue is unordered | 1,100+ clauses go back to a blank form |

---

## What it is

A classifier that predicts **what kind of human work an eligibility clause
needs**, so a 10,051-clause review queue can be worked cheapest-first.

It is **not** an eligibility model and never touches a citizen's verdict. That
belongs to the deterministic rule engine, acting only on clauses a named reviewer
has approved, quoting the source sentence every time.

## Data

`shrijayan/gov_myscheme` @ `2e7a91a` (Apache-2.0) → 2,066 schemes → **11,551
clauses**, **9,825 distinct sentences**.

| Class | Reviewer's task | n |
|---|---|---:|
| `no_pattern` | Write a constraint by hand | 5,089 |
| `machine_checkable` | Confirm the drafted constraint | 4,962 |
| `not_machine_checkable` | Mark as un-checkable | 795 |
| `needs_schema_extension` | Add a profile field first | 705 |

## Protocol

- `StratifiedGroupKFold`, 5 folds, seed `20260915`, **grouped on
  `dedup_group_id`**. Identical clause text recurs across hundreds of schemes; a
  random split puts the same sentence on both sides and every score becomes
  fiction.
- A held-out 20% test set, split on groups, touched exactly once.
- **Macro-F1**, never accuracy — the two small classes are ~6% each.

## Model selection

| Model | macro-F1 (dev CV) |
|---|---|
| Baseline (majority) | 0.153 |
| Decision tree | 0.835 |
| Random forest | 0.883 |
| Logistic regression | 0.901 |
| Linear SVM | 0.908 |
| **Hist gradient boosting** | **0.933 ± 0.005** |

**Held-out test: 0.932** — within a thousandth of the dev estimate, so the
selection did not overfit the cross-validation.

Features: TF-IDF word 1–2 grams and character 3–5 grams, plus 31 engineered
features. The character channel is what handles the multilingual half of the
corpus — Devanagari and Telugu clauses have no whitespace-delimited tokens a word
vectoriser can use.

### Why not the readable tree

An earlier pass shipped a plain decision tree on hand-built features (0.610)
because it could be printed and inspected. That was the wrong objective. This
model **orders a queue**: it decides which clause a human reads third rather than
ninth, the human reads the clause regardless, and no citizen's eligibility
depends on it. The cost of a bad ordering is seconds.

Where auditability genuinely is the point — deciding whether someone qualifies —
there is no model at all, and that has not changed.

## What ships

`src/triage/predictions.json` — a 256 KB lookup table, one row per clause.

The app does not run the model. Porting an 800-tree ensemble over TF-IDF to
TypeScript would mean a multi-megabyte model file, a hand-written vectoriser, and
a permanent risk of the two feature extractors drifting apart — at which point
every prediction is quietly wrong and nothing raises an error. The corpus only
changes when `npm run ingest` runs, so inference happens once in Python.

**Every prediction in the table is out-of-fold.** Five grouped folds, each clause
classified by the fold that had never seen it, vectoriser refitted per fold so no
test vocabulary leaks in.

Out-of-fold over the whole corpus: **macro-F1 0.934**

| Class | P | R | F1 | n |
|---|---:|---:|---:|---:|
| `machine_checkable` | 0.965 | 0.933 | 0.949 | 4,962 |
| `no_pattern` | 0.928 | 0.973 | 0.950 | 5,089 |
| `not_machine_checkable` | 0.932 | 0.937 | 0.935 | 795 |
| `needs_schema_extension` | 0.968 | 0.848 | 0.904 | 705 |

`tests/triage.test.ts` fails the build if the table stops covering the corpus —
the failure mode after a re-ingest without a re-run of `predict_all.py`.

---

# Part 3 · Constraint prediction

The triage model sorts a queue. This one **writes the drafts**.

When no regex matches a clause it reaches a reviewer with nothing, and they
formalise it from scratch. A regex fails because it does not recognise the
*phrasing*, which says nothing about whether the clause is formalisable — so:
learn the structure from the 4,962 clauses a pattern did match, predict it for
the rest.

Three heads, One-vs-Rest logistic regression over TF-IDF word 1–2 and char 3–5
grams plus the 31 engineered features:

| Head | micro-F1 | macro-F1 | exact-set match |
|---|---|---|---|
| **fields** (8 active) | 0.953 | 0.944 | **0.899** |
| **operators** (7 active) | 0.923 | 0.844 | 0.843 |
| **exclusion** (binary) | 0.971 | 0.868 | 0.971 |

Exact-set match on fields is the number that matters: for nine clauses in ten the
model names the *complete* field set, not just some of it — and a reviewer
accepting a draft accepts the whole thing.

`exclusion` is 97.1% accurate overall but 0.75 F1 on the positive class (250
examples, over-flags). A missed disqualifier silently inverts a rule while a
false one is visible on inspection, so over-flagging is the right direction.

### What it recovers

```
6,589  clauses that reached a reviewer with nothing drafted
1,926  now carry a predicted field set        (29.2%, p >= 0.60)
  801  of those at p >= 0.90
  178  flagged as disqualifiers
```

Structure only. Values — 18, 2 hectares, "telangana" — come from the existing
numeric and lexicon parsers, which are good at values and bad at phrasing. The
split runs along the line where each side is strong.

### Two honest limits

**Coverage is 29%, not 90%.** The p ≥ 0.60 threshold is deliberate: below it the
model is guessing, and a wrong field sends a reviewer down the wrong path —
worse than the blank form they already had. The other 71% are left exactly where
they were.

**There is a distribution shift the CV cannot measure.** Those scores came from
clauses the regexes matched; these are the ones they missed, systematically the
awkward ones. The CV numbers are an upper bound, not an estimate. The model also
leans on `occupation`, its majority field.

Which is the argument for it being a **draft**. `isDecisive()` still requires
`annotation_state === 'approved'`, and `tests/proposals.test.ts` asserts a
model-drafted constraint does not make a clause decisive. It turns "read this
clause and start from nothing" into "check whether these three fields are right".
It shortens the queue, not the review.

---

## The caveat that stays

Labels come from the rule-based proposer, not from humans, so every number here
measures **agreement with a rule system**, not correctness. This is distillation.

The evidence that the categories are nonetheless real is Model A in Part 1 of the
notebook: built only from structural features the proposer never inspects —
length, punctuation, digit density, position — it more than doubles the baseline.

The real evaluation becomes possible once reviewers have approved a few hundred
clauses by hand. The same pipeline then retrains on *their* decisions, and that
model measures something other than the rules that generated its own training
data.
