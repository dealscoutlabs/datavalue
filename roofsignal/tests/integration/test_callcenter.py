"""Phase 2 on PostGIS: database guarantees, the landing-page -> consent -> queue -> dial -> disposition flow,
revocation, and the mock-data rule."""

from __future__ import annotations

import dataclasses
from datetime import datetime, time, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from roofsignal.callcenter import service as cc
from roofsignal.callcenter.dnc_load import load_dataset, seed_mock_datasets
from roofsignal.compliance.rules import Window
from roofsignal.compliance.types import CallKind, Purpose
from roofsignal.core.auth import create_user
from roofsignal.core.config import load_county, load_scoring
from roofsignal.core.settings import get_settings
from roofsignal.db.models import (
    Call, CallQueueItem, ComplianceDecisionRow, ConsentRecord, County, InternalDnc, PhoneNumber, Qualification,
)
from roofsignal.ingestion.loaders import load_parcels, load_storms
from roofsignal.outreach.campaigns import create_campaign
from roofsignal.scoring.run import run_scoring

from .test_pipeline import AS_OF, FakeParcels, FixtureStorms

pytestmark = pytest.mark.integration
PW = "correct horse battery"
SVC = {"X-Service-Token": "svc-token"}
HOMEOWNER = "(631) 555-2368"
HOMEOWNER_E164 = "+16315552368"


@pytest.fixture
def open_hours(monkeypatch):
    """Calling hours are covered exhaustively in tests/compliance; here they must not depend on the wall clock."""
    base = cc.rules()
    always = dataclasses.replace(base, federal_window=Window(time(0, 0), time(23, 59, 59)), states={},
                                 no_call_dates=frozenset())
    monkeypatch.setattr(cc, "rules", lambda *a: always)
    return always


@pytest.fixture
def world(session, monkeypatch, open_hours):
    monkeypatch.setenv("SERVICE_API_TOKEN", "svc-token")
    get_settings.cache_clear()
    cfg = load_county("suffolk_ny")
    from datetime import date

    load_parcels(session, cfg, FakeParcels())
    load_storms(session, cfg, [FixtureStorms()], date(2025, 1, 1), date(2025, 12, 31))
    run = run_scoring(session, cfg, load_scoring(), "roofing", AS_OF)
    county = session.scalar(select(County))
    camp = create_campaign(session, county, run, "flow-test", ["A", "B", "C"], limit=10)
    seed_mock_datasets(session, ["631"], ["NY"])
    create_user(session, "agent@example.com", "Ana Agent", "agent", PW)
    create_user(session, "agent2@example.com", "Ben Agent", "agent", PW)
    create_user(session, "boss@example.com", "Boss", "admin", PW)
    session.commit()
    code = session.scalar(text("SELECT tracking_code FROM mail_piece WHERE campaign_id = :c LIMIT 1"),
                          {"c": camp.id})
    from roofsignal.api.main import app

    client = TestClient(app)

    def login(email):
        tok = client.post("/auth/login", json={"email": email, "password": PW}, headers=SVC).json()["token"]
        return {**SVC, "Authorization": f"Bearer {tok}"}

    return {"client": client, "code": code, "agent": login("agent@example.com"),
            "agent2": login("agent2@example.com"), "boss": login("boss@example.com"), "session": session}


def submit(client, code, consent=True, sha=None, phone=HOMEOWNER):
    landing = client.get("/public/landing", params={"code": code}, headers=SVC).json()
    body = {
        "first_name": "Jane", "last_name": "Roe", "phone": phone, "email": "jane@example.com",
        "address": "12 Main St", "zip": "11751", "state": "NY", "consent_checked": consent,
        "disclosure_version": landing["disclosure"]["version"],
        "disclosure_sha256": sha or landing["disclosure"]["sha256"], "tracking_code": code,
        "page_url": f"http://localhost:3000/r/{code}",
    }
    return landing, client.post("/public/requests", json=body,
                                headers={**SVC, "X-Client-IP": "203.0.113.7", "X-Client-User-Agent": "pytest-ua"})


# --------------------------------------------------------------------------- database guarantees


