"""Call-center services. Every path that could lead to an outbound call goes through `evaluate()`, which runs the
compliance gate and writes the decision to the append-only log (even when it blocks).

Flows:
  * web form (landing page) -> consent captured -> callback queued (gate: QUEUE_INSERT)
  * agent claims a queue item -> dial (gate again: DIAL) -> mock/real telephony -> disposition (+ qualification)
  * DNC request on a call, web opt-out, or STOP -> consent revoked + internal DNC
"""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from functools import lru_cache

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from roofsignal.adapters.factory import telephony_provider
from roofsignal.adapters.linetype import LineTypeProvider, MockLineTypeProvider
from roofsignal.adapters.telephony.base import TelephonyProvider
from roofsignal.callcenter.ports_sql import SqlPorts
from roofsignal.compliance import decide
from roofsignal.compliance.numbers import parse
from roofsignal.compliance.rules import RuleSet, load_rules
from roofsignal.compliance.types import CallKind, Decision, GateRequest, Purpose
from roofsignal.core.settings import Settings, get_settings
from roofsignal.db.models import (
    AuditLog,
    Call,
    CallQueueItem,
    ComplianceDecisionRow,
    ConsentRecord,
    Contact,
    Disposition,
    InboundTouch,
    InternalDnc,
    PhoneNumber,
    Qualification,
    Trade,
)

DISPOSITIONS = {
    "QUALIFIED", "NOT_HOMEOWNER", "NOT_INTERESTED", "CALLBACK", "DNC_REQUESTED", "WRONG_NUMBER", "NO_ANSWER",
    "VOICEMAIL_NO_MESSAGE", "LANGUAGE_BARRIER", "ALREADY_HAS_CONTRACTOR", "HOSTILE",
}
ROOF_CONCERNS = {"leak", "missing_or_damaged_shingles", "age", "storm_concern", "insurance_inspection", "none", "other"}
TIMELINES = {"asap", "1_3_months", "3_6_months", "6_plus_months", "unsure"}
INSURANCE = {"yes", "no", "already_filed", "unsure"}

# Codes after which the number is never called again by us.
TERMINAL_DNC = {"DNC_REQUESTED", "HOSTILE", "WRONG_NUMBER"}


class ComplianceBlocked(Exception):
    def __init__(self, decision: Decision, row: ComplianceDecisionRow) -> None:
        super().__init__(", ".join(decision.block_reasons))
        self.decision, self.row = decision, row


@lru_cache
def rules(config_dir: str | None = None) -> RuleSet:
    from pathlib import Path

    base = Path(config_dir) if config_dir else get_settings().config_dir
    return load_rules(base / "compliance" / "rules.yaml", base / "disclosures")


def line_type_provider(settings: Settings | None = None) -> LineTypeProvider:
    s = settings or get_settings()
    if s.line_type_provider != "mock":
        raise NotImplementedError(f"line-type provider {s.line_type_provider!r} is paid and not approved/built")
    return MockLineTypeProvider()


def allow_mock_data(settings: Settings | None = None) -> bool:
    """Mock scrub data may only authorize a call when the call itself is fake (mock telephony)."""
    return (settings or get_settings()).telephony_provider == "mock"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def audit(s: Session, actor: str, action: str, entity: str, entity_id, detail: dict | None = None) -> None:
    s.add(AuditLog(actor=actor, action=action, entity=entity, entity_id=str(entity_id) if entity_id else None,
                   detail=detail or {}))


# --------------------------------------------------------------------------- gate


def evaluate(s: Session, e164: str, purpose: Purpose, call_kind: CallKind, state: str | None, tz: str | None,
             actor: str, now: datetime | None = None, lt_provider: LineTypeProvider | None = None
             ) -> tuple[Decision, ComplianceDecisionRow]:
    now = now or utcnow()
    mock_ok = allow_mock_data()
    ports = SqlPorts.build(s, lt_provider or line_type_provider())
    d = decide(GateRequest(e164, purpose, call_kind, state, tz, actor), ports, rules(), now, allow_mock_data=mock_ok)
    row = ComplianceDecisionRow(
        e164=e164, purpose=purpose.value, call_kind=call_kind.value, allowed=d.allowed, block_reasons=d.block_reasons,
        checks=[{**asdict(c), "status": c.status.value} for c in d.checks], ruleset_version=d.ruleset_version,
        ruleset_hash=d.ruleset_hash, evaluated_at=d.evaluated_at, recipient_timezones=d.recipient_timezones,
        recipient_state=state, next_window_start=d.next_window_start, allow_mock_data=mock_ok, actor=actor,
    )
    s.add(row)
    s.flush()
    return d, row


# --------------------------------------------------------------------------- numbers & contacts


