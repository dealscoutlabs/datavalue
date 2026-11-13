# RoofSignal — Architecture & Phased Plan

**Status:** Phase 1 (ingestion, scoring, mail export) and Phase 2 (compliance
gate, consent capture, call center) are built. Pilot counties: Suffolk NY and
Dallas TX, with Nassau NY configured to load from a file. See §12 for decisions
made after review and §13 for Phase 2 notes. No paid service has been signed up
for or called.

RoofSignal finds homes likely to need roof work (HVAC and driveways later). It
reaches homeowners mainly through direct mail and door hangers. Its Philippines
call center qualifies the homeowners who respond, and it sells each qualified
lead to exactly one licensed local contractor.

**What RoofSignal does not do:** it does not perform, broker, schedule-and-manage
or warrant any work. It sells leads.

---

## 1. Guiding rules (from the brief, enforced in code where possible)

| Rule | How the system enforces it |
|---|---|
| No paid/metered call without approval | Every paid provider sits behind an adapter. The **mock is the default**. A live adapter can only be built through a factory that checks `SpendGuard` (§6). It refuses unless that provider is explicitly approved in config and the approved budget isn't used up. Spend is recorded in a ledger and **hard-stops at every $5 of cumulative spend** until the budget is raised by a human. |
| No Google imagery or scraping | Imagery goes only through `ImageryProvider` adapters (Mock, then Nearmap/EagleView-style licensed providers). A CI test fails if any Google Maps/Earth host or SDK appears anywhere in the backend. |
| TCPA/DNC is a gate | The `compliance` package is the **only** code allowed to create a `CallQueueItem` (enforced by a DB constraint plus a code-level check). It **fails closed**: missing data, stale data or a provider error means BLOCK. Every decision is written to an append-only log with reason codes. |
| Inbound-first | The default funnel is mail → tracked phone number or landing page → consent capture → qualification. Outbound is a secondary queue fed only by the gate. |
| Never claim "we saw damage" | Agents never see imagery scores or imagery reason codes. Scripts are templates with only neutral triggers (a storm reported in the area, roof age estimated from public records). A test fails if banned phrases appear in any script or mail template. |

---

## 2. System overview

```
                    ┌──────────────────────── Ingestion (Phase 1) ────────────────────────┐
 County adapters ──►│ parcels ─┐                                                           │
 Permit adapters ──►│ permits ─┼─► properties (PostGIS) ─► signal adapters ─► scoring ─►   │──► tiers + reason codes
 Storm adapters  ──►│ storms ──┘        storm_swaths (PostGIS polygons)                     │
 Imagery (mock)  ──►│                                                                       │
                    └───────────────────────────────────────────────────────────────────────┘
                                             │
                                             ▼
                    Outreach: campaign → mail batch CSV (tracking code, tracked phone #) → print vendor
                                             │
                     homeowner calls tracked #     or      visits landing page (/r/{code})
                                             │                     │ consent form (exact disclosure text,
                                             ▼                     ▼  timestamp, IP, UA stored)
                    ┌───────────────── Compliance gate (Phase 2) ──────────────────┐
                    │ DNC (national, state, internal) · litigator · line type +    │
                    │ consent · calling hours (local TZ) · state rules · freq caps │
                    └────────────────────────────┬─────────────────────────────────┘
                                                 ▼  ALLOW only
                    Call center app: queue → script → qualification → disposition
                                                 │ qualified
                                                 ▼
                    Marketplace (Phase 3): match by ZIP + trade + doc validity → exclusive assignment
                    → delivery (email / signed webhook) → Stripe charge (test mode) → dispute/refund
                                                 │
                                                 ▼
                    Dashboard (Phase 4): funnel per campaign, CPL, RPL, contractor performance
```

### Processes (Docker Compose)

| Service | Purpose |
|---|---|
| `db` | Postgres 16 + PostGIS 3 |
| `redis` | job queue broker |
| `api` | FastAPI app: JSON API (Python domain logic, scoring, compliance) |
| `web` | Next.js app: admin, agent and contractor UIs, landing pages |
| `worker` | RQ worker for ingestion, scoring, mail batch export, lead delivery, document expiry sweeps |
| `scheduler` | rq-scheduler for cron-style jobs (DNC refresh check, doc expiry, storm pulls) |
| `mailpit` | local SMTP catcher. No real email leaves the machine in dev. |

