# YojanaMitra

[![CI](https://github.com/BhuvanT1/yojanamitra/actions/workflows/ci.yml/badge.svg)](https://github.com/BhuvanT1/yojanamitra/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A multilingual assistant that tells an Indian citizen which government schemes they
qualify for, in plain language, with the specific clause they satisfied quoted from
the source. A citizen types or speaks their situation in plain or code-mixed text
(the interface runs in English, Hindi, Telugu, Tamil, Bengali, Marathi and more);
a deterministic rule engine, not a language model, decides the verdict.

![Typing a situation and getting matched schemes with the quoted clause](docs/media/demo.gif)

*Demonstration mode: proposed constraints are treated as approved in memory, and
every verdict is labelled so. See [The one rule](#the-one-rule).*

## At a glance

| | |
|---|---|
| Corpus | 2,876 MyScheme PDFs → **2,066 distinct schemes**, 0 parse failures, 9,825 distinct eligibility clauses |
| Profile extraction | **100%** field accuracy on 30 gold utterances (plain, telegraphic, code-mixed), **0 wrong values**; up from 62–90% before the harness-driven fixes. Small gold set, so read it as "known failure modes fixed", not "100% accurate" |
| Scheme matching | **not measured yet, on purpose**: no clause is human-approved, so the harness reports `not_measurable` instead of a number |
| Metric choice | F2 (recall-weighted), never accuracy; a do-nothing system scores ~99.5% accuracy |
| Tests | **175** TypeScript tests, run in CI with typecheck and production build |

The full stage-by-stage record (dataset quirks, annotation workload, extraction,
rule engine, citizen app, evaluation, and the bugs each stage caught) is in
[docs/DEVELOPMENT_LOG.md](docs/DEVELOPMENT_LOG.md).

## The one rule

**An LLM never decides eligibility.** Eligibility is decided by a deterministic rule
engine evaluating typed constraints that a human has approved. Language models only
understand language: extract a profile from free text, translate, propose annotations,
phrase explanations.

This is what makes the system auditable. A model that "reasons about" eligibility will
be confidently wrong about someone's entitlement to money, and it cannot show a citizen
which clause they failed, because no clause was ever checked.

Three guards enforce it in code, each covered by a test:

| Guard | Where |
|---|---|
| Only an **approved** constraint on an **eligibility_requirement** clause can decide | `isDecisive()` in `src/domain/clause.ts` |
| A scheme with **zero decisive clauses** is never shown as a match | `canProduceMatch()` in `src/domain/scheme.ts` |
| **Unparsed** eligibility text caps the verdict at `likely_eligible` | `combineVerdict()` in `src/domain/scheme.ts` |

## Setup

Requires Node 20 LTS or newer.

```bash
npm install
npm run typecheck
npm test                    # 175 tests
npm run dev                 # the citizen app at http://localhost:5173
YM_SIMULATE=1 npm run dev   # demonstration mode: proposed constraints treated as approved, labelled on every verdict
```

Pinned to Next.js 16 / React 19 because every Next 15.x release carries an npm
advisory, including CVE-2025-66478 (RCE in React Server Components). `npm audit`
reports 0 vulnerabilities. Details in the
[development log](docs/DEVELOPMENT_LOG.md#dependency-pins).

### Rebuilding the data

The source PDFs are not in the repo (72 MB). The normalised corpus
(`data/normalized/`) and the annotation state (`data/annotations/`) are, so the
app and tests run straight after `npm install`. To rebuild them from source:

```bash
pip install -U huggingface_hub
python -c "from huggingface_hub import snapshot_download; snapshot_download('shrijayan/gov_myscheme', repo_type='dataset', local_dir='data/raw/gov_myscheme')"

npm run ingest          # ~40s, writes data/normalized/ and data/provenance.json
npm run ingest:report   # prices the annotation workload by slice
npm run propose         # proposes constraints; writes data/annotations/clauses.json
npm run review          # opens the review tool at http://localhost:5174
npm run extract         # the three personas from the brief
npm run extract -- "widow, 52, bihar, no land, bpl card hai"
npm run match           # full pipeline against the real corpus
npm run match -- --simulate "I am a farmer in Telangana"

npm run dev                 # the citizen app at http://localhost:5173
YM_SIMULATE=1 npm run dev   # demonstration mode (see below)

npm run eval                # the evaluation harness
```

Set `REVIEWER=yourname` before `npm run review` so approvals are attributed to you.

Deployment (Docker, Render) is covered in [DEPLOY.md](DEPLOY.md); the ML models
behind clause triage are in [ml/README.md](ml/README.md).

## Layout

```
src/domain/       profile, constraint expression tree, clause lifecycle, verdicts
src/ingest/       PDF text extraction, section parsing, clause splitting, de-duplication
src/annotations/  Indian money/number parsing, deterministic constraint proposer
src/storage/      annotation store: atomic writes, revision checks, group approval
src/extraction/   multilingual lexicon, Indic number parsing, profile extractor
src/rules/        the deterministic evaluator and the match pipeline
src/retrieval/    candidate narrowing (recall-favouring, never a second gate)
src/app/          Next.js App Router — /[locale] and /api/match
src/components/   the citizen surface: hero input, understood panel, result cards
src/i18n/         UI strings and field labels
src/auth/         reviewer and optional citizen accounts — scrypt hashing, sessions
src/llm/          the model boundary and the grounded explanation layer
src/triage/       clause-triage predictions that order the review queue (from ml/)
src/proposals/    predicted constraint drafts for reviewers (from ml/)
ml/               the clause-triage and constraint-prediction models; see ml/README.md
docs/             development log, the course ML-workflow notebook and its PDF report
evaluation/       gold personas, harness, reports
scripts/          ingest, workload report, proposer, review server
tests/            175 tests: domain, ingest, proposer, store, extraction, rules, auth, explain, triage
data/raw/         the clone (gitignored)
data/normalized/  schemes.json, dedup.json
data/annotations/ clauses.json — the review state
data/provenance.json
legacy/           the first Python + Streamlit prototype (see below)
```

## Team

Built for the NLP course at VIT-AP University (Fall 2026) by **Themballi Bhuvan**,
**Kashak Singh**, **Navaneeth Gopal Akuluru** and **Jaideep Kundu**, guided by
**Dr. Putta Durga**.

## The earlier prototype

[`legacy/`](legacy/) holds the first version: a Python + Streamlit prototype over a
small hand-built corpus of 40 schemes. It established the rule that a model never
decides eligibility. Everything above describes the Next.js rewrite in `src/`,
which replaced it. It still runs:

```bash
cd legacy
pip install -r requirements.txt
pytest                # 50 tests
streamlit run app.py
```

## Licence and attribution

Code: [MIT](LICENSE).


Scheme data from [`shrijayan/gov_myscheme`](https://huggingface.co/datasets/shrijayan/gov_myscheme)
(Apache-2.0), itself scraped from [myscheme.gov.in](https://www.myscheme.gov.in/).
Original source: the Indian Government's MyScheme portal.

This is guidance, not an official determination. No accuracy claim should leave this
repository until clauses have been human-approved and verified against the live portal.
