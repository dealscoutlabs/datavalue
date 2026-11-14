"""Call-center agent routes. Every dial goes through the compliance gate again (callcenter.service.dial)."""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from roofsignal.api.deps import Staff, get_session
from roofsignal.callcenter import script as scripts
from roofsignal.callcenter import service as cc
from roofsignal.core.settings import get_settings
from roofsignal.db.models import AppUser, Call, CallQueueItem

router = APIRouter(prefix="/api/agent", dependencies=[Staff])


def _mask(e164: str) -> str:
    return f"({e164[2:5]}) ***-{e164[-4:]}"


def _item_view(s: Session, item: CallQueueItem, user: AppUser) -> dict:
    row = s.execute(text(
        """
        SELECT q.id, q.queue, q.call_kind, q.status, q.not_before, q.recipient_state, q.recipient_timezone,
               p.e164, ct.first_name, ct.last_name, ct.address, ct.zip, pr.site_address, pr.town, pr.year_built,
               d.evaluated_at AS queued_decision_at
        FROM call_queue_item q JOIN phone_number p ON p.id = q.phone_number_id
        LEFT JOIN contact ct ON ct.id = q.contact_id LEFT JOIN property pr ON pr.id = q.property_id
        JOIN compliance_decision d ON d.id = q.compliance_decision_id
        WHERE q.id = :id"""), {"id": item.id}).mappings().one()
    out = {k: v for k, v in row.items() if k != "e164"}
    out["id"] = str(row["id"])
    out["phone_masked"] = _mask(row["e164"])  # agents dial through the system, never see the full number
    out["script"] = scripts.render(s, item.id, user.display_name)
    return out


@router.get("/queue")
def queue_summary(user: AppUser = Staff, session: Session = Depends(get_session)) -> dict:
    counts = session.execute(text(
        "SELECT queue, count(*) FILTER (WHERE status = 'ready' AND (not_before IS NULL OR not_before <= now())) "
        "AS ready_now, count(*) FILTER (WHERE status = 'ready' AND not_before > now()) AS scheduled "
        "FROM call_queue_item GROUP BY queue")).mappings().all()
    mine = session.scalar(select(CallQueueItem).where(CallQueueItem.assigned_agent_id == user.id,
                                                      CallQueueItem.status == "claimed"))
    return {"queues": [dict(c) for c in counts], "claimed": _item_view(session, mine, user) if mine else None}


@router.post("/claim")
def claim(user: AppUser = Staff, session: Session = Depends(get_session)) -> dict:
    mine = session.scalar(select(CallQueueItem).where(CallQueueItem.assigned_agent_id == user.id,
                                                      CallQueueItem.status == "claimed"))
    item = mine or cc.claim_next(session, user.id)
    if item is None:
        return {"item": None}
    return {"item": _item_view(session, item, user)}


def _own_item(session: Session, item_id: str, user: AppUser) -> CallQueueItem:
    item = session.get(CallQueueItem, uuid.UUID(item_id))
    if item is None or item.assigned_agent_id != user.id:
        raise HTTPException(404, "not your queue item")
    return item


@router.post("/items/{item_id}/release")
def release(item_id: str, user: AppUser = Staff, session: Session = Depends(get_session)) -> dict:
    cc.release(session, _own_item(session, item_id, user))
    return {"ok": True}


@router.post("/items/{item_id}/dial")
def dial(item_id: str, user: AppUser = Staff, session: Session = Depends(get_session)) -> dict:
    item = _own_item(session, item_id, user)
    try:
        call = cc.dial(session, item, user.id, get_settings().outbound_caller_id)
    except cc.ComplianceBlocked as blocked:
        session.commit()  # keep the logged decision and the queue state change
        raise HTTPException(409, {"blocked": True, "reasons": blocked.decision.block_reasons,
                                  "decision_id": str(blocked.row.id),
                                  "next_window_start": blocked.decision.next_window_start}) from None
    return {"call_id": str(call.id), "provider": call.provider, "status": call.provider_status}


class InboundIn(BaseModel):
    caller: str
    first_name: str | None = None
    last_name: str | None = None
    address: str | None = None
    zip: str | None = None
    state: str | None = None


@router.post("/inbound")
def inbound(body: InboundIn, user: AppUser = Staff, session: Session = Depends(get_session)) -> dict:
    from roofsignal.db.models import Contact

    contact = Contact(first_name=body.first_name, last_name=body.last_name, address=body.address, zip=body.zip,
                      state=(body.state or "").upper()[:2] or None, source="inbound_call")
    session.add(contact)
    session.flush()
    try:
        call = cc.log_inbound_call(session, user.id, body.caller, contact)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"call_id": str(call.id)}


class DispositionIn(BaseModel):
    code: str
    notes: str | None = None
    callback_at: datetime | None = None
    recording_disclosed: bool = False
    qualification: dict | None = None


@router.post("/calls/{call_id}/disposition")
def disposition(call_id: str, body: DispositionIn, user: AppUser = Staff,
                session: Session = Depends(get_session)) -> dict:
    call = session.get(Call, uuid.UUID(call_id))
    if call is None:
        raise HTTPException(404, "call not found")
    call.recording_disclosed = body.recording_disclosed
    try:
        d = cc.record_disposition(session, call, user.id, body.code, body.notes, body.qualification,
                                  body.callback_at)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"disposition_id": str(d.id), "code": d.code}


@router.get("/dispositions")
def disposition_codes() -> dict:
    return {"codes": sorted(cc.DISPOSITIONS), "roof_concerns": sorted(cc.ROOF_CONCERNS),
            "timelines": sorted(cc.TIMELINES), "insurance": sorted(cc.INSURANCE)}