**Queue choice:** RQ, not Celery. The jobs are simple and idempotent, RQ needs
less configuration, and it can be swapped out later if needed.

**UI choice:** **Next.js 16 (App Router, React Server Components) + Tailwind 4**,
matching the other apps in this repository. It lives in `web/` and talks to the
FastAPI backend server-side only. The API token never reaches the browser. Until
Phase 2's role-based accounts, admin pages sit behind a Basic-auth gate that is
checked in `proxy.ts` and again in the data layer.

---

## 3. Repository layout

```
roofsignal/
  ARCHITECTURE.md  COMPLIANCE.md  README.md
  docker-compose.yml  .env.example  pyproject.toml  alembic.ini
  config/
    scoring.yaml              # weights, tier cutoffs, per trade
    counties/nassau_ny.yaml   # adapters + source URLs + jurisdictions for a county
    compliance/rules.yaml     # calling windows, state rules, freq caps (versioned)
    scripts/roofing_v1.md     # agent script template (neutral triggers only)
    disclosures/consent_v1.txt# exact consent text shown on landing page (versioned, hashed)
  src/roofsignal/
    core/          settings, logging, SpendGuard, clock (injectable for tests)
    db/            SQLAlchemy models, session, PostGIS types
    adapters/      ports (abstract base classes) + implementations, grouped by kind:
      parcels/     nassau_ny.py, csv_import.py
      permits/     csv_import.py, viewpoint_export.py, (per-jurisdiction)
      storms/      noaa_storm_events.py, spc_reports.py, mrms_mesh.py
      imagery/     mock.py, (nearmap.py, eagleview.py, written later, disabled by default)
      telephony/   mock.py, (twilio.py, disabled by default)
      dnc/         ftc_file.py (file-based national DNC), internal.py, state_lists.py, mock.py
      litigator/   mock.py, (vendor adapter, disabled)
      linetype/    mock.py, (vendor adapter, disabled)
      email/       smtp.py (Mailpit in dev)
      payments/    stripe_test.py, mock.py
    ingestion/     jobs to load parcels, permits, storms
    signals/       storm.py, roof_age.py, imagery.py → SignalResult
    scoring/       weighted scorer, tiers, reason codes
    compliance/    STANDALONE package: no FastAPI, no SQLAlchemy imports (see §7)
    outreach/      campaigns, mail batch CSV, tracking codes, landing pages, consent capture
    callcenter/    queue, script rendering, qualification, dispositions
    marketplace/   contractors, service areas, matching, assignment, delivery, disputes
    billing/       Stripe integration (test mode), refunds/credits
    dashboard/     funnel queries, materialized views
    api/           FastAPI routers
  migrations/      Alembic
  web/             Next.js 16 app (admin now; agents, contractors, landing pages later)
  tests/
    compliance/    near-100% branch coverage, property-based tests (hypothesis)
    fixtures/      sample parcels, permits, storm CSVs, DNC files, all synthetic or public
```

---

## 4. Data model

Postgres + PostGIS. All timestamps are `timestamptz` in UTC. All geometry is
SRID 4326, with an EPSG:2263 (NY State Plane, feet) column added when we need
distance calculations. Primary keys are UUIDs. Every table has
`created_at`/`updated_at`.

### 4.1 Properties & signals (Phase 1)