def _decision(session, e164, purpose="queue_insert", allowed=True, at=None):
    row = ComplianceDecisionRow(
        e164=e164, purpose=purpose, call_kind="callback_requested", allowed=allowed, block_reasons=[], checks=[],
        ruleset_version="t", ruleset_hash="t", evaluated_at=at or datetime.now(timezone.utc),
        recipient_timezones=[], allow_mock_data=True, actor="test")
    session.add(row)
    session.flush()
    return row


def test_compliance_log_is_append_only(session):
    row = _decision(session, "+16315552368")
    session.commit()
    for stmt in ("UPDATE compliance_decision SET allowed = false", "DELETE FROM compliance_decision"):
        with pytest.raises(DBAPIError, match="append-only"):
            session.execute(text(stmt))
        session.rollback()
    assert session.get(ComplianceDecisionRow, row.id).allowed is True


def test_queue_item_requires_fresh_allow_decision_for_same_number(session):
    phone = PhoneNumber(e164="+16315552368")
    other = PhoneNumber(e164="+16315552369")
    session.add_all([phone, other])
    session.flush()
    cases = [
        _decision(session, phone.e164, allowed=False),                          # BLOCK decision
        _decision(session, other.e164),                                          # other number
        _decision(session, phone.e164, purpose="dial"),                          # wrong purpose
        _decision(session, phone.e164, at=datetime.now(timezone.utc) - timedelta(minutes=11)),  # stale
    ]
    session.commit()
    for d in cases:
        session.add(CallQueueItem(phone_number_id=phone.id, queue="outbound", call_kind="outbound_cold",
                                  compliance_decision_id=d.id))
        with pytest.raises(DBAPIError, match="requires a fresh ALLOW queue_insert decision"):
            session.flush()
        session.rollback()
    ok = _decision(session, phone.e164)
    session.add(CallQueueItem(phone_number_id=phone.id, queue="outbound", call_kind="outbound_cold",
                              compliance_decision_id=ok.id))
    session.flush()


def test_outbound_call_requires_dial_decision_but_inbound_does_not(session):
    user = create_user(session, "a@example.com", "A", "agent", PW)
    phone = PhoneNumber(e164="+16315552368")
    session.add(phone)
    session.commit()
    uid, pid, e164 = user.id, phone.id, phone.e164

    session.add(Call(phone_number_id=pid, agent_id=uid, direction="outbound", provider="mock"))
    with pytest.raises(DBAPIError, match="requires a fresh ALLOW dial decision"):
        session.flush()
    session.rollback()

    q = _decision(session, e164, purpose="queue_insert")  # wrong purpose for a dial
    session.commit()
    session.add(Call(phone_number_id=pid, agent_id=uid, direction="outbound", provider="mock", dial_decision_id=q.id))
    with pytest.raises(DBAPIError, match="requires a fresh ALLOW dial decision"):
        session.flush()
    session.rollback()

    d = _decision(session, e164, purpose="dial")
    session.add(Call(phone_number_id=pid, agent_id=uid, direction="outbound", provider="mock", dial_decision_id=d.id))
    session.add(Call(phone_number_id=pid, agent_id=uid, direction="inbound", provider="mock"))
    session.flush()


def test_consent_can_only_be_revoked_once_and_never_edited_or_deleted(session):
    phone = PhoneNumber(e164="+16315552368")
    session.add(phone)
    session.flush()
    c = ConsentRecord(phone_number_id=phone.id, kind="pewc", disclosure_version="consent_v1", disclosure_text="t",
                      disclosure_sha256="x", seller_names=["RoofSignal"], captured_at=datetime.now(timezone.utc),
                      captured_by="web")
    session.add(c)
    session.commit()
    for stmt in ("UPDATE consent_record SET disclosure_text = 'changed'",
                 "UPDATE consent_record SET disclosure_text = 'changed', revoked_at = now()",
                 "DELETE FROM consent_record"):
        with pytest.raises(DBAPIError):
            session.execute(text(stmt))
        session.rollback()
    session.execute(text("UPDATE consent_record SET revoked_at = now(), revocation_channel = 'sms'"))
    session.commit()
    with pytest.raises(DBAPIError, match="already revoked"):
        session.execute(text("UPDATE consent_record SET revocation_note = 'again'"))
    session.rollback()


# --------------------------------------------------------------------------- landing page -> consent -> queue


