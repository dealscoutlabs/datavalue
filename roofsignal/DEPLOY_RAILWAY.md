# Deploy RoofSignal to Railway: hand-off brief

Paste this file into a Claude session that has Railway access (Railway CLI plus a token). It is written for that
session.

## Goal

Replace the site in Railway project **`home-care-ranking`** (environment `production`, service **`web`**,
currently `web-production-b9a6f.up.railway.app`) with RoofSignal, then change the domain.

- **Code:** GitHub `dealscoutlabs/datavalue`, branch **`claude/admiring-babbage-haix2n`**, folder **`roofsignal/`**.
  The work is in PR #1, which hasn't been merged, so deploy from that branch. Only merge to `main` if the owner says so.
- **Warning:** pointing the `web` service at RoofSignal takes the current home-care-ranking site offline.
  The owner has asked for that.
- **Open question:** the domain. Ask the owner which one. It's either a renamed Railway subdomain (Service →
  Settings → Networking → edit the `*.up.railway.app` name) or a custom domain they own (add it there, then
  create the CNAME record Railway shows at their DNS provider).

## Target layout (3 services in the project)

| Service | Source | Notes |
|---|---|---|
| `db` | Docker image `postgis/postgis:16-3.4` | **Must be PostGIS.** Railway's standard Postgres may lack it; check `CREATE EXTENSION postgis` works. Attach a volume at `/var/lib/postgresql/data` (≥ 10 GB). Vars: `POSTGRES_USER=roofsignal`, `POSTGRES_PASSWORD=<random>`, `POSTGRES_DB=roofsignal`, `PGDATA=/var/lib/postgresql/data/pgdata`. |
| `api` | repo above, branch above, **root directory `roofsignal`** | Builder: Dockerfile (`roofsignal/Dockerfile`). Pre-deploy command: `alembic upgrade head`. Healthcheck: `/health`. Private networking only; no public domain needed. |
| `web` (existing) | change source to the repo above, same branch, **root directory `roofsignal/web`** | Railpack (Node 22). Build `npm run build`, start `npm run start` (binds `$PORT`). Public domain. |

Redis and the RQ worker are optional for now (background refresh jobs only). Leave them out to keep the cost
down (≈ $10–25/mo trimmed, vs ≈ $30–100/mo with everything).

## Variables

`api`:
```
DATABASE_URL=postgresql+psycopg://roofsignal:<password>@db.railway.internal:5432/roofsignal
SERVICE_API_TOKEN=<long random string, e.g. python -c "import secrets;print(secrets.token_urlsafe(32))">
LANDING_BASE_URL=https://<the web domain>
DATA_CACHE_DIR=/tmp/roofsignal-cache
PAID_PROVIDERS_ENABLED=false
TELEPHONY_PROVIDER=mock
IMAGERY_PROVIDER=mock
LINE_TYPE_PROVIDER=mock
```
`web`:
```
ROOFSIGNAL_API_URL=http://api.railway.internal:<api PORT, e.g. 8080>
SERVICE_API_TOKEN=<same value as api>
NODE_ENV=production
```
Remove the old home-care-ranking variables from `web` that RoofSignal doesn't use.

## Load the data (once, after `api` is up)

Run these inside the api service (`railway ssh --service api`, or as one-off commands). The full load takes
about 1–2 hours and needs outbound internet, which Railway has.

```bash
roofsignal parcels load suffolk_ny                    # ~451k parcels, NYS public service
roofsignal storms load suffolk_ny --months 13
roofsignal score suffolk_ny
roofsignal parcels fetch dallas_tx                    # ~280 MB of DCAD downloads (resumable)
roofsignal parcels load dallas_tx                     # ~590k parcels
roofsignal permits fetch dallas_tx                    # City of Dallas permits
roofsignal storms load dallas_tx --months 13
roofsignal score dallas_tx
roofsignal prune-runs                                 # keep only the latest scoring run (database ~3 GB)
roofsignal users create <owner email> --name "<Owner>" --role admin      # prints a one-time password
roofsignal dnc seed-mock                              # TEST ONLY: mock scrub lists; work only while telephony is mocked
```

If the container's disk is small, set `DATA_CACHE_DIR` to a path on a volume.

## Verify

- `https://<domain>/get-estimate` loads (homeowner form).
- `https://<domain>/login`, then sign in as the admin; `/admin` shows Suffolk and Dallas with tier counts.
- `/admin/compliance` shows decisions after a test form submission.
- `curl` to the api's public URL (if any) without `X-Service-Token` returns 401.

## Rules that still apply

- No paid or metered service (telephony, lookups, imagery, SMS) without the owner's explicit approval and a cost
  estimate. Each $5 of spend needs a recorded approval (`roofsignal spend approve`).
- Never use Google Maps/Earth imagery.
- Don't load real phone numbers into the call queue except through the compliance gate (the app enforces this).
- The admin pages show owner names and addresses: keep them behind login, and don't share the admin password in
  chat.