| Table | Key columns | Notes |
|---|---|---|
| `county` | `fips`, `name`, `state`, `config_key` | Pilot: `36059` Nassau NY. Each county gets its own adapters via `config/counties/*.yaml`. |
| `jurisdiction` | `county_id`, `name`, `kind` (town/city/village), `geom` | Permit-issuing body. In Nassau, building permits are issued by **3 towns, 2 cities and ~64 villages**, not the county (§9 risk 1). |
| `property` | `county_id`, `parcel_id` (county SBL), `geom` (parcel polygon), `centroid`, `site_address`, `zip`, `property_class`, `year_built`, `owner_name`, `owner_mailing_address`, `owner_occupied_guess`, `source`, `source_version` | Residential classes only (NY class 200s). Owner name and mailing address come from the assessor roll. |
| `permit` | `property_id` (nullable until matched), `jurisdiction_id`, `permit_no`, `issued_on`, `work_type_raw`, `work_category` (roof/hvac/driveway/other), `match_method`, `match_confidence` | Raw description kept. Categorized by a rules-based classifier (no LLM). |
| `storm_event` | `source` (storm_events/spc/mrms), `source_id`, `event_type` (hail/wind), `magnitude` (inches or mph), `occurred_at`, `geom` (point or polygon) | Raw events as reported. |
| `storm_swath` | `storm_event_ids[]`, `event_type`, `magnitude`, `occurred_at`, `geom` (polygon) | Built from points: buffer the point reports, or threshold MRMS MESH ≥ 25.4 mm. Buffer radii are set in config. |
| `signal_result` | `property_id`, `signal` (storm/roof_age/imagery), `trade`, `value`, `normalized` (0–1), `reason_codes[]`, `evidence` (jsonb), `adapter`, `computed_at` | One row per property × signal × run. |
| `score` | `property_id`, `trade`, `score` (0–100), `tier` (A/B/C/D), `reason_codes[]`, `weights_version` (hash of scoring.yaml), `run_id` | Every score can be traced to its inputs. |
| `scoring_run` | `county_id`, `trade`, `config_hash`, `started_at`, `stats` | |

**Reason code examples:** `STORM_HAIL_GE_1IN_LAST_12MO`, `STORM_WIND_GE_58MPH_LAST_12MO`,
`ROOF_AGE_FROM_PERMIT_GE_20Y`, `ROOF_AGE_FROM_YEAR_BUILT_GE_20Y` (lower confidence),
`ROOF_PERMIT_WITHIN_5Y` (negative), `IMAGERY_SCORE_LOW` (**internal only; never shown to agents**),
`NO_PERMIT_DATA_JURISDICTION`.

### 4.2 People, consent, compliance (Phase 2)

| Table | Key columns | Notes |
|---|---|---|
| `contact` | `property_id` (nullable), `first_name`, `last_name`, `email`, `source` (inbound_call/web_form/mail_response/purchased) | A person, not a property. |
| `phone_number` | `e164` (unique), `contact_id`, `line_type`, `line_type_checked_at`, `line_type_source`, `carrier` | |
| `consent_record` | `phone_number_id`, `contact_id`, `kind` (PEWC/verbal_callback_request), `disclosure_version`, `disclosure_text` (full text, copied), `disclosure_sha256`, `captured_at`, `ip`, `user_agent`, `page_url`, `form_payload` (jsonb), `seller_names_disclosed[]`, `revoked_at`, `revocation_channel`, `revocation_note` | **Append-only.** Revoking sets `revoked_at` through a dedicated function. The row is never deleted. |
| `internal_dnc` | `e164`, `added_at`, `reason`, `source` (agent/inbound_request/complaint/admin) | Never expires unless an admin removes it with a logged reason. |
| `dnc_dataset` | `kind` (national/state:XX/litigator), `area_codes[]`, `downloaded_at`, `record_count`, `sha256` | Tracks how fresh each list is. The gate refuses data older than 31 days. |
| `dnc_entry` | `dataset_id`, `e164` | Bulk-loaded. Indexed. |
| `compliance_decision` | `e164`, `purpose` (queue_insert/dial), `decision` (ALLOW/BLOCK), `checks` (jsonb array: `{check, result, reason_code, detail, data_version}`), `ruleset_version`, `evaluated_at`, `evaluated_local_time`, `recipient_tz`, `actor` | **Append-only.** A DB trigger rejects `UPDATE` and `DELETE`. |
| `call_queue_item` | `phone_number_id`, `contact_id`, `queue` (inbound_callback/outbound), `compliance_decision_id` (**NOT NULL, FK**), `not_before`, `expires_at`, `status`, `assigned_agent_id` | Cannot exist without an ALLOW decision. The decision is checked again at dial time. |
| `call` | `queue_item_id`, `agent_id`, `direction`, `provider_call_sid`, `started_at`, `ended_at`, `recording_disclosed`, `dial_time_decision_id` | |
| `disposition` | `call_id`, `code` (enum, see §8), `notes` | |
| `qualification` | `call_id`, `contact_id`, `property_id`, `homeowner_confirmed`, `roof_concern` (enum + free text), `timeline` (enum), `insurance_claim_interest` (enum), `best_appointment_window`, `trade` | |