def test_landing_page_never_exposes_owner_data(world):
    landing = world["client"].get("/public/landing", params={"code": world["code"]}, headers=SVC).json()
    assert landing["code"] == world["code"] and landing["tracking_phone"].startswith("+1631555")
    assert "RoofSignal" in landing["disclosure"]["text"] and len(landing["disclosure"]["sha256"]) == 64
    flat = str(landing)
    for owner in ("DOE", "ROE JANE", "Main St"):
        assert owner not in flat
    assert world["client"].get("/public/landing", params={"code": "BADCODE1"}, headers=SVC).json()["code"] is None
    assert world["client"].get("/public/landing").status_code == 401  # only our web server may call


def test_web_request_with_consent_is_recorded_exactly_and_queued(world):
    _, r = submit(world["client"], world["code"])
    assert r.status_code == 200 and r.json() == {"received": True, "will_call": True, "consent_recorded": True}
    s = world["session"]
    consent = s.scalar(select(ConsentRecord))
    disclosure_text = (Path(get_settings().config_dir) / "disclosures" / "consent_v1.txt").read_text()
    assert consent.kind == "pewc" and consent.disclosure_text == disclosure_text
    assert consent.ip == "203.0.113.7" and consent.user_agent == "pytest-ua" and consent.seller_names == ["RoofSignal"]
    assert consent.mail_piece_id is not None and consent.form_payload["consent_checked"] is True
    item = s.scalar(select(CallQueueItem))
    assert item.queue == "inbound_callback" and item.priority == 10 and item.call_kind == "callback_requested"
    touches = dict(s.execute(text("SELECT channel, count(*) FROM inbound_touch GROUP BY 1")).all())
    assert touches == {"web_visit": 1, "web_form": 1}


def test_web_request_without_consent_is_not_queued(world):
    _, r = submit(world["client"], world["code"], consent=False)
    assert r.json() == {"received": True, "will_call": False, "consent_recorded": False}
    assert world["session"].scalar(select(CallQueueItem)) is None


def test_stale_disclosure_on_page_is_rejected(world):
    _, r = submit(world["client"], world["code"], sha="0" * 64)
    assert r.status_code == 422 and "out of date" in r.json()["detail"]


def test_invalid_phone_is_rejected(world):
    _, r = submit(world["client"], world["code"], phone="555-1234")
    assert r.status_code == 422


# --------------------------------------------------------------------------- agent flow


def test_agent_claim_dial_qualify(world):
    c = world["client"]
    submit(c, world["code"])
    claimed = c.post("/api/agent/claim", headers=world["agent"]).json()["item"]
    assert claimed["phone_masked"] == "(631) ***-2368" and "e164" not in claimed
    script = claimed["script"]
    assert "RoofSignal" in script["script"] and "recorded" in script["script"]
    assert all("IMAGERY" not in code for code in script["reason_codes"])
    assert any("National Weather Service" in p or "public" in p for p in script["talking_points"])

    # another agent cannot dial it
    assert c.post(f"/api/agent/items/{claimed['id']}/dial", headers=world["agent2"]).status_code == 404

    call = c.post(f"/api/agent/items/{claimed['id']}/dial", headers=world["agent"]).json()
    assert call["provider"] == "mock_telephony" and call["status"] == "completed"

    # QUALIFIED requires the full form
    bad = c.post(f"/api/agent/calls/{call['call_id']}/disposition", json={"code": "QUALIFIED"},
                 headers=world["agent"])
    assert bad.status_code == 422
    q = {"homeowner_confirmed": True, "roof_concern": "storm_concern", "timeline": "1_3_months",
         "insurance_claim_interest": "unsure", "best_appointment_window": "Sat morning"}
    assert c.post(f"/api/agent/calls/{call['call_id']}/disposition", json={"code": "QUALIFIED", "qualification": q},
                  headers=world["agent2"]).status_code == 403
    ok = c.post(f"/api/agent/calls/{call['call_id']}/disposition",
                json={"code": "QUALIFIED", "qualification": q, "recording_disclosed": True, "notes": "nice"},
                headers=world["agent"])
    assert ok.status_code == 200
    s = world["session"]
    s.expire_all()
    qual = s.scalar(select(Qualification))
    assert qual.timeline == "1_3_months" and qual.property_id is not None
    assert s.scalar(select(CallQueueItem)).status == "done"
    dial_decision = s.scalar(select(ComplianceDecisionRow).where(ComplianceDecisionRow.purpose == "dial"))
    assert dial_decision.allowed and dial_decision.allow_mock_data is True


