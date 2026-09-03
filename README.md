# DataValue

**Know what data your business actually has.**

DataValue connects a small business's cloud services, measures the volume and
broad type of data in them using metadata only, screens that data against a set
of rights and sensitivity questions, and — only where the screening passes —
shows an indicative per-unit licensing rate range.

---

## Why there is no dollar headline

This is the product's central design decision, and it is load-bearing. Read it
before changing any UI.

The deliverable is an **inventory and an eligibility assessment**, not a
valuation. Concretely:

- The dashboard hero shows measured volume, record counts, category mix, date
  range and an eligibility status. **There is no portfolio dollar total** — not
  on the dashboard, not on the report, not anywhere. No function in this codebase
  sums money across sources, and adding one would break the product.
- No dollar figure of any kind renders before the questionnaire is submitted.
- Where a figure does render, it is a **per-unit rate range** ("$X–$Y per GB",
  "$X–$Y per usable record"), shown per source, with the full multiplier chain
  and every input labelled.
- A source whose eligibility status is `REVIEW_REQUIRED` or `LIKELY_INELIGIBLE`
  shows "Rights review required" in place of any rate. Its `ValuationSnapshot` is
  deleted from the database, so there is no stale figure for a UI bug to surface.
- Every screen that shows a rate carries plain-language text, at readable size and
  next to the number, saying these are illustrative reference rates for comparable
  transactions, that the business's own rights have not been verified, and that no
  offer is being made.

The reasoning: **FTC Section 5 deception is assessed on the net impression of a
communication, not on whether a disclaimer was present.** A large dollar figure
with fine-print caveats fails that test regardless of how the caveats are worded,
because the impression the reader takes away is the number. An eligibility-first
product does not have that problem, because the number it leads with is a
measurement it can actually defend.

These properties are enforced by tests, not by convention — see
`tests/e2e/framing.spec.ts` and `tests/unit/valuation.test.ts`.

---

## Quick start

```bash
git clone <repo> && cd datavalue
npm install
cp .env.example .env          # then fill in DATABASE_URL, AUTH_SECRET, ENCRYPTION_KEY
npm run db:migrate
npm run db:seed
npm run dev
```

Then open http://localhost:3000 and click **View demo**.

Generate the two required secrets with:

```bash
openssl rand -base64 32
```

`AUTH_SECRET` signs sessions. `ENCRYPTION_KEY` must decode to exactly 32 bytes
and is the AES-256-GCM key for OAuth credentials at rest. **Rotating
`ENCRYPTION_KEY` makes every stored provider credential permanently
undecryptable** — connections would have to be re-authorized.

### Seeded accounts

| Account | Email | Password |
|---|---|---|
| Demo organisation | `demo@datavalue.example` | `demo-inventory-2026` |
| Platform admin | `admin@datavalue.example` | `admin-inventory-2026` |

Override the admin credentials with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
Change them before any deployment that is reachable from the internet.

---

## Demo mode

The demo organisation has five sources already measured, and it starts with **no
questionnaire response** — which is the honest initial state, so no dollar figure
appears anywhere until you fill the questionnaire in yourself.

It is deliberately seeded so the uncomfortable states are visible:

- **Slack** returns `SCOPE_LIMITED`, because message volume genuinely cannot be
  measured (see Platform Limitations).
- **Microsoft 365, Google Workspace and Slack** all return `REVIEW_REQUIRED` even
  after a perfectly clean questionnaire, because communications corpora
  structurally contain counterparty and employee material.
- **Dropbox and HubSpot** pass the screening, so they are the only two sources
  that ever show a rate.

**The application never simulates a successful OAuth connection.** Demo sources
are created explicitly as demo records, carry `isDemo = true`, are badged
everywhere, and the demo adapter's OAuth methods throw on purpose. A demo
organisation is refused outright by `/api/connect/[provider]/start`.

Developer-only state simulation (re-run scan, force success / scope-limited /
error / expired) appears on the dashboard in development builds. It is not
rendered in a production build, and the server action refuses to run in one.

---

## Provider setup

