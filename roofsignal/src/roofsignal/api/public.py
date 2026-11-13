"""Homeowner-facing endpoints (landing page, consent capture, opt-out). Called only by our Next.js server, which
passes the visitor's IP and user agent; no owner data is ever returned to the page."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from roofsignal.api.deps import get_session, require_service
from roofsignal.callcenter import service as cc
from roofsignal.db.models import InboundTouch
from roofsignal.outreach import tracking

router = APIRouter(prefix="/public", dependencies=[Depends(require_service)])
DISCLOSURE_VERSION = "consent_v1"


@router.get("/landing")
def landing(code: str | None = None, session: Session = Depends(get_session)) -> dict:
    text_, sha = cc.disclosure(DISCLOSURE_VERSION)
    out = {"code": None, "trigger_text": None, "tracking_phone": None,
           "disclosure": {"version": DISCLOSURE_VERSION, "text": text_, "sha256": sha}}
    if code and tracking.is_valid(code):
        norm = tracking.normalize(code)
        row = session.execute(text(
            "SELECT mp.id, mp.campaign_id, mp.trigger_text, c.tracking_phone FROM mail_piece mp "
            "JOIN campaign c ON c.id = mp.campaign_id WHERE mp.tracking_code = :c"), {"c": norm}).first()
        if row:
            session.add(InboundTouch(campaign_id=row.campaign_id, mail_piece_id=row.id, channel="web_visit"))
            out.update(code=norm, trigger_text=row.trigger_text, tracking_phone=row.tracking_phone)
    return out


class RequestIn(BaseModel):
    first_name: str = Field(min_length=1, max_length=128)
    last_name: str = Field(min_length=1, max_length=128)
    phone: str
    email: str | None = None
    address: str = Field(min_length=3, max_length=255)
    zip: str = Field(pattern=r"^\d{5}$")
    state: str = Field(pattern=r"^[A-Za-z]{2}$")
    consent_checked: bool
    disclosure_version: str
    disclosure_sha256: str
    tracking_code: str | None = None
    page_url: str | None = None


@router.post("/requests")
def submit(body: RequestIn, x_client_ip: str | None = Header(default=None),
           x_client_user_agent: str | None = Header(default=None), session: Session = Depends(get_session)) -> dict:
    code = tracking.normalize(body.tracking_code) if body.tracking_code and tracking.is_valid(body.tracking_code) \
        else None
    try:
        result = cc.capture_web_request(
            session, first_name=body.first_name, last_name=body.last_name, phone_raw=body.phone, email=body.email,
            address=body.address, zip_code=body.zip, state=body.state, consent_checked=body.consent_checked,
            disclosure_version=body.disclosure_version, disclosure_sha256=body.disclosure_sha256, ip=x_client_ip,
            user_agent=x_client_user_agent, page_url=body.page_url, tracking_code=code,
            form_payload={**body.model_dump(), "received_at": datetime.now(timezone.utc).isoformat()},
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    # The page only learns whether we will call; never the internal compliance reasons.
    return {"received": True, "will_call": result["queued"], "consent_recorded": result["consent_recorded"]}


class OptOutIn(BaseModel):
    phone: str


@router.post("/optout")
def optout(body: OptOutIn, x_client_ip: str | None = Header(default=None),
           session: Session = Depends(get_session)) -> dict:
    try:
        cc.web_opt_out(session, body.phone, x_client_ip)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"ok": True}