def normalize_us_phone(raw: str) -> str | None:
    digits = "".join(ch for ch in raw or "" if ch.isdigit())
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10:
        return None
    e164 = "+1" + digits
    return e164 if parse(e164) else None


def get_or_create_phone(s: Session, e164: str, contact: Contact | None = None) -> PhoneNumber:
    phone = s.scalar(select(PhoneNumber).where(PhoneNumber.e164 == e164))
    if phone is None:
        phone = PhoneNumber(e164=e164, contact_id=contact.id if contact else None)
        s.add(phone)
        s.flush()
    elif contact is not None and phone.contact_id is None:
        phone.contact_id = contact.id
    return phone


# --------------------------------------------------------------------------- queue


def enqueue(s: Session, phone: PhoneNumber, call_kind: CallKind, queue: str, state: str | None, tz: str | None,
            actor: str, contact: Contact | None = None, property_id=None, campaign_id=None, mail_piece_id=None,
            priority: int = 100, now: datetime | None = None) -> tuple[Decision, ComplianceDecisionRow,
                                                                      CallQueueItem | None]:
    """The ONLY way into a call queue. Returns the decision (always logged) and the queue item if allowed."""
    d, row = evaluate(s, phone.e164, Purpose.QUEUE_INSERT, call_kind, state, tz, actor, now)
    if not d.allowed:
        audit(s, actor, "queue_blocked", "phone_number", phone.id, {"reasons": d.block_reasons})
        return d, row, None
    item = CallQueueItem(
        phone_number_id=phone.id, contact_id=contact.id if contact else phone.contact_id, property_id=property_id,
        campaign_id=campaign_id, mail_piece_id=mail_piece_id, queue=queue, call_kind=call_kind.value,
        compliance_decision_id=row.id, recipient_state=state, recipient_timezone=tz, priority=priority,
        not_before=d.next_window_start,
        expires_at=(now or utcnow()) + timedelta(days=rules().callback_request_max_age_days),
    )
    s.add(item)
    s.flush()
    return d, row, item


def claim_next(s: Session, agent_id: uuid.UUID, now: datetime | None = None) -> CallQueueItem | None:
    now = now or utcnow()
    s.execute(text("UPDATE call_queue_item SET status = 'expired' WHERE status = 'ready' AND expires_at < :now"),
              {"now": now})
    item = s.scalar(
        select(CallQueueItem)
        .where(CallQueueItem.status == "ready",
               (CallQueueItem.not_before.is_(None)) | (CallQueueItem.not_before <= now))
        .order_by(CallQueueItem.priority, CallQueueItem.created_at)
        .with_for_update(skip_locked=True).limit(1)
    )
    if item is not None:
        item.status, item.assigned_agent_id = "claimed", agent_id
        s.flush()
    return item


def release(s: Session, item: CallQueueItem, not_before: datetime | None = None) -> None:
    item.status, item.assigned_agent_id, item.not_before = "ready", None, not_before


# --------------------------------------------------------------------------- dialing


def dial(s: Session, item: CallQueueItem, agent_id: uuid.UUID, from_number: str,
         telephony: TelephonyProvider | None = None, now: datetime | None = None) -> Call:
    """Re-check the gate at dial time; only an ALLOW decision reaches the telephony provider."""
    if item.status != "claimed" or item.assigned_agent_id != agent_id:
        raise PermissionError("queue item is not claimed by this agent")
    phone = s.get(PhoneNumber, item.phone_number_id)
    d, row = evaluate(s, phone.e164, Purpose.DIAL, CallKind(item.call_kind), item.recipient_state,
                      item.recipient_timezone, f"agent:{agent_id}", now)
    if not d.allowed:
        timing_only = set(d.block_reasons) <= {"OUTSIDE_CALLING_HOURS", "NO_CALL_DATE", "STATE_NO_SUNDAY_CALLS",
                                               "FREQUENCY_CAP_24H", "FREQUENCY_CAP_7D"}
        if timing_only:
            release(s, item, d.next_window_start or (now or utcnow()) + timedelta(hours=4))
        else:
            item.status, item.assigned_agent_id = "blocked", None
        audit(s, f"agent:{agent_id}", "dial_blocked", "call_queue_item", item.id, {"reasons": d.block_reasons})
        s.flush()
        raise ComplianceBlocked(d, row)
    telephony = telephony or telephony_provider(s)
    result = telephony.place_call(phone.e164, from_number, str(agent_id))
    call = Call(queue_item_id=item.id, phone_number_id=phone.id, agent_id=agent_id, direction="outbound",
                dial_decision_id=row.id, provider=telephony.name, provider_call_id=result.provider_call_id,
                provider_status=result.status, recording_disclosed=False)
    s.add(call)
    s.flush()
    return call


