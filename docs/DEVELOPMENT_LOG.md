# Development log

How YojanaMitra was built, stage by stage: what each stage produced, the
numbers it measured, and the bugs it caught. The [README](../README.md) has
the short version.

## Dependency pins

This project was first pinned to `next@15.1.6`, which carries **CVE-2025-66478**
— a CVSS 10.0 remote-code-execution flaw in the React Server Components protocol
affecting Next.js 15.x with the App Router, i.e. exactly this app. Worse, npm's
advisory database flags *every* 15.x release for one issue or another, so no
patch release inside that line clears the audit.

Now pinned to **next 16.3.5 / react 19.3.0**, which audits clean. Verified after
the upgrade: typecheck passes, `next build` succeeds, all 109 tests pass, and the
match pipeline returns identical results (11 eligible / 29 likely / 160 not
eligible for the farmer persona) — so the upgrade changed the dependency surface
and nothing else.


## What the dataset actually is

Worth knowing before you trust the card:

- The card advertises **CSV / JSON / Parquet**. The repository contains **PDFs only**.
- The card says **723 files**. The clone contains **2,876**, because most schemes ship
  two to four byte-identical copies (`aavy.pdf`, `aavy copy.pdf`, `aavy(1).pdf`).
- Each PDF is a **print-to-PDF of the myscheme.gov.in page**, chrome and all — nav bar,
  sign-in modals, FAQ, footer. Nothing is structured; every field is parsed out of the
  text layer.
- The text layer is UTF-8 that was read as Latin-1, so ₹ arrives as `â‚¹`. Repaired in
  `fixMojibake()`, run by run, because at least one broken sequence would otherwise
  force us to abandon the repair for a whole document.

After de-duplication: **2,066 distinct schemes**.

## Stage 1 output

```
FILES        2,876 raw → 2,066 distinct (by sha256 and by slug — they agree)
PARSING      2,066 parsed, 0 failed, 20 with a section the nav bar promised but the body lacked
LEVEL        501 central · 1,515 state · 50 undetermined
ELIGIBILITY  2,065 with eligibility text · 1 without (can never match) · 402 with an Exclusions block
CLAUSES      11,551 split → 9,825 distinct texts
COVERAGE     327 schemes carry text the splitter could not place (825 fragments)
APPROVED     0
```

`data/provenance.json` carries the dataset identity, commit SHA, licence and these
counts. The UI must display it.

## The number that matters

**9,825 distinct clause texts.** At ~20 seconds per review decision that is ~55 hours of
annotation for the whole corpus. Clause de-duplication only saves 14.9% — the repeated
clauses are real (`"The applicant should be a citizen of India."` appears 78 times) but
most eligibility prose is scheme-specific.

Priced by slice:

| Slice | Schemes | Clauses | Distinct | Review |
|---|---|---|---|---|
| Everything | 2,066 | 11,551 | 9,825 | ~55 h |
| Central only | 501 | 3,299 | 3,004 | ~17 h |
| Central + Telangana + Andhra | 536 | 3,602 | 3,292 | ~18 h |

Annotation coverage, not model quality, is what will limit useful matches.

## Stage 2 output

```
PROPOSED               10,051 clauses awaiting review, in 8,538 groups
  ...with a constraint  4,962  (43.0%)
NEEDS SCHEMA EXTENSION    705  (6.1%)
NOT MACHINE CHECKABLE     795  (6.9%)
APPROVED                    0
```

### The schema-extension backlog

This is why `needs_schema_extension` is its own state rather than a free-text
reason — the backlog sorts by how many clauses each new field would unlock:

| Clauses | Field |
|---|---|
| 252 | `marks_percentage` |
| 155 | `documents_held` |
| 132 | `citizenship` |
| 53 | `domicile_years` |
| 42 | `is_income_tax_payer` |
| 37 | `prior_benefit_received` |
| 21 | `ration_card_type` |
| 13 | `disability_percentage` |

### The proposer