def test_dial_outside_calling_hours_is_refused_and_rescheduled(world, monkeypatch, open_hours):
    c = world["client"]
    submit(c, world["code"])
    item = c.post("/api/agent/claim", headers=world["agent"]).json()["item"]
    closed = dataclasses.replace(open_hours, federal_window=Window(time(0, 0), time(0, 0)))
    monkeypatch.setattr(cc, "rules", lambda *a: closed)
    r = c.post(f"/api/agent/items/{item['id']}/dial", headers=world["agent"])
    assert r.status_code == 409 and "OUTSIDE_CALLING_HOURS" in r.json()["detail"]["reasons"]
    s = world["session"]
    s.expire_all()
    q = s.scalar(select(CallQueueItem))
    assert q.status == "ready" and q.assigned_agent_id is None and q.not_before is not None
    assert s.scalar(select(Call)) is None


def test_dnc_request_on_call_revokes_and_blocks_everything(world):
    c = world["client"]
    submit(c, world["code"])
    item = c.post("/api/agent/claim", headers=world["agent"]).json()["item"]
    call = c.post(f"/api/agent/items/{item['id']}/dial", headers=world["agent"]).json()
    c.post(f"/api/agent/calls/{call['call_id']}/disposition", json={"code": "DNC_REQUESTED"}, headers=world["agent"])
    s = world["session"]
    s.expire_all()
    assert s.scalar(select(InternalDnc)).e164 == HOMEOWNER_E164
    assert s.scalar(select(ConsentRecord)).revocation_channel == "call"
    # a new web request from the same number records consent but is NOT queued (internal DNC wins)
    _, r = submit(c, world["code"])
    assert r.json()["will_call"] is False
    blocked = s.scalar(select(ComplianceDecisionRow).where(ComplianceDecisionRow.allowed.is_(False))
                       .order_by(ComplianceDecisionRow.evaluated_at.desc()))
    assert "INTERNAL_DNC_LISTED" in blocked.block_reasons
    # and the compliance log shows it to a manager
    log = c.get("/api/compliance/decisions", params={"e164": HOMEOWNER}, headers=world["boss"]).json()
    assert any(not d["allowed"] and "INTERNAL_DNC_LISTED" in d["block_reasons"] for d in log)
    assert c.get("/api/compliance/decisions", headers=world["agent"]).status_code == 403


def test_web_opt_out_revokes_and_blocks_queued_items(world):
    c = world["client"]
    submit(c, world["code"])
    assert c.post("/public/optout", json={"phone": HOMEOWNER}, headers=SVC).json() == {"ok": True}
    s = world["session"]
    s.expire_all()
    assert s.scalar(select(ConsentRecord)).revoked_at is not None
    assert s.scalar(select(CallQueueItem)).status == "blocked"
    assert c.post("/api/agent/claim", headers=world["agent"]).json()["item"] is None
    assert c.post("/public/optout", json={"phone": "123"}, headers=SVC).status_code == 422


def test_frequency_cap_counts_real_dials(world):
    c = world["client"]
    submit(c, world["code"])
    for _ in range(2):
        item = c.post("/api/agent/claim", headers=world["agent"]).json()["item"]
        call = c.post(f"/api/agent/items/{item['id']}/dial", headers=world["agent"]).json()
        c.post(f"/api/agent/calls/{call['call_id']}/disposition", json={"code": "NO_ANSWER"}, headers=world["agent"])
        s = world["session"]
        s.execute(text("UPDATE call_queue_item SET not_before = NULL"))
        s.commit()
    item = c.post("/api/agent/claim", headers=world["agent"]).json()["item"]
    r = c.post(f"/api/agent/items/{item['id']}/dial", headers=world["agent"])
    assert r.status_code == 409 and "FREQUENCY_CAP_24H" in r.json()["detail"]["reasons"]


