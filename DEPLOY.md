# Deploying YojanaMitra

The app is a single container. The only thing it needs from the platform is a
**persistent volume mounted at `/data`**.

---

## The one decision that matters

There are two kinds of data here and they are handled differently.

| | Lives | Why |
|---|---|---|
| **Corpus** — 17MB of normalised schemes, plus `provenance.json` | Baked into the image at `/app/corpus` | Read-only, identical on every instance, never changes between deploys |
| **State** — reviewer accounts, citizen accounts, invite codes, clause approvals | Volume at `/data` | Must survive a redeploy |

Both used to sit under `data/`. Mounting a volume there to keep the accounts
alive would **shadow the corpus baked into the image**, and the app would boot
with zero schemes, answer every citizen with "nothing matched", and report
itself healthy. `/api/health` checks for exactly this and returns `503` when the
corpus is unreadable — wire your platform's health check to it.

---

## Local

```bash
docker compose up --build
```

→ http://localhost:5173

State lives in the named volume `ym-state`. `docker compose down` keeps it;
`docker compose down -v` destroys it, including every reviewer account.

## Render

The repo carries `render.yaml`, so a Blueprint deploy picks everything up:

1. New → Blueprint → point at the repo.
2. Confirm the disk: **1GB mounted at `/data`**. Without it, accounts and
   approvals vanish on every deploy.
3. Health check path is already set to `/api/health`.

## Railway

```bash
railway up
```

Then in the service settings:

- **Volume** → mount path `/data`
- **Variables** → `YM_STATE_DIR=/data`, `YM_SIMULATE=1`
- **Healthcheck path** → `/api/health`

Railway injects `PORT`; the image already reads it.

## Fly.io

```bash
fly launch --no-deploy
fly volumes create ym_state --size 1
```

In `fly.toml`:

```toml
[[mounts]]
  source = "ym_state"
  destination = "/data"

[env]
  YM_STATE_DIR = "/data"
  YM_SIMULATE = "1"

[http_service]
  internal_port = 3000

[[http_service.checks]]
  path = "/api/health"
```

```bash
fly deploy
```

---

## Environment

| Variable | Default | Notes |
|---|---|---|
| `YM_STATE_DIR` | `/data` | The volume. Accounts, invites and annotations. |
| `YM_CORPUS_DIR` | `/app/corpus` | Baked in. Do not mount over it. |
| `YM_PROVENANCE_FILE` | `/app/corpus/provenance.json` | Baked in. |
| `YM_SIMULATE` | unset | `1` treats proposed constraints as approved, **in memory only**, so the site demonstrates the pipeline. Every verdict carries a DEMONSTRATION MODE badge. Never writes to the annotations file. |
| `PORT` | `3000` | Set by most platforms automatically. |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | unset | Optional. Only ever used to *word* an explanation. With no key, explanations fall back to deterministic text and the app runs fully offline. **Eligibility is never decided by a model.** |

---

## First run

Reviewer signup is open exactly once — while zero reviewers exist.

1. Open `https://<your-host>/en/signup`.
2. Create the first account. Use your real name: it is stamped on every clause
   you approve.
3. The door now closes. Further reviewers need a single-use invite code, issued
   from the reviewer dashboard.

If you would rather not have that window open on a public URL at all, create the
first account before exposing the service:

```bash
docker compose run --rm yojanamitra npm run reviewer:add -- yourname
```

---

## What a fresh deployment actually decides

With `YM_SIMULATE=1`: proposed constraints are treated as approved, so the site
returns real matches and demonstrates the whole pipeline. Every card says
DEMONSTRATION MODE. **Do not quote these as accuracy figures.**

With it unset and an unreviewed annotation file: the engine decides nothing and
every citizen is told so. That is correct behaviour, not a bug — a clause only
becomes decisive when a named reviewer approves it. Working the queue at
`/en/reviewer` is what changes it.

---

## Not indexable, on purpose

`src/app/layout.tsx` sets `robots: { index: false, follow: false }`.

This site carries the visual conventions of a public-service portal and answers
questions about real entitlements. Someone searching for the official service
should not land here by accident and mistake a demonstration verdict for a
government decision. Remove the directive only once the annotation backlog is
genuinely reviewed and the site is meant to be found.

---

## Backups

Everything irreplaceable is in the volume:

```
/data/auth/reviewers.json     password hashes, session hashes
/data/auth/citizens.json      optional citizen accounts and saved profiles
/data/auth/invites.json       hashed invite codes
/data/annotations/clauses.json  the reviewed corpus — the actual work
```

`clauses.json` is the one that represents human hours. Back it up before any
migration.

```bash
docker compose exec yojanamitra tar cz -C /data . > ym-state-$(date +%F).tar.gz
```