Deterministic — regular expressions over a fixed vocabulary, no model call.
Reproducible (a reviewer's work is not invalidated by a model version bump),
testable against real corpus strings, and it runs offline. An LLM proposer can be
added behind the same interface to improve recall; it would change nothing about
the approval gate.

It writes a reviewer note whenever it guessed: bare income figures assumed to be
ceilings, `"above 18"` resolved to `>=`, multiple conditions joined with AND,
and every negative-polarity clause turned into an exclusion. 68% of clauses carry
such a note.

One bug worth recording, because it is the shape of error this whole architecture
exists to catch. `"annual income between ₹1.2 and ₹5 lakhs"` states the multiplier
once, on the upper bound. Read literally the floor is **₹1.2**, which would admit
every citizen in India. The parser now propagates a shared lakh/crore multiplier
to a bare lower bound and flags it for confirmation; `tests/propose.test.ts` pins
it.

### The review tool

`npm run review` — a dependency-free Node server on port 5174, no framework, no
build step, no API key.

A stated departure from the folder plan: the reviewer is a single-user internal
tool, so it is not part of the Next.js app. `src/app/` remains the citizen
surface, where i18n, SSR and mobile actually matter. Bolting the reviewer onto it
would have made the bottleneck tool the slowest thing to start.

Review is **group-first**: identical clause text across schemes is one decision,
ordered largest group first. Approving the top group marks 24 clauses at once.
Keys: `a` approve · `e` edit · `r` not checkable · `p` procedural ·
`i` informational · `s` skip.

## Stage 3 output — extraction

Free text → structured profile, with per-field confidence and evidence.

The three inputs from the brief, all passing as tests:

```
"I'm 33, a farmer in Telangana with 1.5 acres of land in my village, OBC,
 my yearly income is around 1.5 lakh."
  age                33          0.90  ["I'm 33"]
  annual_income_inr  150000      0.90  ["1.5 lakh"]
  land_acres         1.5         0.90  ["1.5 acres"]
  occupation         [farmer]    0.95  ["farmer"]
  state              telangana   0.95  ["Telangana"]
  residence          rural       0.90  ["village"]
  category           obc         0.95  ["OBC"]
  UNKNOWN: gender, education_stage, special_categories

"widow, 52, bihar, no land, bpl card hai"
  age                52                 0.90  ["52"]
  state              bihar              0.95  ["bihar"]
  special_categories [bpl,widow,landless] 0.95  ["bpl","widow","no land"]
  gender             female             0.85  ["widow"]

"మా అమ్మాయి 11వ తరగతి, నేను రైతుని"
  occupation         [farmer]    0.95  ["రైతు","రైతుని"]
  dependent dep_1    relation=daughter gender=female education_stage=class_11_12
  (the applicant's own education_stage stays UNKNOWN)
```

### Why extraction reads the original, never a translation

Evidence spans have to index what the citizen actually typed. Translate first and
the evidence for `occupation: farmer` on a Telugu input is an English word that
appears nowhere in their text, and the correction panel has nothing to highlight.
So the lexicon carries terms in every supported script and matching runs on the
raw input. Adding a language is appending entries to `src/extraction/lexicon.ts`
with a new `lang` tag — no code change, which is what the brief asked for.

Word boundaries are applied only to Latin-script terms: Telugu and Devanagari
join stem and inflection without spaces, so `\b` would miss `రైతుని` when the
lexicon holds `రైతు`.

### What it refuses to do

- **Never invents a field.** The plain-English persona gets no `gender` because
  the text never says. Absent makes a constraint UNKNOWN, which caps the verdict
  at `likely_eligible` — the honest answer. A guess would produce a confident
  wrong one.
- **Drops ungrounded output.** Every result is run through
  `assertEvidenceIsGrounded`; a field whose evidence is not a verbatim substring
  is removed, not shown with a caveat. This is the guard that stops an LLM
  proposer, added later, from inventing a justification.
- **Won't bind a fact to the wrong person.** "a son and a daughter, one is in 9th
  class" yields two dependents and no education stage on either, because there is
  no way to tell whose class it is.
- **Says when it is unsure.** `"UP se"` yields `uttar pradesh` at confidence
  0.40. Confidence orders results; it never decides eligibility.

## Stage 4 output — the rule engine

The only module permitted to decide eligibility. A pure function of (approved
constraint, profile): no model call, no network, no clock, no randomness.

### The hard part is the unknowns

Comparisons are trivial. What matters is what happens when the profile does not
say, and every rule here chooses UNKNOWN over a convenient answer:

| Node | Rule |
|---|---|
| `all` | one VIOLATED violates; any UNKNOWN makes it UNKNOWN; only all-satisfied passes |
| `any` | one SATISFIED wins even beside an unknown sibling — you qualified by one route |
| `exclusion` | SATISFIED child → VIOLATED · VIOLATED child → SATISFIED · **UNKNOWN child → UNKNOWN** |

That last row is why `exclusion` is its own node rather than a negation. For
*"excluding income-tax payers"* against a profile that never mentions tax, a
negation reads "not known to be excluded" and quietly admits them. UNKNOWN is the
honest answer, and it caps the verdict at `likely_eligible`.

### Dependent binding

A scheme whose clauses talk about a child tests **one** child throughout. Without
this, a family with a 9-year-old son and a 17-year-old daughter could satisfy
"child under 10" from one and "girl in class 11–12" from the other, and qualify on
a household that does not exist. The engine evaluates once per candidate
dependent, keeps the best binding, and records who it was.

### What the demo shows

`npm run match` against the real corpus returns **nothing eligible**, and says
why: no clause has been human-approved. That is the system working.

`npm run match -- --simulate` treats proposed constraints as approved **in memory
only** (`data/annotations` is never written) and labels every verdict SIMULATED.
For the farmer persona: 11 eligible, 29 likely eligible, 160 not eligible, each
with the clause quoted verbatim and a reason built from the profile.

### A bug the simulation caught, which is the point

*Feed The Seed* carries the clause:

> "No livestock farmers are eligible for the scheme."

The proposer read it as a **positive** requirement, so the engine reported a
farmer as ✓ SATISFIED on a clause that disqualifies them. The negation is a
leading "No", nowhere near the word "eligible", so no substring marker caught it.

Fixed with regex polarity patterns, pinned in `tests/propose.test.ts`, and the
scheme moved from *likely eligible* to *not eligible*. The important part is that
this reached a verdict **only** because `--simulate` deliberately bypassed the
approval gate. In the real pipeline a human would have seen that proposal first.
This is the failure class the whole architecture exists to contain.

## Stage 5 output — the citizen app

Next.js App Router + TypeScript + Tailwind. **113 kB first load**, which is the
number that matters on a cheap Android phone over a slow connection.

### Why the corpus never reaches the phone

`/api/match` runs on the server, reads the 17 MB corpus once into module scope,
and returns at most 50 trimmed results. Three consequences, all deliberate: the
phone downloads kilobytes not megabytes; the rule engine cannot be modified by
the client, so a verdict is computed on the server or not at all; and the
citizen's text never leaves the process — not logged with the response, not
persisted, not sent anywhere.

### What the interface does

- **One large input**, not a twenty-field form. Voice via the browser's own Web
  Speech API, asking for the chosen locale so Telugu speech is transcribed as
  Telugu. The button does not render where the API is missing.
- **"What we understood about you"** shows every inferred field *with the words it
  came from* — `Work: farmer — "రైతు", "రైతుని"`. A claim you cannot see the basis
  for is unfalsifiable; a quote is something a citizen can disagree with. Editing
  any field re-runs the match against the corrected profile immediately, and the
  correction is marked *you told us* and trusted at confidence 1.
- **Result cards** expand to clause-by-clause reasoning, each clause quoted
  **verbatim** from the official page and linked to it.
- **"You may qualify" never looks like "You qualify"** — different colour, icon,
  label, plus an explicit sentence naming what is unverified. Colour alone would
  fail a colour-blind citizen and anyone reading on a cheap screen in sunlight.
- **Unverified clauses are listed on the card**, saying no human has checked
  them, rather than hidden.
- Scheme legal names are never translated and carry `lang="en"`, so they stay
  searchable and quotable at an office.
- Skip link, 44 px minimum tap targets, visible focus rings, `aria-expanded` on
  every disclosure, `prefers-reduced-motion` respected, zoom never disabled.
  **Zero horizontal overflow at 320 px** — measured, not assumed.
- No account, no wall, no step counter.

### Honest gaps

- **Tamil, Bengali, Marathi and Kannada currently render English strings.** The
  wiring is complete; they need a translator, not a code change. The language
  picker says "(English text)" beside them rather than pretending.
- Demonstration mode (`YM_SIMULATE=1`) treats proposed constraints as approved so
  the interface can be exercised before the annotation backlog is worked. It
  shows a permanent red banner, a badge on every card, and never writes to
  `data/annotations`.

### A defect the mobile screenshot caught

The understood panel originally omitted `occupation`. For the Telugu persona
("నేను రైతుని") that is the *only* field extracted — so the panel showed the
citizen nothing it had understood, and no way to correct the one thing deciding
their results. Found by screenshotting at 390 px rather than trusting the desktop
view.

## Stage 6 output — evaluation

10 hand-written personas × 3 phrasings = **30 utterances**. Ground-truth profiles
are authored, not derived from the system's own output, so extraction accuracy is
a genuine measurement rather than a tautology.

### Extraction (measurable today)

```
                    before   after
plain                90.2%   100.0%
telegraphic          82.0%   100.0%
code_mixed           62.3%   100.0%

wrong values             4        0
ungrounded evidence      0        0
```

**Read that 100% with the caveat attached.** 30 utterances is a small gold set,
and the lexicon was extended in response to these failures — so this measures
*"the system handles the cases we wrote"*, not *"the system is 100% accurate"*.
The honest claim is that the known failure modes are fixed and pinned. Growing
the gold set is what would make the number mean more, and it will drop when it
grows.

What matters more than the headline: **zero `wrong` values and zero `spurious`
ones.** Every failure the harness found along the way was fixed into a `missed`
or eliminated. A missing field makes a constraint UNKNOWN and caps the verdict at
`likely_eligible`; a wrong field produces a confident verdict built on a false
fact. The harness scores those separately for exactly that reason.

### Four bugs the harness found

1. **"village" contains "age".** The age cue matched inside it, so
   `"farmer, 33, telangana, 1.5 acres, obc, village, income 1.5 lakh"` reported
   the citizen's age as **1**. Word boundaries added.
2. **`"income 40000"` was not money.** Money detection needed a currency symbol
   or a lakh/crore word, so a bare figure after "income" went unrecognised — and
   was then free to be mistaken for an age. Income words added as money markers.
3. **Class number taken from the wrong place.** `"student, 14, odisha, class 9"`
   scanned a window, hit the age 14 first, rejected it as out of range and gave
   up. Now takes the number *adjacent* to the keyword.
4. **A bare age at the start of a line.** `"34, maharashtra, village, …"` has no
   preceding comma; start-of-string now counts as a boundary.

### Two defects in the gold set itself

Worth recording, because a harness that only ever blames the system is not doing
its job. Two `code_mixed` phrasings silently omitted facts their sibling
phrasings stated — income in one, gender in the other — so the harness reported
extraction misses that were really authoring errors. Both phrasings were
corrected and the corrections are recorded in `personas.json` under
`gold_set_corrections`.

### Scheme matching (NOT measurable yet)

The harness reports `status: not_measurable` and says why, rather than printing a
number that looks like an accuracy claim:

> No clause in the corpus has been approved by a human, so the rule engine cannot
> produce an eligible verdict for anyone. Scheme metrics would all be zero and
> would measure the empty annotation backlog, not the system.

Even in `--simulate` mode it still refuses, for the second reason: no persona has
human-validated `expected_schemes`. Both gates have to open.

### Why precision and recall, never accuracy

A citizen qualifies for perhaps 10 of 2,066 schemes. A system returning nothing
scores **~99.5% accuracy** while being useless. That majority-class baseline is
computed and printed next to every result so the comparison is visible rather
than something a reader has to work out.

The tuning target is **F2, not F1** — it weights recall twice as heavily as
precision. A missed entitlement costs a citizen money they were owed; a false
positive costs them an application. Tuning on F1 would silently trade away the
error that matters.

## Added after the six stages

### Reviewer sign-in

```bash
npm run reviewer:add -- yourname     # password read from stdin, never echoed
```

Then open `/en/login`. It gates `/en/reviewer` (the annotation dashboard) and
nothing else.

**Citizens never log in.** The brief said no signup wall, and the login page says
so itself, with a link straight back to the search. Reviewers do, because
approving a clause is the act that decides who gets money — `approved_by` is
worthless if anyone can write any name into it.

Passwords: scrypt (N=2^15), per-user random salt, constant-time comparison.
Sessions are bearer tokens stored only as SHA-256. Sign-in fails identically for
"no such user" and "wrong password", so the endpoint cannot enumerate accounts.
Changing a password revokes every session. Seven tests cover this, including one
that greps the user file to prove no plaintext password and no raw token ever
lands on disk.

One bug those tests caught before it reached a machine: scrypt at these
parameters needs ~32 MiB, which is exactly Node's default `maxmem`, so every
account creation threw `ERR_CRYPTO_INVALID_SCRYPT_PARAMS` until the ceiling was
raised.

### AI explanations — and what they cannot do

A language model rewrites the engine's verdicts as plain sentences. It is bounded
so the project's central rule survives contact with it:

| The model cannot | Enforced by |
|---|---|
| **Add** a scheme | output keyed by `scheme_id`; unknown ids discarded |
| **Remove** a scheme | a missing sentence falls back to deterministic text |
| **Change** a verdict | verdicts render from the engine's field; model text is never parsed for one |
| **Invent** a clause | clause text is quoted from the corpus by the UI |
| **Inject** markup or links | stripped before render |

So the worst a hallucinating, failing or prompt-injected model can do is produce
a badly worded sentence beside a correct verdict. Eleven tests simulate exactly
those failures, including a model that insists the citizen is ineligible when the
engine said otherwise.

**The citizen's raw text is never sent to a model** — only the structured facts
the engine already used. Sending "I am a widow with no land" to a third-party API
would put that on someone else's server for no gain.

Configure with `GEMINI_API_KEY`, `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` (see
`.env.example`). With no key the app falls back to deterministic wording and runs
fully offline. The footer always discloses which model wrote the wording, or that
none did.

Explanations are fetched **after** results render, on a separate endpoint, so a
slow or missing model never delays the answer a citizen came for.

### Voice input

- `continuous` recognition with interim results, restarted automatically when the
  browser cuts it off at the first pause
- stops after **6 seconds** of real silence rather than the browser's ~2, so
  nobody is cut off mid-thought; a 2-minute ceiling stops a forgotten microphone
- **searches automatically** once speech ends — no button to find afterwards
- live transcript while listening, and the microphone is released if the page
  goes away

### Verdict wording

The engine's reasons were machine-shaped — *"your occupation is farmer, which is
includes farmer"*, repeated three times. Field names now read as words, numeric
and categorical comparisons use different sentence shapes, and duplicate reasons
are collapsed:

```
You qualify because your age (33) is at least 18, and your age (33) is at
most 60, and your work is farmer, as this scheme requires.

You do not qualify: your category is obc, but this scheme requires one of sc or st.
```