Every connector requests the narrowest read-only scope its provider offers. None
requests a write, delete or content-download permission.

Redirect URI pattern (shown on each connector's permission screen in-app):

```
{NEXT_PUBLIC_APP_URL}/api/connect/{provider}/callback
```

### 1. Dropbox — fully shippable

1. https://www.dropbox.com/developers/apps → **Create app**
2. Choose API "Scoped access". Access type: "Full Dropbox" (or "App folder" for a
   narrower demo).
3. **Permissions** tab → tick **only** `account_info.read` and
   `files.metadata.read`. Submit.
4. **Settings** tab → OAuth 2 Redirect URIs → add
   `http://localhost:3000/api/connect/dropbox/callback`
5. Copy the App key and App secret into `DROPBOX_CLIENT_ID` /
   `DROPBOX_CLIENT_SECRET`.

| Scope | Why |
|---|---|
| `account_info.read` | Label the connection with the account name/email. |
| `files.metadata.read` | List file names, sizes and dates. Cannot download content. |

Uses PKCE (S256) and `token_access_type=offline` for refresh tokens. Volume comes
from `/2/users/get_space_usage` (exact); counts, types and date range from
recursive `/2/files/list_folder`. No download endpoint is ever called.

### 2. HubSpot CRM — fully shippable

1. https://app.hubspot.com/developer → **Create app**
2. **Auth** tab → Redirect URL:
   `http://localhost:3000/api/connect/hubspot/callback`
3. Scopes: `oauth`, `crm.objects.contacts.read`, `crm.objects.companies.read`,
   `crm.objects.deals.read`, `files`
4. Copy Client ID / Client secret into `HUBSPOT_CLIENT_ID` /
   `HUBSPOT_CLIENT_SECRET`.

| Scope | Why |
|---|---|
| `oauth` | Required by HubSpot on every install. |
| `crm.objects.{contacts,companies,deals}.read` | Count records and measure core-field completeness. |
| `files` | Measure attached-file byte volume. Contents are never fetched. |

Structured records are valued **per usable record**, not per GB. Counts are exact
(from the search endpoint); field completeness is from a bounded sample, and the
UI says so. Record contents are never persisted. HubSpot does not support PKCE on
its public-app flow, so the confidential client secret is used at the token
endpoint. Rate limits (100 requests / 10 s per portal; 4 requests/s on search) are
respected with spacing and exponential backoff.

### 3. Microsoft 365 — shippable with caveats

1. https://entra.microsoft.com → **App registrations** → **New registration**
2. Supported account types: "Accounts in any organizational directory"
3. Redirect URI (Web):
   `http://localhost:3000/api/connect/microsoft/callback`
4. **API permissions** → Microsoft Graph → Delegated: `User.Read`,
   `Files.Read.All`, `Mail.Read`, `offline_access`
5. *Optional:* add `Reports.Read.All` and have a tenant admin grant consent to
   unlock the tenant-wide path.
6. **Certificates & secrets** → new client secret. Fill `MICROSOFT_CLIENT_ID`,
   `MICROSOFT_CLIENT_SECRET`, and `MICROSOFT_TENANT_ID` (`common` for
   multi-tenant).

Two scan paths, detected at runtime from the scopes actually granted:

- **Delegated (default, no admin needed).** `/me/drive` quota for exact OneDrive
  bytes; `/me/mailFolders` for exact per-folder message counts and `sizeInBytes`.
  Where a folder does not report a size, mailbox volume falls back to a bounded
  sample using the `PidTagMessageSize` extended property (a size integer, nothing
  else), and the result is labelled `SAMPLED`. Covers **only the signed-in user's**
  OneDrive and mailbox — stated on every screen that shows the figure.
- **Admin.** Requires `Reports.Read.All`. Uses `getOneDriveUsageAccountDetail` and
  `getMailboxUsageDetail` with `$format=application/json` for tenant-wide volume.
  Handles the tenant setting that pseudonymises identifiers in reports: aggregate
  volumes stay correct, per-account attribution is not available, and the UI says
  so.

`Reports.Read.All` is deliberately **not** included in the default consent
request. Including an admin-consent-only scope there makes the entire consent
screen fail for a non-admin user.

### 4. Google Workspace — demo only in this build

1. https://console.cloud.google.com/apis/credentials → OAuth client ID → Web
   application
2. Authorised redirect URI:
   `http://localhost:3000/api/connect/google/callback`
3. Enable the **Google Drive API** and the **Gmail API**
4. Scopes: `drive.metadata.readonly`, `gmail.metadata`
5. Fill `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`

See **Google: demo-only, not launchable as designed** below.

### 5. Slack — files only

1. https://api.slack.com/apps → **Create New App**
2. **OAuth & Permissions** → Redirect URL:
   `http://localhost:3000/api/connect/slack/callback`
3. Bot Token Scopes: `files:read`, `channels:read`, `users:read`
4. **Do not add `channels:history` or `groups:history`.** See Platform
   Limitations.
5. Fill `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET`

---

## Platform Limitations

These are provider policies, not implementation gaps. They cannot be engineered
around, so the product states them instead of hiding them.

### Google: demo-only, not launchable as designed

`drive.metadata.readonly` and `gmail.metadata` are both **restricted** scopes.

- Launching publicly on a restricted scope requires Google OAuth verification
  **plus** an annual security assessment by a Google-approved third-party assessor
  (CASA). Access must be re-verified and re-assessed at least every 12 months from
  the assessor's Letter of Assessment date.
- Independently of the assessment, **the stated product purpose carries a real
  risk of rejection as a prohibited use case** under Google's API Services User
  Data Policy and its Limited Use requirements, which restrict transferring user
  data obtained through these scopes. A product whose purpose is to assess whether
  a business's data could be licensed to a third party is squarely in the area
  those rules exist to constrain.
- In testing mode the OAuth client supports up to 100 test users. That is enough
  for a demo and nothing more.

The connector's real code paths are implemented and are correct. What is missing
is permission to run them at scale, and no amount of engineering supplies it. The
UI marks Google as **Demo only** and says why.

Two measurement caveats the connector handles explicitly:

- `storageQuota.usage` spans Drive **+ Gmail + Photos**. Deriving a Gmail figure
  by subtraction is approximate, so this app does not use such a figure as a
  headline number and labels the ambiguity where the total appears.
- Google-native documents (Docs, Sheets, Slides) report no ordinary file size
  through the Drive API. They are counted but contribute no bytes, and the count
  is disclosed.

### Microsoft: `Reports.Read.All` is admin-consent-only

Tenant-wide measurement requires a Microsoft 365 administrator to grant
`Reports.Read.All`. Without it — which is the normal case for a self-serve signup
— the scan covers only the signed-in user's own OneDrive and mailbox. The
delegated path is complete and honestly labelled on its own; it is not presented
as a tenant-wide number.

### Slack: message volume is not achievable

As of **29 May 2025**, for apps commercially distributed outside the Slack
Marketplace, `conversations.history` and `conversations.replies` are limited to
**1 request per minute**, with the `limit` parameter capped at **15 objects**.
Existing installations of such apps were brought under the same limits on
**3 March 2026**.

At 15 messages per minute, measuring even a small workspace's message volume
would take months. The app therefore does not attempt it, contains no code path
for it, and does not request `channels:history` at all — requesting a permission
the product cannot use would be worse than not having it. Slack results are always
`SCOPE_LIMITED` and the UI reads "File volume only — message content not
measured."

---

## Architecture

| Concern | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript + Tailwind v4 |
| UI | shadcn-pattern primitives vendored in `src/components/ui`, Radix + CVA |
| Database | PostgreSQL + Prisma |
| App auth | Auth.js v5, credentials + JWT sessions |
| Validation | Zod at every input and provider-payload boundary |
| Charts | Recharts |
| Tests | Vitest (unit), Playwright (E2E, desktop + mobile) |

### The connector contract

Every provider implements `ConnectorAdapter` (`src/lib/connectors/types.ts`):
`getAuthorizationUrl`, `exchangeCode`, `refreshToken`, `scanPage`,
`normalizeMetrics`, `disconnect`.

All of them return the **same** `NormalizedMetrics` shape, including a
`confidence` tier (`EXACT` / `DERIVED` / `SAMPLED` / `SCOPE_LIMITED`), a plain
`method` string and a list of `caveats` rendered verbatim. No provider-specific
logic reaches the dashboard, the eligibility engine or the rate engine.

### Metadata-only scanning

Scans collect counts, byte sizes, MIME/extension categories, timestamps and
aggregate statistics. They do not ingest, retain, display or transmit file
contents, email bodies, chat messages, attachments or customer records. Connected
data is never sent to a language model. A permission-explanation screen showing
exactly what will and will not be inspected is mandatory before any provider
consent — nothing links past it.

Where a provider cannot expose an exact total, the app computes a **bounded
estimate** and labels the method and confidence tier rather than inventing a
number.

### Durable scan jobs

Inngest was not configurable inside the timebox, so scans run as
database-backed jobs advanced by bounded continuation requests: each call to
`POST /api/scans/[id]/advance` does a small amount of provider work and then
checkpoints. `ScanJob` and `ScanCheckpoint` persist provider cursors, partial
totals, page counts, sampling parameters, error state, timestamps and resumable
status, so a crashed or timed-out invocation loses at most one page and closing
the tab pauses a scan rather than losing it.

**Production upgrade path:** replace the caller of `advanceScan` with an Inngest
step function (or any queue worker) that loops until `done`. `advanceScan` itself
does not change — it is already idempotent per page and safe to retry.

### Data model

`User`, `Organization`, `OrganizationMember`, `ProviderConnection` (with encrypted
credential fields), `OAuthState`, `ScanJob`, `ScanCheckpoint`, `DataAssetMetric`,
`QuestionnaireResponse`, `EligibilityAssessment`, `ValuationFormulaVersion`,
`ValuationRate`, `ValuationSnapshot`, `OfferRequest`, `AuditEvent`.

`ValuationSnapshot` stores a frozen copy of every formula input and the formula
version, so editing a reference rate later never rewrites a result a customer has
already seen.

---

## The eligibility engine

`src/lib/eligibility/engine.ts`. It runs **before** the rate engine and gates it.

Statuses: `LIKELY_ELIGIBLE`, `REVIEW_REQUIRED`, `LIKELY_INELIGIBLE`. Two rules
govern every change to it:

1. Missing input is treated as the most conservative input. "Not sure" counts
   exactly like "yes" on any risk question, and an incomplete questionnaire keeps
   everything at `REVIEW_REQUIRED` with rates locked.
2. No output may assert that data is legally sellable, cleared, licensable or
   compliant. The strongest available status describes a *screening result*, not a
   legal right.

Forcing rules:

- Any sensitive-category "yes" (or "not sure") forces at least `REVIEW_REQUIRED`
  and suppresses rate display.
- Credentials and legally privileged material escalate to `LIKELY_INELIGIBLE` —
  neither has a licensable form, and neither can be cured by redaction.
- Third-party PII, NDA-bound counterparty material and employee personal data each
  force `REVIEW_REQUIRED` at minimum.
- **Communication corpora (email, chat) default to `REVIEW_REQUIRED` regardless of
  answers**, because they structurally contain counterparty and employee material
  the business did not author. This applies to Microsoft 365, Google Workspace and
  Slack, and to any source whose measured category mix contains email or chat. The
  reason is shown in the UI, not buried.
- A scan the provider could not complete (`scopeLimited`) forces
  `REVIEW_REQUIRED`.
- Sensitive answers never increase a rate. They only restrict.

## The rate engine

`src/lib/valuation/engine.ts`. Transparent, configurable, server-side, versioned.

```
midpoint_rate = base_rate × quality × recency × rights × uniqueness
low  = midpoint × 0.6
high = midpoint × 1.6
```

Two unit types: **per GB** for unstructured sources, **per usable record** for
structured ones. Per-GB rounds to 2dp, per-record to 3dp. Zero, non-finite and
absurd inputs are clamped rather than propagated.

`rights` is capped at 1.0 by construction — a hard invariant asserted across every
combination of answers in `tests/unit/valuation.test.ts`.

### Where the seed rates come from

`src/lib/valuation/seed-rates.ts`. Each carries a `sourceNote` shown in the admin
UI, because "where did you get that number?" needs an answer.

The honest position, stated in the code and the UI: almost no publicly reported
corpus-licensing transaction discloses a per-GB or per-record rate. The seeds are
therefore either derived from a reported **per-asset** price or taken from an
**observable per-record market**. Figures obtained by dividing a headline deal
value by a guessed corpus size are deliberately **not** used, because that
arithmetic is not defensible. The values are conservative by design — seeding a
flattering number to make a demo land better is the failure mode this product
exists to avoid.

A platform admin can edit any rate and its sourcing note at `/admin` without
touching code.

---

## Security

- OAuth credentials encrypted at rest with **AES-256-GCM** (authenticated), fresh
  random IV per record, server-held key. Never returned to the browser, never
  placed in browser storage, never logged.
- Single-use, server-minted OAuth `state` bound to the initiating user *and*
  organisation; **PKCE (S256)** wherever the provider supports it (Dropbox,
  Microsoft, Google). A callback whose state was not minted here, has expired,
  names a different provider, or belongs to a different signed-in user is rejected
  — which is what blocks both CSRF and account-linking attacks. State is consumed
  before the remaining checks run, so a rejected state cannot be retried.
- Starting an authorization is a `POST`, not a link, so a third-party page cannot
  push a signed-in user into a consent flow.
- Least-privilege read-only scopes only. No write or delete scope is requested
  anywhere.
- Tokens, authorization codes, PKCE verifiers, state values and provider payloads
  are redacted before anything is logged or written to `AuditEvent`. Provider error
  bodies are reduced to a status and a short generic reason, because they routinely
  echo request parameters.
- Every server action and route handler verifies organisation membership before
  touching organisation data. Admin functions check the platform-admin flag server
  side; hiding the nav link is not treated as a control.
- Security headers (CSP, HSTS in production, `X-Frame-Options: DENY`, nosniff,
  Referrer-Policy, Permissions-Policy, COOP) in `next.config.ts`.
- Disconnect revokes at the provider where supported, then deletes tokens,
  checkpoints, metrics and any computed rate. Account deletion removes everything.
- Application sign-in and data-source authorization are strictly separate and
  share no credential store.

**No compliance claim is made.** There is no SOC 2 report, no HIPAA assessment, no
GDPR certification and no legal review. `/terms`, `/privacy` and `/security` are
placeholders carrying a visible "requires legal review before production" notice.

---

## Commands

```bash
npm run dev          # development server
npm run build        # production build
npm run start        # serve the production build
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm test             # vitest unit suite
npm run test:e2e     # playwright, desktop + mobile
npm run db:migrate   # prisma migrate dev
npm run db:deploy    # prisma migrate deploy (production)
npm run db:seed      # formula, reference rates, admin, demo organisation
npm run db:reset     # drop, re-migrate, re-seed
```

### Test coverage

Unit (`tests/unit`, 107 tests): rate formula and versioning, low/mid/high maths,
rounding, zero and huge inputs, the rights-multiplier ≤ 1.0 invariant; the
eligibility engine including every sensitive-category forcing rule and the
communications-corpus default; token encryption, tamper detection and key
handling; adapter normalisation against mocked provider payloads; OAuth state
failure modes; organisation authorization and admin protection; log redaction.

E2E (`tests/e2e`, 11 tests × desktop and mobile): the full demo journey (landing →
demo → disconnect → add source → scan completes → measured volume increases →
questionnaire → eligibility result → review confirmation); signup and onboarding;
whole-product hygiene (no console errors, no failed requests, no dead internal
links, no placeholder copy, no credential in the DOM or in browser storage,
coming-soon cards genuinely disabled, permission screen mandatory); and the
framing assertions:

- no dollar figure renders anywhere before the questionnaire is submitted;
- no dollar figure renders for a source whose status is `REVIEW_REQUIRED` or
  `LIKELY_INELIGIBLE`;
- every currency figure on the page sits beside a per-unit label;
- the dashboard summary is currency-free even once rates exist.

> **Browser note:** this repository was developed on macOS 13, for which
> Playwright no longer ships browser builds. Both projects therefore drive the
> system Google Chrome via `channel: "chrome"`, and the mobile project emulates an
> iPhone-sized viewport with touch input in that browser rather than using the
> WebKit-backed device descriptor. On a supported OS you can drop `channel` and
> use `devices["iPhone 13"]`.

---

## Deployment (Vercel)

1. Push the repository and import it in Vercel.
2. Provision PostgreSQL and set `DATABASE_URL`.
3. Set `AUTH_SECRET`, `ENCRYPTION_KEY`, `NEXT_PUBLIC_APP_URL` and `AUTH_URL` to
   the deployed origin, plus whichever provider credentials you have.
4. Build command `npm run build`; add `npm run db:deploy` as a release step.
5. Seed once: `npm run db:seed` against the production database.
6. **Add the deployed callback URL to every provider console** —
   `https://<domain>/api/connect/<provider>/callback`. OAuth will fail until you do.
7. Change the seeded demo and admin passwords, or set `DEMO_MODE_ENABLED=false`.

---

## File map

```
prisma/
  schema.prisma            data model
  seed.ts                  formula, reference rates, admin, demo organisation
src/config/
  brand.ts                 name, colours, contacts, legal copy — change here, not in components
  business.ts              shared option lists (plain module: NOT a "use server" file)
  demo.ts                  demo credentials + demo-mode flag
src/lib/
  crypto.ts                AES-256-GCM for credentials, PKCE, constant-time compare
  logging.ts               redaction and safe error messages
  auth.ts / org.ts         app sign-in; organisation + admin authorization
  eligibility/engine.ts    the screening rules  ← read before touching the rate engine
  eligibility/service.ts   persistence; deletes rates for anything that did not pass
  valuation/engine.ts      per-unit rate maths, versioned
  valuation/seed-rates.ts  reference rates with their sourcing notes
  valuation/service.ts     persistence; freezes inputs per computation
  connectors/types.ts      ConnectorAdapter + the one normalized metrics shape
  connectors/{dropbox,hubspot,microsoft,google,slack,demo}.ts
  connectors/oauth.ts      state minting/consumption, PKCE, redirect URIs
  connectors/http.ts       backoff, rate-limit handling, error sanitising
  scan/runner.ts           durable resumable jobs
  summary.ts               dashboard aggregation (volume/counts only — no money)
src/app/
  page.tsx                 homepage
  dashboard/               inventory, per-source cards, dev controls
  sources/                 catalog + mandatory permission screen per provider
  questionnaire/           rights & sensitivity questions
  report/                  Data Inventory & Eligibility Report
  review/                  verified-review request + confirmation
  admin/                   reference rates and leads (platform admin only)
  disconnect/              disconnect confirmation
  api/connect/[provider]/  OAuth start + callback
  api/scans/[id]/advance/  bounded scan continuation
src/components/
  ui/                      shadcn-pattern primitives
  dashboard/rate-chain.tsx the ONLY place a dollar figure is rendered
```

## Handoff notes

- `src/components/dashboard/rate-chain.tsx` is the single rendering site for
  currency. If a dollar figure appears anywhere else, that is a bug.
- `src/lib/eligibility/engine.ts` gates everything downstream. Change it before
  changing the rate engine, never after.
- Adding a connector: implement `ConnectorAdapter`, register it in
  `src/lib/connectors/registry.ts`, add a demo fixture in `connectors/demo.ts`,
  add a seed rate with a defensible sourcing note, and add a normalisation test
  against mocked provider payloads. Do not enable its card until it can persist,
  scan, display, refresh, error and disconnect.
- A file marked `"use server"` may only export async functions. Exporting a
  constant or a schema from one silently breaks at runtime — this bit us once
  during the build, which is why shared option lists live in `src/config/business.ts`.
