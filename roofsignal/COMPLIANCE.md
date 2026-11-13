# RoofSignal — Items for Legal Review

> **This is not legal advice.** It is a list of questions and assumptions that
> are built into the software and need a licensed attorney (TCPA/telemarketing,
> plus NY consumer-protection and insurance counsel) to confirm or correct.
> Anything here that sounds like a statement of law is a **working assumption
> written into config**. Every such value in `config/compliance/rules.yaml` is
> marked `legal_review: pending` until a lawyer signs off.

Status of each item: ☐ open · ◐ in review · ☑ confirmed by counsel (with date and name)

---

## A. TCPA consent (landing page & inbound)

- ☐ **A1. Exact consent disclosure text** (`config/disclosures/consent_v1.txt`).
  Does it amount to "prior express written consent" for calls and texts from
  RoofSignal *and* from the contractor the lead is sold to? Should the
  disclosure name the contractor, name RoofSignal only, or link to a list of
  "marketing partners"?
- ☐ **A2. One-to-one consent.** We understand the FCC's 2023 "one-to-one
  consent" rule for lead generators was vacated by the Eleventh Circuit
  (*Insurance Marketing Coalition v. FCC*, Jan 2025). Please confirm its current
  status, and whether to design to it anyway as best practice.
- ☐ **A3. Consent capture mechanics.** We store the full disclosure text, its
  SHA-256 hash, timestamp, IP, user agent, page URL, form payload, and an
  unchecked-by-default checkbox. Is this enough to prove consent? Should we also
  add a session replay or certification service (e.g. TrustedForm/Jornaya,
  which are paid)?
- ☐ **A4. Consent not a condition of purchase.** Confirm the wording and
  placement of this statement.
- ☐ **A5. Revocation.** The FCC's revocation rules require honoring
  revocation "by any reasonable means" within a set period, and some parts have
  delayed effective dates. Confirm the current deadlines, which keywords and
  channels we must honor, and whether one revocation must apply to all purposes.
- ☐ **A6. Inbound callers.** When a homeowner calls a tracked number and asks to
  be called back, what consent does that create (scope, duration, and whether it
  covers the buying contractor calling them)? Should agents read a verbal
  consent script, and can that be recorded as consent?
- ☐ **A7. Consent lifetime.** How long does consent last before it is stale? The
  config default is 90 days for queueing and is configurable.

## B. Outbound calling & DNC gate

- ☐ **B1. Wireless numbers.** The product rule is stricter than we think the law
  is: block all wireless/VoIP/unknown line types unless we hold prior express
  written consent (PEWC). Confirm this is enough, and whether manual dialing
  changes anything.
- ☐ **B2. Dialing system.** Confirm that our setup (agents manually click to
  dial one number at a time, no predictive dialer, no prerecorded or artificial
  voice, no automated SMS) is not an "ATDS". Also confirm whether any
  telephony vendor feature would change that.
- ☐ **B3. National DNC scrub frequency.** We assume a 31-day maximum data age
  and scrub at most 31 days before the call. Confirm, plus record-keeping and
  safe-harbor requirements (written procedures, training, internal DNC, process
  for using the registry).
- ☐ **B4. Entity-specific (internal) DNC.** Retention period, and whether a DNC
  request made to RoofSignal must be passed to buyer contractors (and the
  reverse).
- ☐ **B5. State DNC lists.** Which states keep their own lists, and which apply
  to calls *into* that state. We don't call outside the pilot area, but numbers
  can belong to people who now live elsewhere.
- ☐ **B6. Calling hours.** Federal 8am–9pm local time is configured as the base.
  The configured state overrides need confirming: **FL** (Florida Telephone
  Solicitation Act) 8am–8pm, max 3 calls per 24 h on the same subject. **OK**
  (Oklahoma Telephone Solicitation Act) 8am–8pm, max 3 per 24 h. **NY** (GBL
  §399-z) hours and the disclosures required at the start of a call. Also any
  state Sunday/holiday bans. Which time zone controls when the area code's zone
  and the property's zone differ? We apply the stricter of the two.
- ☐ **B7. Litigator scrub.** Is scrubbing known TCPA plaintiffs lawful and
  advisable? Are there any problems with how vendor lists are used?
- ☐ **B8. Reassigned Numbers Database.** Should we use it, and how often, given
  the safe harbor it offers for consent-based calls?
