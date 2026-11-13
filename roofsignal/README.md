# RoofSignal

Lead generation for home services (roofing first). It finds homes likely to need work,
qualifies homeowners through the call center, and sells each qualified lead to one
licensed contractor. This folder is self-contained and separate from the DataValue app
in the rest of this repository.

- [ARCHITECTURE.md](ARCHITECTURE.md): design, data model, phased plan, paid-service estimates
- [COMPLIANCE.md](COMPLIANCE.md): items for legal review (not legal advice)

**Status:** Phase 1 done. Parcels, permits and storms are ingested, scored, exported as
mail batches and viewable in the admin UI. Every paid provider is mocked.

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
cp .env.example .env            # set ADMIN_API_TOKEN
cp web/.env.example web/.env    # same ADMIN_API_TOKEN + ADMIN_BASIC_USER / ADMIN_BASIC_PASSWORD
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

# API + admin UI
uv run uvicorn roofsignal.api.main:app --port 8000
cd web && npm install && npm run dev                      # http://localhost:3000 (Basic auth)
```

Background jobs (`src/roofsignal/jobs/tasks.py`) run with `rq worker roofsignal`, e.g.
a daily `refresh_storms` followed by `rescore`.

## Tests

```bash
uv run pytest                    # integration tests need a PostGIS DB: TEST_DATABASE_URL (default roofsignal_test)
uv run pytest --cov=roofsignal
cd web && npm run typecheck && npm run lint
```

## Paid providers

All mocked. `roofsignal spend status` shows spend. A paid provider runs only when
`PAID_PROVIDERS_ENABLED=true`, it is listed in `APPROVED_PROVIDERS`, and an owner has
recorded an approval with `roofsignal spend approve --to <usd> --by <name>`. Each approval
can extend at most $5 past actual spend.