### 4.3 Outreach (Phase 1 export, Phase 2 landing page)

| Table | Key columns |
|---|---|
| `campaign` | `name`, `county_id`, `trade`, `channel` (direct_mail/door_hanger), `tier_filter`, `tracking_phone_number`, `cost_cents` (print + postage, entered manually), `status` |
| `mail_piece` | `campaign_id`, `property_id`, `tracking_code` (unique, short, no ambiguous characters), `exported_at`, `batch_id` |
| `tracking_number` | `e164`, `campaign_id`, `provider`, `monthly_cost_cents` |
| `inbound_touch` | `campaign_id`, `mail_piece_id` (nullable), `channel` (call/web), `occurred_at`, `contact_id` |

### 4.4 Marketplace & billing (Phase 3)

| Table | Key columns | Notes |
|---|---|---|
| `contractor` | `legal_name`, `dba`, `status` (pending/active/suspended), `stripe_customer_id`, `delivery_email`, `webhook_url`, `webhook_secret` (encrypted) | |
| `contractor_license` | `contractor_id`, `authority` (e.g. Nassau County Office of Consumer Affairs), `license_no`, `expires_on`, `verified_by`, `verified_at`, `document_path` | |
| `insurance_certificate` | `contractor_id`, `carrier`, `policy_no`, `coverage_type`, `expires_on`, `verified_by`, `document_path` | |
| `contractor_trade` | `contractor_id`, `trade` | |
| `service_area` | `contractor_id`, `zip`, `trade`, `price_cents`, `active`, `daily_cap` | |
| `lead` | `qualification_id`, `property_id`, `contact_id`, `trade`, `status` (available/assigned/delivered/disputed/refunded/expired), `fulfillment_mode` (enum, **only `lead_sale` for now**), `quality_snapshot` (jsonb) | |
| `lead_assignment` | `lead_id`, `contractor_id`, `price_cents`, `assigned_at`, `status` (active/returned/refunded) | **Partial unique index on `lead_id WHERE status='active'`** makes exclusivity a database guarantee, not just application logic. |
| `lead_delivery` | `assignment_id`, `channel` (email/webhook), `attempt`, `status`, `response_code`, `sent_at` | Retries with backoff. Webhooks are signed with HMAC-SHA256. |
| `charge` | `assignment_id`, `stripe_payment_intent_id`, `amount_cents`, `status`, `mode` (test/live) | `mode=live` refused until approved. |
| `dispute` | `assignment_id`, `reason` (enum: wrong_number, not_homeowner, no_interest, duplicate, outside_area, other), `evidence`, `status`, `decided_by`, `decision_note` | Must be filed within a configurable window (e.g. 72 h). |
| `refund` | `dispute_id`, `kind` (stripe_refund/credit), `amount_cents`, `stripe_refund_id` | |

**Future "managed job" mode:** `lead.fulfillment_mode` exists, and the
`lead_assignment` relationship can later carry a `job` table (scope, price,
milestones, payout). Nothing about a job exists yet: no table, no route, no UI,
and nothing about `lead_sale` depends on one.

### 4.5 Auth & audit

`user` (`email`, `password_hash` argon2, `role` admin/supervisor/agent/contractor,
`contractor_id`, `mfa_secret`), `session`, and `audit_log` (actor, action,
entity, before/after diff). Agent screens mask contact data that the current
task doesn't need.

---

## 5. Phase 1 data sources (free unless noted)

