# RoofSignal: start here (hand-off for a new session)

Give this file to a new Claude session, together with the code (`roofsignal/` folder, or GitHub
`dealscoutlabs/datavalue`, branch `claude/admiring-babbage-haix2n`). Then read ARCHITECTURE.md, COMPLIANCE.md,
PAID_SERVICES_SETUP.md and DEPLOY_RAILWAY.md.

## What it is

RoofSignal is a lead-generation platform for home services, roofing first.
1. Find homes likely to need roof work, using storm reports, roof age and year built.
2. Reach the owners with direct mail or door hangers that carry a tracking code and phone number.
3. The homeowner calls in or fills out a web form, which captures their consent.
4. The Philippines call center qualifies them.
5. RoofSignal sells each qualified lead to one licensed contractor.

RoofSignal does not do or broker the work. A future "managed job" mode is anticipated in the data model but not
built.

## Owner's non-negotiable rules (keep enforcing them)

1. **Cost:** never sign up for or call a paid/metered service (imagery, skip tracing, LLM, telephony, SMS,
   lookups) without stating the cost and getting explicit approval. Pause at every $5 of spend. The code enforces
   this with `SpendGuard` and `roofsignal spend approve`.
2. **No Google Maps/Earth scraping or imagery.** Only licensed imagery providers, mocked by default. A test fails
   the build if Google imagery hosts appear in the code.
3. **TCPA/DNC compliance is a gate.** The gate is `src/roofsignal/compliance`, and database triggers back it up.
   It checks:
   - the national DNC list (data under 31 days old), the internal DNC list, state lists and known litigators;
   - wireless numbers, which are blocked without prior express written consent;
   - local calling hours, state rules and frequency caps.

   Every decision is logged and can't be edited.
4. **Inbound first.** The flow is mail → landing page or phone call (consent stored with its exact text, IP and
   timestamp) → call center. Outbound calls only to numbers that pass the gate.
5. **Never claim "we saw damage."** Only neutral triggers: a public storm report, or roof age / year built from
   public records. A test fails the build on banned wording.
6. COMPLIANCE.md lists the questions for a lawyer. Never present any of it as legal advice.

## Status (2026-11-14)

| Phase | State |
|---|---|
| 1. Parcel, permit and storm ingestion + scoring | **Done.** Suffolk NY (451k homes, free NYS data); Dallas TX (590k homes from DCAD + 258k City of Dallas permits); Nassau NY configured for a CSV/FOIL file |
| 2. Compliance gate + call center app | **Done.** Gate: 112 tests at 100% branch coverage. Landing page with consent, opt-out, staff login, agent queue/script/dial/disposition, compliance log |
| 3. Lead marketplace + Stripe (test mode) | **Not started.** Owner is testing internally first |
| 4. Dashboard | Not started |

- **Tests:** 265 passing (`uv run pytest`; integration tests need PostGIS).
- **Paid services:** all mocked. None signed up for.
- **Scoring:** tier A requires a score of 75 or more (`config/scoring.yaml`).
  - Dallas: 20k A, 81k B, 376k C, 113k D.
  - Suffolk: 2.8k A, 3.8k B, 104k C, 341k D.
- **Storm data:** Suffolk had no qualifying hail in the last 13 months (wind only). Dallas had 55 hail reports up
  to 3".

## Tech

- **Backend:** Python 3.12+ in `src/roofsignal`: FastAPI, SQLAlchemy 2, GeoAlchemy2, Alembic, RQ. Managed with `uv`.
- **Database:** Postgres 16 with **PostGIS 3** (required).
- **Front end:** Next.js 16 in `web/`, matching the rest of the repo. It talks to the API server-side only, using
  `SERVICE_API_TOKEN` plus a staff session cookie. Read `node_modules/next/dist/docs/` before changing Next code;
  this version differs from older training data.
- **Config:**
  - `config/counties/*.yaml`: one file per county.
  - `config/scoring.yaml`: weights and tiers.
  - `config/compliance/rules.yaml`: calling rules, all marked legal review pending.
  - `config/disclosures/`: exact consent text.
  - `config/scripts/`: agent script.

## Run it (local, free)

```bash
cd roofsignal
cp .env.example .env              # set SERVICE_API_TOKEN to a long random string
cp web/.env.example web/.env      # same SERVICE_API_TOKEN; ROOFSIGNAL_API_URL=http://localhost:8000
docker compose up -d db redis mailpit
uv sync && uv run alembic upgrade head

# data (~1-2 hours total; public, free sources)
uv run roofsignal parcels load suffolk_ny && uv run roofsignal storms load suffolk_ny --months 13 && uv run roofsignal score suffolk_ny
uv run roofsignal parcels fetch dallas_tx && uv run roofsignal parcels load dallas_tx
uv run roofsignal permits fetch dallas_tx && uv run roofsignal storms load dallas_tx --months 13 && uv run roofsignal score dallas_tx
uv run roofsignal prune-runs      # keep only the latest scoring run per county (smaller database)

# people + test scrub lists
uv run roofsignal users create you@example.com --name "You" --role admin   # prints a one-time password
uv run roofsignal dnc seed-mock   # TEST ONLY: empty mock lists; only usable while telephony is mocked

# apps
uv run uvicorn roofsignal.api.main:app --port 8000
cd web && npm install && npm run dev      # http://localhost:3000/login and /get-estimate
```

Useful commands: `roofsignal status <county>`, `roofsignal mail create <county> --name X --tiers A --out x.csv`,
`roofsignal dnc check "<phone>" --state NY`, `roofsignal spend status`.

## Hosting options (owner wants it cheap)

Prices are rough estimates; check current pricing. After `prune-runs` the database is about 3 GB.

| Option | Est. cost | Notes |
|---|---|---|
| Owner's own computer | $0 | Fine for internal testing; `docker compose` as above |
| One small VPS (e.g. Hetzner, about 4 GB RAM / 40 GB disk) | ≈ $5–8/mo | Same `docker-compose.yml` plus a reverse proxy with HTTPS (e.g. Caddy). Cheapest option with a link |
| Railway, trimmed (pruned database, no Redis or worker) | ≈ $10–25/mo | See DEPLOY_RAILWAY.md. The owner wanted to replace the `web` service in Railway project `home-care-ranking` and change its domain; ask which domain |

Wherever it runs, the admin pages show owner names and addresses: keep them behind login. Railway build note:
the API image builds from `roofsignal/Dockerfile`, and the web app from `roofsignal/web`.

## Known gaps / next steps

- **Suffolk:** year built is missing on 83% of parcels, and permits are spread across 10 towns and ~33 villages
  with no open data. Fix by FOIL request (CSV loads with `roofsignal permits load`).
- **Nassau:** not in the free state service. Needs a FOIL request or a purchased file (≈$250, owner approval).
- **Dallas suburbs** (Garland, Irving, Mesquite, Grand Prairie, Richardson): no open permit data. Fix by Texas
  Public Information Act requests.
- **Before any real calls:** the paid services in PAID_SERVICES_SETUP.md (the owner does signups and legal
  certifications) and lawyer sign-off on COMPLIANCE.md. The opt-out email in the consent text
  (`optout@roofsignal.example`) is a placeholder.
- **Not built:** inbound call routing from tracking numbers (needs live telephony), MRMS hail-swath grids,
  Phase 3 marketplace and billing, Phase 4 dashboard.
- **Docker image builds weren't verified** in the original sandbox (its proxy broke package downloads). The
  compose file validates. Build the images once.
