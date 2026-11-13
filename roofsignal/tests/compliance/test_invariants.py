"""Property-based tests: safety guarantees that must hold for ANY combination of data."""

from __future__ import annotations

from datetime import timedelta

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from roofsignal.compliance import decide
from roofsignal.compliance.types import CallKind, CheckStatus, LineType, LineTypeInfo, Purpose

from .fakes import NOW, NUMBER, RULES, callback, clean_ports, fresh, pewc, req

scenario = st.fixed_dictionaries(
    {
        "internal": st.booleans(),
        "national_listed": st.booleans(),
        "national_age": st.floats(min_value=0, max_value=60),
        "litigator": st.booleans(),
        "line_type": st.sampled_from(list(LineType) + [None]),
        "consent": st.sampled_from(["none", "pewc", "pewc_revoked", "callback", "pewc_expired", "pewc_bad_sha"]),
        "kind": st.sampled_from(list(CallKind)),
        "purpose": st.sampled_from(list(Purpose)),
        "minutes": st.integers(min_value=0, max_value=7 * 24 * 60),
        "attempts": st.integers(min_value=0, max_value=4),
        "allow_mock": st.booleans(),
    }
)


def build(s):
    p = clean_ports()
    if s["internal"]:
        p.internal_dnc.numbers.add(NUMBER)
    if s["national_listed"]:
        p.national_dnc.listed.add(("631", NUMBER))
    p.national_dnc.datasets["631"] = fresh("ftc", days_old=s["national_age"])
    if s["litigator"]:
        p.litigators.listed.add(("*", NUMBER))
    if s["line_type"] is None:
        p.line_types.results.pop(NUMBER)
    else:
        p.line_types.results[NUMBER] = LineTypeInfo(s["line_type"], NOW - timedelta(days=1), "t")
    c = s["consent"]
    p.consents.by_number[NUMBER] = {
        "none": [],
        "pewc": [pewc()],
        "pewc_revoked": [pewc(revoked=NOW - timedelta(minutes=1))],
        "callback": [callback()],
        "pewc_expired": [pewc(captured=NOW - timedelta(days=400))],
        "pewc_bad_sha": [pewc(sha="f" * 64)],
    }[c]
    p.history.attempts = [(NUMBER, NOW - timedelta(hours=1))] * s["attempts"]
    now = NOW + timedelta(minutes=s["minutes"])
    r = req(purpose=s["purpose"], kind=s["kind"])
    return p, r, now


@settings(max_examples=600, suppress_health_check=[HealthCheck.too_slow], deadline=None)
@given(scenario)
def test_safety_invariants(s):
    p, r, now = build(s)
    d = decide(r, p, RULES, now, allow_mock_data=s["allow_mock"])

    # The log is always complete.
    assert len(d.checks) == 10

    if d.allowed:
        assert all(c.status is not CheckStatus.BLOCK for c in d.checks)
        # Absolute blocks can never be overridden by consent or anything else.
        assert not s["internal"] and not s["litigator"]
        # Registry data must be fresh.
        assert s["national_age"] < 31
        # Revoked, expired or defective consent never counts.
        valid_pewc = s["consent"] == "pewc"
        # Wireless / VoIP / unknown only with valid PEWC.
        if s["line_type"] in (LineType.WIRELESS, LineType.VOIP, LineType.UNKNOWN, None):
            assert valid_pewc
        # DNC-listed numbers only with valid PEWC.
        if s["national_listed"]:
            assert valid_pewc
        # A callback needs some valid consent.
        if s["kind"] is CallKind.CALLBACK_REQUESTED:
            assert s["consent"] in ("pewc", "callback")
        # A revoked number is never called, cold or not.
        assert s["consent"] != "pewc_revoked"
        if s["purpose"] is Purpose.DIAL:
            assert s["attempts"] < RULES.max_attempts_24h
            hours = next(c for c in d.checks if c.check == "calling_hours")
            assert hours.status is CheckStatus.PASS


@settings(max_examples=300, deadline=None)
@given(scenario)
def test_adding_a_revocation_never_turns_block_into_allow(s):
    p, r, now = build(s)
    before = decide(r, p, RULES, now, allow_mock_data=s["allow_mock"])
    revoked = callback("rev", captured=now - timedelta(days=2), revoked=now - timedelta(seconds=1))
    p.consents.by_number[NUMBER] = p.consents.by_number.get(NUMBER, []) + [revoked]
    after = decide(r, p, RULES, now, allow_mock_data=s["allow_mock"])
    if not before.allowed:
        assert not after.allowed


@settings(max_examples=300, deadline=None)
@given(scenario)
def test_dial_is_never_looser_than_queue_insert(s):
    p, r, now = build(s)
    from dataclasses import replace

    q = decide(replace(r, purpose=Purpose.QUEUE_INSERT), p, RULES, now, allow_mock_data=s["allow_mock"])
    d = decide(replace(r, purpose=Purpose.DIAL), p, RULES, now, allow_mock_data=s["allow_mock"])
    if d.allowed:
        assert q.allowed
