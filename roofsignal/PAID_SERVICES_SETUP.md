# Paid services: setup checklist

The owner does these steps. Some ask you to certify things about your business under penalty of law (the FTC
registry) or to enter payment details. Those certifications have to come from you. After each step, send back
only the items listed under "Give RoofSignal". Keys go into the environment's secret settings, never into chat
or code.

Prices are approximate public list prices from memory, not checked live. Confirm them on each site. Nothing here is legal advice; see
COMPLIANCE.md.

## 1. FTC National Do Not Call Registry: required before any outbound call

- **Cost:** free for up to 5 area codes per year. Each extra area code is $85/year (FY2027). Pilot area codes:
  631, 516 (Long Island), 214, 469, 972 (Dallas), which is exactly 5.
- **Where:** telemarketing.donotcall.gov, "Register" as a **seller** (RoofSignal calls on its own behalf).
- **You'll need:** the legal business name, address, an authorized contact, and possibly an EIN.
- **You'll certify:** that you're accessing the registry only to comply with DNC rules. Read this; it's your
  certification, not ours.
- **Then:** choose those 5 area codes and download each file. Note the date and time of each download: the
  gate refuses files 31 or more days old, so re-download at least every 30 days.
- **Give RoofSignal:** the files (or put them on the server). Load each one with
  `roofsignal dnc load --kind national --key 631 --file 631.txt --downloaded-at <time you downloaded it>`.
- If an outside telemarketer (the Philippines call center) also accesses the registry, it needs its own
  access or must be named as your agent. Ask counsel (COMPLIANCE.md C3).

## 2. Texas no-call list: required for Texas numbers

- **Cost:** a per-list fee to the Texas Public Utility Commission, published quarterly. Check their site.
- **Where:** Public Utility Commission of Texas, "Texas No-Call List" (purchase/subscription).
- **Note:** Texas also requires telemarketers to register with the Texas Secretary of State unless exempt
  (COMPLIANCE.md C1). That's a legal question for counsel before calling Texas numbers.
- **Give RoofSignal:** the file and download date. Load it with
  `roofsignal dnc load --kind state --key TX --file tx.txt --downloaded-at ...`.

## 3. Line-type lookup (wireless vs. landline): recommended

Without it, every number counts as "unknown" and can only be called with written consent from the web form.

- **Example provider:** Twilio Lookup "Line Type Intelligence", about $0.008 per lookup. 1,000 callbacks ≈ $8.
- **Where:** twilio.com. Create an account and verify your email and phone (the trial includes a small credit).
- **Give RoofSignal:** nothing in chat. When we turn it on, the session shows a secure form for the
  `api.twilio.com` / `lookups.twilio.com` key. Spend is capped in code: each $5 needs your recorded approval
  (`roofsignal spend approve`).

## 4. Known-litigator scrub: required by the gate for outbound calls

- **Example providers:** TCPA litigator-list vendors (e.g. Blacklist Alliance and similar).
- **Cost:** roughly $100–500/month or per-query; get quotes.
- **Give RoofSignal:** a downloadable list (loaded with `--kind litigator --key '*'`) or API access through
  the secure form.

## 5. Telephony: tracking numbers on mailers and agent calling

- **Example:** Twilio Voice. Local numbers ≈ $1.15/month each; calls ≈ $0.014/min (US).
- **Before buying numbers:** decide how many campaigns get their own number. One per mail batch is typical.
- **Calls placed from the Philippines** through a US provider still follow US caller-ID rules
  (COMPLIANCE.md B9).

## Not needed yet

FCC Reassigned Numbers Database (optional), Stripe (Phase 3, skipped for now), and transactional email
(Phase 3).