- ☐ **B9. Caller ID & call identification.** Display a number that can be called
  back, STIR/SHAKEN attestation, and the identification script (company name,
  purpose). The Philippines call center places calls on our behalf. Whose name
  do agents give?
- ☐ **B10. Call recording.** NY is commonly described as one-party consent, but
  the person called may be in an all-party consent state (e.g. FL, CA). The
  script discloses recording on every call. Confirm the wording.

## C. Telemarketing registration & offshore call center

- ☐ **C1. State telemarketer registrations/bonds.** Which states require
  RoofSignal and/or the Philippines vendor to register or post a bond before
  calling residents (pilot: NY; also any state where called numbers may be
  located)?
- ☐ **C2. FTC Telemarketing Sales Rule.** Does the TSR apply to our calls (lead
  qualification for home improvement), and what follows from that (disclosures,
  record-keeping for 5 years under recent amendments, abandoned-call rules)?
- ☐ **C3. Vendor contract** with the Philippines call center: who is liable, an
  indemnity, a duty to follow our gate, audit rights, training records.
- ☐ **C4. Cross-border data transfer.** US homeowner PII handled in the
  Philippines. Requirements under the Philippines Data Privacy Act of 2012 for
  the vendor, our duties under NY's SHIELD Act (data security, breach notice),
  and contract clauses to include.

## D. New York home-improvement & lead-selling rules

- ☐ **D1. Do lead sellers need a license?** Does Nassau County (Office of
  Consumer Affairs home improvement licensing), the State of NY, or any town or
  village require a lead seller or "home improvement salesperson" license when
  we don't perform the work? Same question for Suffolk County and NYC if we
  expand.
- ☐ **D2. Contractor verification duties.** Is checking a contractor's license
  number and insurance certificate expiration (and blocking expired ones) enough,
  or must we verify against the issuing authority, and how often?
- ☐ **D3. Marketing claims.** Mail, door hangers and scripts only mention a
  storm reported in the area or the estimated roof age from public records. They
  never claim we observed damage. Please review the actual copy for deceptive
  practices risk under NY GBL §349/§350 and the FTC Act.
- ☐ **D4. Insurance-claim discussion.** The qualification form records whether
  the homeowner is interested in an insurance claim. Agents give no advice. Does
  asking this question, or passing the answer to a contractor, raise
  public-adjuster licensing or insurance-solicitation issues under NY Insurance
  Law? Should the question be removed?
- ☐ **D5. Door hangers.** Local village/town rules on solicitation and
  distribution (peddler/solicitor permits, "no handbills" ordinances).
- ☐ **D6. Disclosure to homeowners that leads are sold.** What should the
  landing page and script say about RoofSignal selling the homeowner's
  information to one contractor?

## E. Data licensing & privacy

- ☐ **E1. County assessor/parcel data:** terms of use for the Nassau Land
  Records Viewer and NYS parcel services. Can owner names and addresses be used
  for commercial direct mail?
- ☐ **E1b. Texas appraisal district data** (if Dallas County is added): DCAD's bulk-file terms
  for commercial use and direct mail. Also any Texas rules on using appraisal records for
  solicitation.
- ☐ **E2. Building permit data obtained by FOIL:** any limits on commercial use?
- ☐ **E3. NOAA / SPC / MRMS data:** we understand this is US-government public
  domain; confirm attribution needs.
- ☐ **E4. Aerial imagery provider** (when chosen): license scope. Are derived
  scores allowed to be stored and used for marketing, and how long can we keep
  them?
- ☐ **E5. Skip-trace / phone-append data** (if ever used): permissible use, and
  FCRA applicability (we believe it doesn't apply because we make no
  eligibility decisions; please confirm).
- ☐ **E6. Privacy policy & terms** for the landing page and the contractor
  portal. Data retention schedule (consent records and call logs are kept at
  least as long as the limitation period counsel advises).
- ☐ **E7. Contractor emails** (CAN-SPAM) and contractor agreement terms (lead
  definition, exclusivity, refund policy, no-resale clause, contractor's own
  TCPA obligations when they call the homeowner).

## F. Payments

- ☐ **F1. Contractor agreement:** prepaid credits vs per-lead charges, refund
  and credit terms, chargebacks.

---

### Engineering commitments that don't depend on legal answers

- The gate fails closed (unknown → BLOCK).
- Compliance decisions and consent records are append-only and kept
  indefinitely until a retention period is confirmed (E6).
- Rule values live in versioned config. The hash of the config version is
  stored on every decision so that any past decision can be reconstructed.
