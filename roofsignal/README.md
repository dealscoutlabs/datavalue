# RoofSignal

Lead generation for home services (roofing first). It finds homes likely to need work,
qualifies homeowners through the call center, and sells each qualified lead to one
licensed contractor. This folder is self-contained and separate from the DataValue app
in the rest of this repository.

- [ARCHITECTURE.md](ARCHITECTURE.md): design, data model, phased plan, paid-service estimates
- [COMPLIANCE.md](COMPLIANCE.md): items for legal review (not legal advice)
- [START_HERE.md](START_HERE.md): hand-off guide for a new session (status, run, hosting options)
- [DEPLOY_RAILWAY.md](DEPLOY_RAILWAY.md) / [PAID_SERVICES_SETUP.md](PAID_SERVICES_SETUP.md)

**Status:** Phases 1–2 done. Counties: Suffolk NY and Dallas TX (free data), plus Nassau NY
through a file import. Built: ingestion, scoring, mail batches, the compliance gate, consent
capture, and the call-center app. Every paid provider is mocked.

## Layout

```
src/roofsignal/   Python backend (FastAPI API, CLI, ingestion, signals, scoring, outreach)
config/           county configs, scoring.yaml (weights), homeowner copy templates
migrations/       Alembic
tests/            unit (no DB) + integration (PostGIS)
web/              Next.js 16 admin app
```

## Run locally

Prerequisites: Python 3.12+ with [uv](https://docs.astral.sh/uv/), Node 22, Postgres 16
with PostGIS 3, and Redis. Docker Compose starts all of them:

```bash
cp .env.example .env            # set SERVICE_API_TOKEN
cp web/.env.example web/.env    # same SERVICE_API_TOKEN
docker compose up -d db redis mailpit

uv sync
uv run alembic upgrade head

# Pipeline (Suffolk County, NY: free data)
uv run roofsignal parcels count suffolk_ny
uv run roofsignal parcels load suffolk_ny                 # ~450k parcels; add --town Islip for a quick sample
uv run roofsignal storms load suffolk_ny --months 13      # NOAA Storm Events + SPC reports, swaths
uv run roofsignal permits load suffolk_ny --jurisdiction Islip --file islip.csv \
    --columns '{"permit_no":"Permit #","issued_on":"Issue Date","description":"Work Description","address":"Location","zip":"Zip"}'
uv run roofsignal score suffolk_ny
uv run roofsignal mail create suffolk_ny --name islip-nov --tiers A,B --limit 500 --out islip-nov.csv
uv run roofsignal status suffolk_ny

# Dallas County, TX (free DCAD + City of Dallas data)
uv run roofsignal parcels fetch dallas_tx && uv run roofsignal parcels load dallas_tx
uv run roofsignal permits fetch dallas_tx                 # City of Dallas permits (Socrata)
uv run roofsignal storms load dallas_tx && uv run roofsignal score dallas_tx

# Call center setup
uv run roofsignal users create you@example.com --name "You" --role admin
uv run roofsignal users create agent@example.com --name "Agent" --role agent
uv run roofsignal dnc load --kind national --key 631 --file 631.txt --downloaded-at 2026-11-13T09:00-05:00
uv run roofsignal dnc seed-mock            # DEV ONLY: empty mock lists (usable only while telephony is mocked)
uv run roofsignal dnc check "(631) 555-2368" --state NY   # run the gate for one number

# API + web
uv run uvicorn roofsignal.api.main:app --port 8000
cd web && npm install && npm run dev
#   http://localhost:3000/get-estimate   homeowner form      /r/<code>  mailed landing page
#   http://localhost:3000/login          staff sign-in       /agent     call queue
#   /admin (counties, campaigns, compliance log)            /optout    stop calls
```

Background jobs (`src/roofsignal/jobs/tasks.py`) run with `rq worker roofsignal`, e.g.
a daily `refresh_storms` followed by `rescore`.

## Tests

```bash
uv run pytest                    # integration tests need a PostGIS DB: TEST_DATABASE_URL (default roofsignal_test)
uv run pytest --cov=roofsignal
uv run pytest tests/compliance --cov=roofsignal.compliance --cov-branch --cov-fail-under=98   # gate coverage gate
cd web && npm run typecheck && npm run lint
```

## Paid providers

All mocked. `roofsignal spend status` shows spend. A paid provider runs only when
`PAID_PROVIDERS_ENABLED=true`, it is listed in `APPROVED_PROVIDERS`, and an owner has
recorded an approval with `roofsignal spend approve --to <usd> --by <name>`. Each approval
can extend at most $5 past actual spend.