def test_inbound_call_logging_and_callback(world):
    c = world["client"]
    r = c.post("/api/agent/inbound", json={"caller": HOMEOWNER, "first_name": "Al", "state": "NY"},
               headers=world["agent"])
    assert r.status_code == 200
    d = c.post(f"/api/agent/calls/{r.json()['call_id']}/disposition", json={"code": "NOT_INTERESTED"},
               headers=world["agent"])
    assert d.status_code == 200
    assert c.post("/api/agent/inbound", json={"caller": "12"}, headers=world["agent"]).status_code == 422
    assert c.get("/api/agent/dispositions", headers=world["agent"]).json()["codes"]


def test_admin_dnc_endpoints(world):
    c = world["client"]
    assert c.post("/api/admin/dnc", json={"phone": HOMEOWNER, "reason": "complaint"},
                  headers=world["boss"]).json()["e164"] == HOMEOWNER_E164
    assert c.get("/api/admin/dnc", headers=world["boss"]).json()[0]["reason"] == "complaint"
    assert c.post("/api/admin/dnc/remove", json={"phone": HOMEOWNER, "reason": " "},
                  headers=world["boss"]).status_code == 422
    assert c.post("/api/admin/dnc/remove", json={"phone": HOMEOWNER, "reason": "added in error"},
                  headers=world["boss"]).json() == {"removed": 1}
    assert c.post("/api/admin/dnc", json={"phone": "x", "reason": "r"}, headers=world["boss"]).status_code == 422
    assert c.post("/api/admin/dnc", json={"phone": HOMEOWNER, "reason": "r"},
                  headers=world["agent"]).status_code == 403


# --------------------------------------------------------------------------- mock data & real telephony


def test_mock_scrub_data_blocks_once_telephony_is_real(world, monkeypatch):
    s = world["session"]
    s.add(PhoneNumber(e164=HOMEOWNER_E164))
    s.flush()
    monkeypatch.setenv("TELEPHONY_PROVIDER", "twilio")
    get_settings.cache_clear()
    d, row = cc.evaluate(s, HOMEOWNER_E164, Purpose.DIAL, CallKind.OUTBOUND_COLD, "NY", "America/New_York", "test")
    assert not d.allowed and "NATIONAL_DNC_MOCK_DATA" in d.block_reasons and row.allow_mock_data is False


# --------------------------------------------------------------------------- scrub list loading


def test_national_dnc_file_load_and_gate(world, tmp_path):
    s = world["session"]
    f = tmp_path / "631.txt"
    f.write_text("6315552368\n(631) 555-0199\n2125551234\n16315550000\ngarbage\n")
    ds = load_dataset(s, "national", "631", f, datetime.now(timezone.utc) - timedelta(days=1))
    assert ds.record_count == 3  # 212 number dropped: wrong area code
    s.add(PhoneNumber(e164=HOMEOWNER_E164))
    s.flush()
    d, _ = cc.evaluate(s, HOMEOWNER_E164, Purpose.DIAL, CallKind.OUTBOUND_COLD, "NY", "America/New_York", "test")
    assert "NATIONAL_DNC_LISTED" in d.block_reasons
    with pytest.raises(ValueError):
        load_dataset(s, "bogus", "631", f, datetime.now(timezone.utc))
    with pytest.raises(ValueError):
        load_dataset(s, "national", "631", f, datetime.now())
    with pytest.raises(ValueError):
        load_dataset(s, "national", "631", f, datetime.now(timezone.utc) + timedelta(days=1))


def test_cli_users_and_dnc_check(world):
    from typer.testing import CliRunner

    from roofsignal.cli import app

    runner = CliRunner()
    r = runner.invoke(app, ["users", "create", "new@example.com", "--name", "New", "--role", "supervisor"])
    assert r.exit_code == 0 and "password (shown once)" in r.stdout
    r = runner.invoke(app, ["dnc", "add", HOMEOWNER, "--reason", "complaint", "--by", "owner"])
    assert r.exit_code == 0
    r = runner.invoke(app, ["dnc", "check", HOMEOWNER, "--state", "NY"])
    assert r.exit_code == 0 and "INTERNAL_DNC_LISTED" in r.stdout
    assert runner.invoke(app, ["dnc", "seed-mock", "--area-code", "212"]).exit_code == 0
    assert runner.invoke(app, ["dnc", "check", "123", "--state", "NY"]).exit_code != 0