def log_inbound_call(s: Session, agent_id: uuid.UUID, caller_raw: str, contact: Contact | None = None,
                     telephony_name: str = "mock_telephony") -> Call:
    e164 = normalize_us_phone(caller_raw)
    if e164 is None:
        raise ValueError("invalid caller number")
    phone = get_or_create_phone(s, e164, contact)
    call = Call(phone_number_id=phone.id, agent_id=agent_id, direction="inbound", provider=telephony_name)
    s.add(call)
    s.flush()
    return call


# --------------------------------------------------------------------------- dispositions & qualification


def record_disposition(s: Session, call: Call, agent_id: uuid.UUID, code: str, notes: str | None = None,
                       qualification: dict | None = None, callback_at: datetime | None = None,
                       now: datetime | None = None) -> Disposition:
    if code not in DISPOSITIONS:
        raise ValueError(f"unknown disposition {code}")
    if call.agent_id != agent_id:
        raise PermissionError("call belongs to another agent")
    now = now or utcnow()
    call.ended_at = call.ended_at or now
    if notes:
        call.notes = notes
    disp = Disposition(call_id=call.id, code=code, notes=notes, created_by=agent_id)
    s.add(disp)
    phone = s.get(PhoneNumber, call.phone_number_id)
    item = s.get(CallQueueItem, call.queue_item_id) if call.queue_item_id else None

    if code == "QUALIFIED":
        if not qualification:
            raise ValueError("a QUALIFIED disposition requires the qualification form")
        q = validate_qualification(qualification)
        s.add(Qualification(call_id=call.id, contact_id=phone.contact_id,
                            property_id=item.property_id if item else qualification.get("property_id"), **q))
    if code in TERMINAL_DNC:
        add_internal_dnc(s, phone.e164, reason=code.lower(), source="disposition", actor=f"agent:{agent_id}")
        if code == "DNC_REQUESTED":
            revoke_consent(s, phone.e164, channel="call", note="requested on call", actor=f"agent:{agent_id}",
                           now=now)
    if item is not None:
        if code == "CALLBACK":
            release(s, item, callback_at or now + timedelta(hours=24))
        elif code in ("NO_ANSWER", "VOICEMAIL_NO_MESSAGE"):
            release(s, item, now + timedelta(hours=4))
        else:
            item.status = "done"
    s.flush()
    return disp


def validate_qualification(q: dict) -> dict:
    out = {
        "trade": Trade(q.get("trade", "roofing")),
        "homeowner_confirmed": bool(q.get("homeowner_confirmed")),
        "roof_concern": q.get("roof_concern"),
        "roof_concern_notes": (q.get("roof_concern_notes") or None),
        "timeline": q.get("timeline"),
        "insurance_claim_interest": q.get("insurance_claim_interest"),
        "best_appointment_window": (q.get("best_appointment_window") or None),
    }
    if not out["homeowner_confirmed"]:
        raise ValueError("a qualified lead must be a confirmed homeowner")
    if out["roof_concern"] not in ROOF_CONCERNS:
        raise ValueError("roof_concern is required")
    if out["timeline"] not in TIMELINES:
        raise ValueError("timeline is required")
    if out["insurance_claim_interest"] not in INSURANCE:
        raise ValueError("insurance_claim_interest is required")
    return out


# --------------------------------------------------------------------------- DNC & revocation


def add_internal_dnc(s: Session, e164: str, reason: str, source: str, actor: str) -> InternalDnc:
    existing = s.scalar(select(InternalDnc).where(InternalDnc.e164 == e164, InternalDnc.removed_at.is_(None)))
    if existing:
        return existing
    row = InternalDnc(e164=e164, reason=reason, source=source, added_by=actor)
    s.add(row)
    audit(s, actor, "internal_dnc_add", "internal_dnc", e164, {"reason": reason, "source": source})
    # Nothing already queued for this number may be dialed.
    s.execute(text("UPDATE call_queue_item q SET status = 'blocked' FROM phone_number p "
                   "WHERE p.id = q.phone_number_id AND p.e164 = :n AND q.status IN ('ready', 'claimed')"),
              {"n": e164})
    s.flush()
    return row


def remove_internal_dnc(s: Session, e164: str, actor: str, reason: str) -> int:
    if not reason.strip():
        raise ValueError("a reason is required to remove a number from the internal DNC list")
    n = s.execute(text("UPDATE internal_dnc SET removed_at = now(), removed_by = :a, removal_reason = :r "
                       "WHERE e164 = :n AND removed_at IS NULL"), {"a": actor, "r": reason, "n": e164}).rowcount
    audit(s, actor, "internal_dnc_remove", "internal_dnc", e164, {"reason": reason})
    return n