| Need | Source | Notes / risks |
|---|---|---|
| Parcels + year built + owner | 1) NYS GIS public tax parcels service, **if** Nassau publishes to it. 2) Nassau County Land Records Viewer. 3) FOIL request to Nassau County (Assessment / GIS). | The NYS public layer only includes counties that opt in, and I could not yet confirm Nassau is one (`gis.ny.gov` is blocked by this sandbox's network policy). I won't scrape the LRV in bulk without checking its terms. **Paid fallback:** commercial parcel files, e.g. Report All USA lists Nassau at about **$250 one-time**. That needs your approval. |
| Roofing permits (roof age) | Per jurisdiction: Town of Hempstead (online permit portal), Town of North Hempstead, Town of Oyster Bay, City of Glen Cove, City of Long Beach, ~64 villages. | **No consolidated open dataset found.** Building department records are public under town code and FOIL. Plan: a `CsvImportPermitAdapter` for FOIL responses and portal exports, plus jurisdiction-specific adapters where a clean export exists. Properties with no permit coverage fall back to `year_built` with a lower-confidence reason code. |
| Hail/wind (verified) | NOAA NCEI Storm Events bulk CSVs | Free. Usually published **~2–4 months late**. Point locations exist for hail and thunderstorm wind. |
| Hail/wind (recent) | SPC daily storm reports (CSV) | Free. Preliminary and unfiltered. These are **points**, so swaths come from buffering them (radius in config). |
| Hail swaths | NOAA MRMS MESH (gridded hail size estimates) | Free (NOAA public archive; exact access path to be confirmed in Phase 1). The best "≥ 1 inch" swath source. Thresholding the grid produces polygons. |
| Geocoding / ZIP | US Census Geocoder, Census ZCTA shapes | Free. |
| Time zones | IANA tz database + ZIP→tz fixture | Free, offline. |

**Expectation to set now:** hail ≥ 1" is uncommon on Long Island. In Nassau,
the storm signal will mostly come from thunderstorm wind, and
nor'easter/tropical "High Wind" events, which are zone-level and lack swaths.
Roof age is likely to be the main signal there.

---

## 6. Paid-provider safety: `SpendGuard`

- Settings: `PAID_PROVIDERS_ENABLED=false` (global kill switch),
  `APPROVED_PROVIDERS=` (comma list), `SPEND_APPROVED_BUDGET_USD=0`.
- Each live adapter declares `unit_cost_usd`. Before every billable call it asks
  `SpendGuard.authorize(provider, units)`. The guard writes to
  `spend_ledger` and raises `SpendApprovalRequired` when:
  - the provider isn't approved, or
  - the call would push cumulative spend past `SPEND_APPROVED_BUDGET_USD`.

  You raise the budget in $5 steps, which gives the "pause every $5" behavior.
- Adapter factories return the mock unless all checks pass. Tests assert that
  every adapter in the default configuration is a mock.

---

## 7. Compliance module (Phase 2): design

A standalone package, `roofsignal.compliance`. It is pure Python with no web or
ORM imports. Data access goes through **ports** (interfaces) so the module can be
tested exhaustively with in-memory fakes and an injected clock.

```python
decide(request: GateRequest, ports: Ports, rules: RuleSet, now: datetime) -> Decision
# GateRequest: e164, purpose (QUEUE_INSERT | DIAL), call_kind (OUTBOUND_COLD | CALLBACK_REQUESTED),
#              recipient address (state, zip), consent_ids
# Decision: allowed: bool, checks: list[CheckResult], ruleset_version, recipient_tz, local_time
```

Checks run in this order. **All checks run even after one fails**, so the log
is complete. Any check that can't reach its data or provider returns
`BLOCK/…_UNAVAILABLE`.

| # | Check | BLOCK when… |
|---|---|---|
| 1 | Number validity | Not a valid US E.164 number, or a toll-free/premium/N11 number |
| 2 | Internal DNC | Number is on the internal list |
| 3 | Consent state | Consent required but missing, **revoked**, or the disclosure hash doesn't match the stored version |
| 4 | National DNC | On the registry (unless valid PEWC covers the call), **or the dataset for that area code is ≥ 31 days old**, or that area code isn't in our subscription |
| 5 | State DNC | Recipient state keeps its own list and the number is on it, or that list is stale or missing |
| 6 | Litigator scrub | Number matches the known-litigator list, or the list is stale or missing |
| 7 | Line type | Wireless (or VoIP/unknown, which is treated as wireless) **without a valid, unrevoked PEWC**. Line-type data older than the configured TTL counts as unknown. |
| 8 | Reassigned number (optional, config) | Consent is older than X days and the FCC Reassigned Numbers Database says the number was disconnected since the consent date |
| 9 | Calling hours | Outside the allowed window in **both** the property's local time zone and the area-code time zone (the stricter of the two applies). Federal 8am–9pm, narrowed by state rules (e.g. FL/OK 8am–8pm). Configured holidays and Sundays are excluded where a state requires it. |
| 10 | State rules / frequency | e.g. FL/OK: more than 3 calls in 24 h on the same subject. Also our own global caps per number per day/week. |

Two decisions are taken: one when the number is queued and one when the agent
dials. Calling-hours, revocation and DNC changes made in between are caught at
the dial check. `rules.yaml` is versioned, and its hash is stored on every
decision. **Every state rule value in `rules.yaml` is marked "pending legal
review"** (see COMPLIANCE.md).

**Calling method:** agents dial **manually** (click-to-call, one number at a
time). No predictive dialer, no prerecorded messages, no automated SMS. This is
a deliberate design choice that lowers risk. It is not a legal conclusion.

**Testing:** branch coverage target ≥ 98% (CI fails below 95%). Tests use
hypothesis (property-based) to cover DST transitions (spring-forward and
fall-back hours), numbers whose area code is in a different time zone from the
property (a 212 cell phone in Florida, for example), day 30 vs day 31 data
staleness, revocation one second before dialing, wireless numbers with expired
or revoked consent, provider timeouts, and the guarantee that a BLOCK can never
be turned into an ALLOW by anything other than a fresh evaluation.

---

## 8. Call center app (Phase 2)

- **Queue view:** only `call_queue_item` rows with a live ALLOW decision.
  Callbacks requested by inbound callers rank first.
- **Script panel:** rendered from `config/scripts/roofing_v1.md` with neutral
  variables only: `{storm_type}`, `{storm_date}`, `{area_name}`,
  `{roof_age_estimate}`, `{source_label}` ("public building permit records" /
  "county property records"). The script includes the required identification,
  a recording disclosure (if recording is on), and an offer to add the caller to
  our DNC list.
- **Qualification form:** homeowner confirmed, roof concern, timeline, interest
  in an insurance claim (recorded only; agents give no insurance advice), best
  appointment window.
- **Dispositions:** `QUALIFIED`, `NOT_HOMEOWNER`, `NOT_INTERESTED`, `CALLBACK`,
  `DNC_REQUESTED` (instantly writes `internal_dnc` and revokes consent),
  `WRONG_NUMBER`, `NO_ANSWER`, `VOICEMAIL_NO_MESSAGE`, `LANGUAGE_BARRIER`,
  `ALREADY_HAS_CONTRACTOR`, `HOSTILE`.
- **Telephony:** `TelephonyProvider` port. `MockTelephony` simulates
  ring/answer/busy. A Twilio adapter is written later but stays disabled.

---

## 9. Key risks & open decisions (need your input)

1. **Nassau permit data is split across ~69 building departments and isn't
   published as open data.** Roof-age-from-permit will start sparse. The free
   path is FOIL requests, which are slow (weeks). Options: (a) stay with Nassau
   and accept year-built fallback while FOILs are pending; (b) add a second pilot
   county that publishes open permit data, to prove the pipeline end-to-end.
   **I recommend (a), plus FOILs to the 3 towns first, since they cover most
   homes.**
2. **Nassau parcel data availability.** If the free state service doesn't cover
   Nassau, a one-time purchase of about $250 may be the fastest legitimate source
   (approval needed). Otherwise it's a FOIL.
3. **Network access in this dev sandbox:** some government hosts (`gis.ny.gov`
   so far) are blocked. Pulling real data in Phase 1 needs those hosts added to
   the environment's allowlist. I'll list the exact hosts when I hit them.
4. **Placement:** this lives in `roofsignal/` inside the `datavalue` repository
   (an unrelated Next.js app), because that's the only repository this session
   can write to. A dedicated repo would be cleaner; the folder is self-contained
   and can be moved as-is.

---

## 10. Phased plan

Each phase ends with: tests run, a summary of what works, an updated paid-services
list with monthly estimates, and **a stop for your go-ahead**.

### Phase 1: Ingestion + scoring (real free data, everything paid mocked)
1. Scaffold: Compose (PostGIS, Redis, Mailpit), FastAPI skeleton, settings,
   Alembic, SpendGuard, CI test that blocks Google hosts, `.env.example`.
2. County adapter interface + Nassau config. Parcel adapter (free source chosen
   per §9 risk 2) + CSV import adapter. Residential filter.
3. Permit adapter interface, CSV import adapter, roofing-permit classifier,
   address/parcel matcher with confidence.
4. Storm adapters: NOAA Storm Events, SPC reports, MRMS MESH. Swath builder.
   Spatial join to parcels.
5. Signals: storm, roof age, imagery (mock). Scoring from `scoring.yaml`, tiers,
   reason codes. CLI + admin page listing scored properties with reasons.
6. Mail batch CSV export with tracking codes (campaign stub) for testing with a
   print vendor.
- **Done when:** for Nassau (or the sample available), `make ingest && make score`
  gives tiered properties with reason codes; tests pass.

### Phase 2: Compliance gate + call center
1. `compliance` package with ports, rules.yaml, full test suite (coverage gate).
2. Adapters: FTC DNC file loader (file-based; real download only after SAN
   registration, which you'd do), internal DNC, state lists (file), litigator
   (mock), line type (mock), RND (mock).
3. Landing page `/r/{code}` + consent form (versioned disclosure, IP, UA,
   timestamp, exact text). Revocation endpoints and keywords.
4. Agent UI: login/RBAC, queue, script, qualification, dispositions, notes;
   mock telephony; dial-time re-check.
- **Done when:** a mailed tracking code → web form → consent → queue → call
  (mock) → qualified lead works end-to-end, and every blocked path shows a reason.

### Phase 3: Marketplace + billing
Contractor onboarding (license/insurance docs, admin verification, auto-suspend
on expiry), service areas/trades/prices, matching + exclusive assignment
(DB-enforced), delivery via email (Mailpit) and signed webhooks, disputes →
refunds/credits, Stripe **test mode** charges.

### Phase 4: Dashboard
Funnel per campaign (scored → mailed → inbound → qualified → sold → refunded),
cost per lead (campaign cost ÷ qualified), revenue per lead, refund rate,
contractor performance (acceptance, disputes, delivery failures). Summary tables
are rebuilt by a scheduled job. CSV export.

---

## 11. Paid services: expected list (ESTIMATES, verify before approval)

Nothing below is in use. Prices are public list prices I believe to be roughly
current. Treat them as placeholders until you get quotes.

| Service | Needed for | Est. cost | When |
|---|---|---|---|
| FTC National DNC Registry (SAN) | Outbound scrub | **First 5 area codes free**; FY2027 (from Oct 1 2026): $85/area code/yr beyond that, $23,425 max. Nassau = 516 (+ out-of-area cell numbers) | Phase 2 live |
| Line-type lookup (e.g. Twilio Lookup) | Wireless detection | ≈ $0.005–0.01 per lookup | Phase 2 live |
| Litigator scrub (e.g. Blacklist Alliance-type vendor) | TCPA plaintiff scrub | ≈ $100–500/mo or per-query; quote needed | Phase 2 live |
| FCC Reassigned Numbers Database | Consent hygiene | Subscription tiers; quote needed | Phase 2 live (optional) |
| Telephony (Twilio or similar) | Tracking numbers, agent calling | ≈ $1–2/number/mo + ≈ $0.01–0.02/min | Phase 2 live |
| Licensed aerial imagery (Nearmap/EagleView) | Imagery signal (optional) | Enterprise contract, often $thousands+/yr; quote needed | Optional |
| Skip tracing | Phone numbers for outbound | ≈ $0.10–0.25/record | Only if outbound is pursued |
| Transactional email (SES/Postmark) | Lead delivery | ≈ $0.10–1.50 per 1,000 emails | Phase 3 live |
| Stripe | Billing | 2.9% + 30¢ per card charge (no monthly fee) | Phase 3 live |
| Hosting (Postgres + app + worker) | Production | ≈ $30–100/mo | Any live use |
| Parcel data (if not free) | Phase 1 | ≈ $250 one-time (Report All USA list price) | Phase 1, only if needed |
| Print + postage (not an API) | Direct mail | ≈ $0.45–0.90 per postcard | Your vendor |

No LLM is used anywhere in the design.

---

## 12. Decisions after the first review (2026-11-13)

- **Pilot county: Suffolk first, Nassau as target, hail-belt county next.** Nassau is not in
  the free NYS parcel service, which publishes 38 counties. Suffolk is in it and free:
  451,515 residential parcels, with owner name and mailing address on nearly all. Nassau
  stays configured (`config/counties/nassau_ny.yaml`) through the CSV adapter for a FOIL
  or licensed file. Nothing will be bought without approval. A Texas/Colorado county is
  being researched for the next increment.
- **Front end:** Next.js, to match the rest of this repository (see §2).
- **Year built is sparse in Suffolk:** only about 16% of residential parcels have
  `YR_BLT`. Until permit FOILs arrive, most Suffolk properties score `ROOF_AGE_UNKNOWN`.
  This is a data limit, not a bug.
- **No hail of 1" or more near Suffolk in the last 13 months.** The storm signal there is
  thunderstorm wind only (31 qualifying reports, 58–103 mph). MRMS MESH hail swaths are
  deferred to the hail-belt county, where they matter. Decoding GRIB2 adds a dependency
  that is worth it only there.
- **Storm sources overlap:** NOAA Storm Events and SPC often report the same event. The
  signal takes the maximum, so duplicates don't inflate scores, but evidence lists can
  show both reports.
- **Site ZIP gaps:** the NYS feed has no `LOC_ZIP` on 59% of Suffolk parcels. Where the owner
  lives at the property, the owner's mailing ZIP is used instead. About 89k non-owner-occupied
  parcels still have no ZIP. Phase 3 matches contractor service areas by ZIP, so a spatial fill
  from Census ZCTA boundaries is planned before then.
- **Hail-belt candidate: Dallas County, TX** (desk research, not yet verified). The appraisal
  district (DCAD) offers a free bulk appraisal roll and GIS parcels. The City of Dallas
  publishes permits on Socrata and requires a permit for nearly every re-roof. Hail exposure is
  top-tier. Still to verify: DCAD's terms, whether its file has year built, and the permit
  dataset's ID and fields. Hosts needed: `www.dallascad.org`, `www.dallasopendata.com`. City
  permits cover only the City of Dallas, about half the county. Runner-up: Denver, CO.

## 13. Phase 2 as built (2026-11-13)

- **Gate** (`src/roofsignal/compliance`): pure Python, 10 checks, fails closed. 112 tests (including
  property-based invariants) at 100% line and branch coverage. Rule values are in
  `config/compliance/rules.yaml`, and each state entry is marked `legal_review: pending`.
- **Enforced in the database** (migration 0003 triggers):
  - `compliance_decision` and `audit_log` are append-only.
  - `consent_record` can only be revoked, once, and never edited or deleted.
  - A `call_queue_item` needs an ALLOW `queue_insert` decision for the same number from the last 10 minutes.
  - An outbound `call` needs an ALLOW `dial` decision for the same number from the last 2 minutes.
- **Mock data rule:** scrub lists and line-type results from mocks can authorize a call only while telephony is
  mocked, so no real call can rely on fake scrub data. Real datasets always take precedence over mock ones.
- **Auth:**
  - The browser never talks to the API. The Next.js server holds `SERVICE_API_TOKEN` and forwards the staff
    session (httpOnly cookie) as a bearer token.
  - Staff passwords use argon2id. Session tokens are stored as SHA-256 only.
  - Roles: admin, supervisor, agent.
  - `proxy.ts` is an optimistic redirect only. Every server action and data call is authorized by the API.
- **Agent UI:** queue → script (neutral talking points only) → Dial (gate re-check) → disposition +
  qualification. Numbers are masked for agents.
- **Homeowner UI:**
  - `/r/<code>` (mailed tracking code) and `/get-estimate`: a consent form showing the exact disclosure text.
    The server checks the text's hash and stores the full text, IP, user agent and timestamp.
  - `/optout`.
- **Not built yet:** inbound call routing from tracking numbers (it needs a live telephony provider), SMS STOP
  handling (SMS isn't used), and Reassigned Numbers Database lookups (paid; the check exists and stays off until
  a provider is approved).