def revoke_consent(s: Session, e164: str, channel: str, note: str | None, actor: str,
                   now: datetime | None = None) -> int:
    """Revoke every active consent for the number and put it on the internal DNC list."""
    now = now or utcnow()
    rows = s.scalars(select(ConsentRecord).join(PhoneNumber, PhoneNumber.id == ConsentRecord.phone_number_id)
                     .where(PhoneNumber.e164 == e164, ConsentRecord.revoked_at.is_(None))).all()
    for r in rows:
        r.revoked_at, r.revocation_channel, r.revocation_note = now, channel, note
    s.flush()
    add_internal_dnc(s, e164, reason="consent_revoked", source=f"revocation:{channel}", actor=actor)
    audit(s, actor, "consent_revoked", "phone_number", e164, {"channel": channel, "count": len(rows)})
    return len(rows)


# --------------------------------------------------------------------------- web consent capture


def disclosure(version: str = "consent_v1") -> tuple[str, str]:
    from pathlib import Path

    text_ = (Path(get_settings().config_dir) / "disclosures" / f"{version}.txt").read_text()
    return text_, hashlib.sha256(text_.encode()).hexdigest()


def capture_web_request(s: Session, *, first_name: str, last_name: str, phone_raw: str, email: str | None,
                        address: str, zip_code: str, state: str, consent_checked: bool,
                        disclosure_version: str, disclosure_sha256: str, ip: str | None, user_agent: str | None,
                        page_url: str | None, tracking_code: str | None, form_payload: dict,
                        now: datetime | None = None) -> dict:
    """Landing-page submission. Consent counts only if the box was checked AND the disclosure the page displayed
    (identified by its hash) is the exact approved text. The full text is copied into the consent record."""
    now = now or utcnow()
    e164 = normalize_us_phone(phone_raw)
    if e164 is None:
        raise ValueError("Please enter a valid 10-digit US phone number.")
    mail = None
    prop_id = None
    tz = None
    if tracking_code:
        mail = s.execute(text(
            "SELECT mp.id, mp.campaign_id, mp.property_id, co.timezone FROM mail_piece mp "
            "JOIN campaign c ON c.id = mp.campaign_id JOIN county co ON co.id = c.county_id "
            "WHERE mp.tracking_code = :c"), {"c": tracking_code}).first()
        if mail:
            prop_id, tz = mail.property_id, mail.timezone
    contact = Contact(property_id=prop_id, first_name=first_name.strip() or None, last_name=last_name.strip() or None,
                      email=(email or "").strip() or None, address=address.strip() or None, zip=zip_code[:5],
                      state=state.upper()[:2], source="web_form")
    s.add(contact)
    s.flush()
    phone = get_or_create_phone(s, e164, contact)
    s.add(InboundTouch(campaign_id=mail.campaign_id if mail else None, mail_piece_id=mail.id if mail else None,
                       channel="web_form", contact_id=contact.id, occurred_at=now))
    result = {"contact_id": str(contact.id), "consent_recorded": False, "queued": False, "reasons": []}
    if not consent_checked:
        result["reasons"] = ["CONSENT_NOT_GIVEN"]
        return result

    text_, sha = disclosure(disclosure_version)
    if disclosure_sha256 != sha:
        raise ValueError("The consent text on the page is out of date. Please reload and try again.")
    consent = ConsentRecord(
        phone_number_id=phone.id, contact_id=contact.id, kind="pewc", disclosure_version=disclosure_version,
        disclosure_text=text_, disclosure_sha256=sha, seller_names=[rules().company_name], captured_at=now,
        captured_by="web", ip=ip, user_agent=user_agent, page_url=page_url,
        form_payload=json.loads(json.dumps(form_payload, default=str)), mail_piece_id=mail.id if mail else None,
    )
    s.add(consent)
    s.flush()
    result["consent_recorded"] = True
    d, row, item = enqueue(s, phone, CallKind.CALLBACK_REQUESTED, "inbound_callback", contact.state, tz,
                           actor="web", contact=contact, property_id=prop_id,
                           campaign_id=mail.campaign_id if mail else None, mail_piece_id=mail.id if mail else None,
                           priority=10, now=now)
    result.update(queued=item is not None, reasons=d.block_reasons, decision_id=str(row.id))
    return result


def web_opt_out(s: Session, phone_raw: str, ip: str | None) -> bool:
    e164 = normalize_us_phone(phone_raw)
    if e164 is None:
        raise ValueError("Please enter a valid 10-digit US phone number.")
    revoke_consent(s, e164, channel="web", note=f"web opt-out from {ip or 'unknown ip'}", actor="web")
    return True
