"""Compliance gate tests. Each test names the rule it pins down."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from roofsignal.compliance import decide
from roofsignal.compliance.gate import candidate_zones, next_window_start
from roofsignal.compliance.types import CallKind, CheckStatus, LineType, LineTypeInfo, Purpose

from .fakes import (
    NOW, NUMBER, RULES, TX_NUMBER, FakeReassigned, callback, clean_ports, fresh, pewc, req,
)

CHECKS = ["number_validity", "internal_dnc", "consent", "national_dnc", "state_dnc", "litigator", "line_type",
          "reassigned", "calling_hours", "frequency"]


def check(decision, name):
    return next(c for c in decision.checks if c.check == name)


def at_ny(h, m=0, day=10, month=11, year=2026):
    """A UTC instant for the given New York wall-clock time."""
    from zoneinfo import ZoneInfo

    return datetime(year, month, day, h, m, tzinfo=ZoneInfo("America/New_York")).astimezone(timezone.utc)


# --------------------------------------------------------------------------- baseline


def test_clean_landline_cold_call_is_allowed_and_every_check_logged():
    d = decide(req(), clean_ports(), RULES, NOW)
    assert d.allowed, d.block_reasons
    assert [c.check for c in d.checks] == CHECKS
    assert d.ruleset_version == RULES.version and d.ruleset_hash == RULES.hash
    assert d.block_reasons == []


def test_naive_clock_is_a_programming_error():
    with pytest.raises(ValueError):
        decide(req(), clean_ports(), RULES, NOW.replace(tzinfo=None))


def test_all_checks_run_even_when_the_first_one_blocks():
    d = decide(req(e164="12345"), clean_ports(), RULES, NOW)
    assert not d.allowed
    assert [c.check for c in d.checks] == CHECKS
    assert check(d, "number_validity").reason_code == "NUMBER_INVALID_FORMAT"


# --------------------------------------------------------------------------- number validity


@pytest.mark.parametrize(
    "number,reason",
    [
        ("6315551234", "NUMBER_INVALID_FORMAT"),
        ("+1631555123", "NUMBER_INVALID_FORMAT"),
        ("+11315551234", "NUMBER_INVALID_FORMAT"),   # area code can't start with 1
        ("+18005551234", "NUMBER_TOLL_FREE"),
        ("+18885551234", "NUMBER_TOLL_FREE"),
        ("+19005551234", "NUMBER_PREMIUM"),
        ("+16319761234", "NUMBER_PREMIUM"),
        ("+14115551234", "NUMBER_N11"),
        ("+16314111234", "NUMBER_N11"),
        ("+16315550142", "NUMBER_FICTIONAL_555"),
        ("+14165551234", "NUMBER_NOT_US"),   # Toronto
        ("+18095551234", "NUMBER_NOT_US"),   # Dominican Republic
        ("+17875551234", "NUMBER_NOT_US"),   # Puerto Rico (territory; out of scope)
    ],
)
def test_invalid_numbers_are_blocked(number, reason):
    d = decide(req(e164=number), clean_ports(number), RULES, NOW)
    assert not d.allowed
    assert check(d, "number_validity").reason_code == reason


# --------------------------------------------------------------------------- internal DNC


def test_internal_dnc_blocks_even_with_written_consent():
    p = clean_ports()
    p.internal_dnc.numbers.add(NUMBER)
    p.consents.by_number[NUMBER] = [pewc()]
    d = decide(req(kind=CallKind.CALLBACK_REQUESTED), p, RULES, NOW)
    assert not d.allowed and "INTERNAL_DNC_LISTED" in d.block_reasons


# --------------------------------------------------------------------------- consent


def test_callback_requires_consent():
    d = decide(req(kind=CallKind.CALLBACK_REQUESTED), clean_ports(), RULES, NOW)
    assert check(d, "consent").reason_code == "CONSENT_MISSING" and not d.allowed


def test_callback_with_valid_pewc():
    p = clean_ports()
    p.consents.by_number[NUMBER] = [pewc()]
    d = decide(req(kind=CallKind.CALLBACK_REQUESTED), p, RULES, NOW)
    assert d.allowed and check(d, "consent").reason_code == "CONSENT_VALID_PEWC"


def test_callback_request_consent_works_for_callback_landline():
    p = clean_ports()
    p.consents.by_number[NUMBER] = [callback()]
    d = decide(req(kind=CallKind.CALLBACK_REQUESTED), p, RULES, NOW)
    assert d.allowed and check(d, "consent").reason_code == "CONSENT_VALID_CALLBACK_REQUEST"


def test_revoked_one_second_before_dial_blocks():
    p = clean_ports()
    p.consents.by_number[NUMBER] = [pewc(revoked=NOW - timedelta(seconds=1))]
    d = decide(req(kind=CallKind.CALLBACK_REQUESTED), p, RULES, NOW)
    assert not d.allowed and check(d, "consent").reason_code == "CONSENT_REVOKED"


def test_revocation_scheduled_in_the_future_is_not_yet_effective():
    p = clean_ports()
    p.consents.by_number[NUMBER] = [pewc(revoked=NOW + timedelta(seconds=1))]
    assert decide(req(kind=CallKind.CALLBACK_REQUESTED), p, RULES, NOW).allowed


def test_revocation_on_one_record_revokes_every_earlier_consent():
    p = clean_ports()
    p.consents.by_number[NUMBER] = [
        pewc("old", captured=NOW - timedelta(days=10)),
        callback("cb", captured=NOW - timedelta(days=5), revoked=NOW - timedelta(days=4)),
    ]
    d = decide(req(kind=CallKind.CALLBACK_REQUESTED), p, RULES, NOW)
    assert not d.allowed and check(d, "consent").reason_code == "CONSENT_REVOKED"


def test_new_consent_after_revocation_is_valid():
    p = clean_ports()
    p.consents.by_number[NUMBER] = [
        pewc("old", captured=NOW - timedelta(days=10), revoked=NOW - timedelta(days=9)),
        pewc("new", captured=NOW - timedelta(days=1)),
    ]
    d = decide(req(kind=CallKind.CALLBACK_REQUESTED), p, RULES, NOW)
    assert d.allowed and "consent new" in check(d, "consent").detail


def test_cold_call_to_a_number_that_revoked_is_blocked():
    p = clean_ports()
    p.consents.by_number[NUMBER] = [pewc(revoked=NOW - timedelta(days=30))]
    d = decide(req(), p, RULES, NOW)
    assert not d.allowed and check(d, "consent").reason_code == "CONSENT_REVOKED"


@pytest.mark.parametrize("days,ok", [(364, True), (365, True), (366, False)])
def test_pewc_expiry_boundary(days, ok):
    p = clean_ports()
    p.consents.by_number[NUMBER] = [pewc(captured=NOW - timedelta(days=days))]
    d = decide(req(kind=CallKind.CALLBACK_REQUESTED), p, RULES, NOW)
    assert d.allowed is ok
    if not ok:
        assert check(d, "consent").reason_code == "CONSENT_EXPIRED"


def test_callback_request_expires_after_30_days():
    p = clean_ports()
    p.consents.by_number[NUMBER] = [callback(captured=NOW - timedelta(days=31))]
    d = decide(req(kind=CallKind.CALLBACK_REQUESTED), p, RULES, NOW)
    assert check(d, "consent").reason_code == "CONSENT_EXPIRED"


@pytest.mark.parametrize(
    "kwargs,reason",
    [
        ({"sha": "0" * 64}, "CONSENT_DISCLOSURE_MISMATCH"),     # text shown differs from approved disclosure
        ({"version": "consent_v0"}, "CONSENT_DISCLOSURE_MISMATCH"),  # unknown disclosure version
        ({"version": None, "sha": None}, "CONSENT_DISCLOSURE_MISMATCH"),
        ({"sellers": ("Some Other Co",)}, "CONSENT_SELLER_NOT_NAMED"),
        ({"captured": NOW + timedelta(minutes=5)}, "CONSENT_CAPTURED_IN_FUTURE"),
    ],
)
def test_defective_pewc_is_not_consent(kwargs, reason):
    p = clean_ports()
    p.consents.by_number[NUMBER] = [pewc(**kwargs)]
    d = decide(req(kind=CallKind.CALLBACK_REQUESTED), p, RULES, NOW)
    assert not d.allowed and check(d, "consent").reason_code == reason


# --------------------------------------------------------------------------- national DNC


def test_national_dnc_listed_blocks_cold_call():
    p = clean_ports()
    p.national_dnc.listed.add(("631", NUMBER))
    d = decide(req(), p, RULES, NOW)
    assert not d.allowed and "NATIONAL_DNC_LISTED" in d.block_reasons


def test_national_dnc_listed_with_pewc_is_overridden():
    p = clean_ports()
    p.national_dnc.listed.add(("631", NUMBER))
    p.consents.by_number[NUMBER] = [pewc()]
    d = decide(req(kind=CallKind.CALLBACK_REQUESTED), p, RULES, NOW)
    assert d.allowed and check(d, "national_dnc").reason_code == "NATIONAL_DNC_LISTED_CONSENT_OVERRIDE"


def test_national_dnc_listed_with_only_a_verbal_callback_request_is_not_overridden():
    p = clean_ports()
    p.national_dnc.listed.add(("631", NUMBER))
    p.consents.by_number[NUMBER] = [callback()]
    d = decide(req(kind=CallKind.CALLBACK_REQUESTED), p, RULES, NOW)
    assert not d.allowed and "NATIONAL_DNC_LISTED" in d.block_reasons


def test_area_code_not_in_subscription_blocks():
    p = clean_ports()
    del p.national_dnc.datasets["631"]
    d = decide(req(), p, RULES, NOW)
    assert "NATIONAL_DNC_NOT_AVAILABLE" in d.block_reasons


@pytest.mark.parametrize("days,ok", [(0, True), (30, True), (30.999, True), (31, False), (45, False)])
def test_national_dnc_freshness_boundary(days, ok):
    p = clean_ports()
    p.national_dnc.datasets["631"] = fresh("ftc-631", days_old=days)
    d = decide(req(), p, RULES, NOW)
    assert d.allowed is ok
    if not ok:
        assert check(d, "national_dnc").reason_code == "NATIONAL_DNC_STALE"


def test_mock_scrub_data_never_authorizes_a_real_call():
    p = clean_ports()
    p.national_dnc.datasets["631"] = fresh("mock", mock=True)
    d = decide(req(), p, RULES, NOW)
    assert "NATIONAL_DNC_MOCK_DATA" in d.block_reasons
    assert decide(req(), p, RULES, NOW, allow_mock_data=True).allowed


# --------------------------------------------------------------------------- state DNC & state rules


def test_unknown_recipient_state_blocks():
    d = decide(req(state=None, tz=None), clean_ports(), RULES, NOW)
    assert "RECIPIENT_STATE_UNKNOWN" in d.block_reasons


def test_state_without_list_is_skipped():
    d = decide(req(), clean_ports(), RULES, NOW)
    assert check(d, "state_dnc").status is CheckStatus.SKIP


def test_texas_state_list_listed_blocks():
    p = clean_ports()
    p.state_dnc.listed.add(("TX", TX_NUMBER))
    d = decide(req(e164=TX_NUMBER, state="TX", tz="America/Chicago"), p, RULES, NOW)
    assert "STATE_DNC_LISTED" in d.block_reasons


def test_texas_state_list_missing_or_stale_blocks():
    p = clean_ports()
    del p.state_dnc.datasets["TX"]
    d = decide(req(e164=TX_NUMBER, state="TX", tz="America/Chicago"), p, RULES, NOW)
    assert "STATE_DNC_NOT_AVAILABLE" in d.block_reasons
    p.state_dnc.datasets["TX"] = fresh("tx", days_old=40)
    d = decide(req(e164=TX_NUMBER, state="TX", tz="America/Chicago"), p, RULES, NOW)
    assert "STATE_DNC_STALE" in d.block_reasons


# --------------------------------------------------------------------------- litigators


def test_litigator_blocks_even_with_written_consent():
    p = clean_ports()
    p.litigators.listed.add(("*", NUMBER))
    p.consents.by_number[NUMBER] = [pewc()]
    d = decide(req(kind=CallKind.CALLBACK_REQUESTED), p, RULES, NOW)
    assert not d.allowed and "LITIGATOR_LISTED" in d.block_reasons


def test_litigator_list_missing_or_stale_blocks():
    p = clean_ports()
    p.litigators.datasets.clear()
    assert "LITIGATOR_NOT_AVAILABLE" in decide(req(), p, RULES, NOW).block_reasons
    p.litigators.datasets["*"] = fresh("lit", days_old=31)
    assert "LITIGATOR_STALE" in decide(req(), p, RULES, NOW).block_reasons


# --------------------------------------------------------------------------- line type (wireless rule)


@pytest.mark.parametrize("lt", [LineType.WIRELESS, LineType.VOIP, LineType.UNKNOWN])
def test_wireless_voip_unknown_blocked_without_pewc(lt):
    d = decide(req(), clean_ports(line_type=lt), RULES, NOW)
    assert not d.allowed
    assert check(d, "line_type").reason_code == f"LINE_TYPE_{lt.value.upper()}_NO_PEWC"


@pytest.mark.parametrize("lt", [LineType.WIRELESS, LineType.VOIP, LineType.UNKNOWN])
def test_wireless_allowed_with_pewc(lt):
    p = clean_ports(line_type=lt)
    p.consents.by_number[NUMBER] = [pewc()]
    d = decide(req(kind=CallKind.CALLBACK_REQUESTED), p, RULES, NOW)
    assert d.allowed and check(d, "line_type").reason_code == f"LINE_TYPE_{lt.value.upper()}_WITH_PEWC"


def test_wireless_with_only_callback_request_is_blocked():
    p = clean_ports(line_type=LineType.WIRELESS)
    p.consents.by_number[NUMBER] = [callback()]
    d = decide(req(kind=CallKind.CALLBACK_REQUESTED), p, RULES, NOW)
    assert "LINE_TYPE_WIRELESS_NO_PEWC" in d.block_reasons


def test_wireless_with_revoked_pewc_is_blocked():
    p = clean_ports(line_type=LineType.WIRELESS)
    p.consents.by_number[NUMBER] = [pewc(revoked=NOW - timedelta(hours=1))]
    d = decide(req(kind=CallKind.CALLBACK_REQUESTED), p, RULES, NOW)
    assert {"CONSENT_REVOKED", "LINE_TYPE_WIRELESS_NO_PEWC"} <= set(d.block_reasons)


def test_missing_line_type_is_unknown_and_blocked():
    p = clean_ports()
    p.line_types.results.clear()
    d = decide(req(), p, RULES, NOW)
    assert check(d, "line_type").reason_code == "LINE_TYPE_UNKNOWN_NO_PEWC"
    assert check(d, "line_type").detail == "no line-type result"


def test_stale_landline_result_is_treated_as_unknown():
    p = clean_ports()
    p.line_types.results[NUMBER] = LineTypeInfo(LineType.LANDLINE, NOW - timedelta(days=91), "test")
    d = decide(req(), p, RULES, NOW)
    assert check(d, "line_type").reason_code == "LINE_TYPE_UNKNOWN_NO_PEWC" and "stale" in check(d, "line_type").detail


def test_mock_landline_result_is_ignored_unless_mock_allowed():
    p = clean_ports()
    p.line_types.results[NUMBER] = LineTypeInfo(LineType.LANDLINE, NOW, "mock", is_mock=True)
    assert check(decide(req(), p, RULES, NOW), "line_type").reason_code == "LINE_TYPE_UNKNOWN_NO_PEWC"
    assert check(decide(req(), p, RULES, NOW, allow_mock_data=True), "line_type").status is CheckStatus.PASS


def test_toll_free_line_type_blocked():
    d = decide(req(), clean_ports(line_type=LineType.TOLL_FREE), RULES, NOW)
    assert "LINE_TYPE_TOLL_FREE" in d.block_reasons


# --------------------------------------------------------------------------- reassigned numbers


def _rn_rules(**kw):
    import dataclasses

    return dataclasses.replace(RULES, reassigned_enabled=True, **kw)


def test_reassigned_disabled_is_skipped():
    d = decide(req(), clean_ports(), RULES, NOW)
    assert check(d, "reassigned").status is CheckStatus.SKIP


def test_reassigned_enabled_without_consent_is_skipped():
    d = decide(req(), clean_ports(), _rn_rules(), NOW)
    assert check(d, "reassigned").reason_code == "REASSIGNED_NO_CONSENT_RELIED_ON"


def test_reassigned_recent_consent_needs_no_query():
    p = clean_ports()
    p.reassigned = FakeReassigned(answer=True)
    p.consents.by_number[NUMBER] = [pewc(captured=NOW - timedelta(days=5))]
    d = decide(req(kind=CallKind.CALLBACK_REQUESTED), p, _rn_rules(), NOW)
    assert d.allowed and p.reassigned.calls == []


@pytest.mark.parametrize("answer,reason,ok", [(False, "REASSIGNED_NOT_DISCONNECTED", True),
                                             (True, "REASSIGNED_SINCE_CONSENT", False),
                                             (None, "REASSIGNED_UNKNOWN", False)])
def test_reassigned_old_consent_is_checked(answer, reason, ok):
    p = clean_ports()
    p.reassigned = FakeReassigned(answer=answer)
    p.consents.by_number[NUMBER] = [pewc(captured=NOW - timedelta(days=100))]
    d = decide(req(kind=CallKind.CALLBACK_REQUESTED), p, _rn_rules(), NOW)
    assert d.allowed is ok and check(d, "reassigned").reason_code == reason
    assert p.reassigned.calls == [(NUMBER, (NOW - timedelta(days=100)).date())]


def test_reassigned_enabled_without_provider_blocks():
    p = clean_ports()
    p.consents.by_number[NUMBER] = [pewc(captured=NOW - timedelta(days=100))]
    d = decide(req(kind=CallKind.CALLBACK_REQUESTED), p, _rn_rules(), NOW)
    assert "REASSIGNED_UNAVAILABLE" in d.block_reasons


# --------------------------------------------------------------------------- calling hours


@pytest.mark.parametrize("h,m,ok", [(7, 59, False), (8, 0, True), (12, 0, True), (20, 59, True), (21, 0, False),
                                    (23, 30, False), (2, 0, False)])
def test_federal_window_in_recipient_local_time(h, m, ok):
    d = decide(req(), clean_ports(), RULES, at_ny(h, m))
    assert d.allowed is ok, (h, m, d.block_reasons)


def test_florida_ends_at_8pm():
    p = clean_ports("+13055551234")
    from zoneinfo import ZoneInfo

    now = datetime(2026, 11, 10, 20, 0, tzinfo=ZoneInfo("America/New_York")).astimezone(timezone.utc)
    d = decide(req(e164="+13055551234", state="FL", tz="America/New_York"), p, RULES, now)
    assert check(d, "calling_hours").reason_code == "OUTSIDE_CALLING_HOURS"
    d = decide(req(e164="+13055551234", state="FL", tz="America/New_York"), p, RULES, now - timedelta(minutes=1))
    assert check(d, "calling_hours").status is CheckStatus.PASS


def test_texas_sunday_starts_at_noon():
    from zoneinfo import ZoneInfo

    ct = ZoneInfo("America/Chicago")
    p = clean_ports()
    sunday_1159 = datetime(2026, 11, 15, 11, 59, tzinfo=ct).astimezone(timezone.utc)
    r = req(e164=TX_NUMBER, state="TX", tz="America/Chicago")
    assert not decide(r, p, RULES, sunday_1159).allowed
    assert decide(r, p, RULES, sunday_1159 + timedelta(minutes=1)).allowed
    monday_0859 = datetime(2026, 11, 16, 8, 59, tzinfo=ct).astimezone(timezone.utc)
    assert not decide(r, p, RULES, monday_0859).allowed  # TX weekdays start 9:00
    assert decide(r, p, RULES, monday_0859 + timedelta(minutes=1)).allowed


def test_louisiana_no_sunday_calls():
    from zoneinfo import ZoneInfo

    p = clean_ports("+15045551234")
    now = datetime(2026, 11, 15, 13, 0, tzinfo=ZoneInfo("America/Chicago")).astimezone(timezone.utc)
    d = decide(req(e164="+15045551234", state="LA", tz="America/Chicago"), p, RULES, now)
    assert check(d, "calling_hours").reason_code == "STATE_NO_SUNDAY_CALLS"


def test_no_call_holiday():
    d = decide(req(), clean_ports(), RULES, at_ny(12, 0, day=26))  # Thanksgiving 2026
    assert check(d, "calling_hours").reason_code == "NO_CALL_DATE"


def test_area_code_zone_differs_from_address_zone_uses_strictest():
    """A New York (ET) cell number belonging to someone whose house is in Dallas (CT)."""
    from zoneinfo import ZoneInfo

    ct = ZoneInfo("America/Chicago")
    p = clean_ports("+12125551234")
    r = req(e164="+12125551234", state="TX", tz="America/Chicago")
    assert candidate_zones(r) == ["America/Chicago", "America/New_York"]
    # 20:30 in Dallas is 21:30 in New York -> blocked
    assert not decide(r, p, RULES, datetime(2026, 11, 10, 20, 30, tzinfo=ct).astimezone(timezone.utc)).allowed
    # 9:30 Dallas = 10:30 NY -> allowed
    assert decide(r, p, RULES, datetime(2026, 11, 10, 9, 30, tzinfo=ct).astimezone(timezone.utc)).allowed


def test_split_zone_area_code_and_unknown_area_code():
    assert candidate_zones(req(e164="+14325551234", state="TX", tz="America/Chicago")) == [
        "America/Chicago", "America/Denver"]
    zones = candidate_zones(req(e164="+19995551234", state="NY", tz="America/New_York"))
    assert zones == ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"]
    # unknown address zone falls back to every zone of the state
    assert candidate_zones(req(e164=TX_NUMBER, state="TX", tz=None)) == ["America/Chicago", "America/Denver"]


def test_unknown_area_code_requires_window_in_pacific_too():
    p = clean_ports("+19995551234")
    r = req(e164="+19995551234")
    assert not decide(r, p, RULES, at_ny(10, 59)).allowed  # 7:59 Pacific
    assert decide(r, p, RULES, at_ny(11, 0)).allowed


def test_dst_spring_forward_and_fall_back():
    from zoneinfo import ZoneInfo

    et = ZoneInfo("America/New_York")
    p = clean_ports()
    # 2026-03-08 clocks jump 2:00 -> 3:00. 12:59 UTC = 08:59 EDT (allowed); a naive UTC-5 assumption would say 7:59.
    assert decide(req(), p, RULES, datetime(2026, 3, 8, 12, 59, tzinfo=timezone.utc)).checks[8].status is \
        CheckStatus.PASS
    assert datetime(2026, 3, 8, 12, 59, tzinfo=timezone.utc).astimezone(et).hour == 8
    # 2026-11-01 clocks fall back. 01:30 UTC Nov 2 = 20:30 EST (allowed); 02:00 UTC = 21:00 EST (blocked)
    assert decide(req(), p, RULES, datetime(2026, 11, 2, 1, 30, tzinfo=timezone.utc)).allowed
    assert not decide(req(), p, RULES, datetime(2026, 11, 2, 2, 0, tzinfo=timezone.utc)).allowed


def test_queue_insert_at_night_is_allowed_with_next_window():
    late = at_ny(22, 15)
    d = decide(req(purpose=Purpose.QUEUE_INSERT), clean_ports(), RULES, late)
    assert d.allowed
    hours = check(d, "calling_hours")
    assert hours.status is CheckStatus.INFO and hours.reason_code == "OUTSIDE_CALLING_HOURS"
    assert d.next_window_start == at_ny(8, 0, day=11)


def test_dial_at_night_is_blocked():
    d = decide(req(), clean_ports(), RULES, at_ny(22, 15))
    assert "OUTSIDE_CALLING_HOURS" in d.block_reasons and d.next_window_start == at_ny(8, 0, day=11)


def test_next_window_skips_the_holiday():
    start = next_window_start(at_ny(22, 0, day=25), ["America/New_York"], RULES, "NY")
    assert start == at_ny(8, 0, day=27)


def test_next_window_none_when_no_window_in_horizon():
    import dataclasses

    from roofsignal.compliance.rules import Window
    from datetime import time

    closed = dataclasses.replace(RULES, federal_window=Window(time(9, 0), time(9, 0)))
    assert next_window_start(NOW, ["America/New_York"], closed, "NY", horizon_days=2) is None
    d = decide(req(purpose=Purpose.QUEUE_INSERT), clean_ports(), closed, NOW)
    assert d.next_window_start is None and "next window" not in check(d, "calling_hours").detail


def test_invalid_recipient_timezone_blocks():
    d = decide(req(tz="Mars/Olympus_Mons"), clean_ports(), RULES, NOW)
    assert check(d, "calling_hours").reason_code == "CALLING_HOURS_UNAVAILABLE"


# --------------------------------------------------------------------------- frequency


def test_global_24h_cap():
    p = clean_ports()
    p.history.attempts = [(NUMBER, NOW - timedelta(hours=2)), (NUMBER, NOW - timedelta(hours=5))]
    d = decide(req(), p, RULES, NOW)
    assert "FREQUENCY_CAP_24H" in d.block_reasons
    p.history.attempts = [(NUMBER, NOW - timedelta(hours=25)), (NUMBER, NOW - timedelta(hours=5))]
    assert decide(req(), p, RULES, NOW).allowed


def test_state_cap_cannot_loosen_the_global_cap():
    """FL allows 3/24h; our global cap is 2, the stricter wins."""
    p = clean_ports("+13055551234")
    p.history.attempts = [("+13055551234", NOW - timedelta(hours=1))] * 2
    d = decide(req(e164="+13055551234", state="FL", tz="America/New_York"), p, RULES, NOW)
    assert "FREQUENCY_CAP_24H" in d.block_reasons and "(cap 2)" in check(d, "frequency").detail


def test_state_cap_tighter_than_global():
    import dataclasses

    loose = dataclasses.replace(RULES, max_attempts_24h=10)
    p = clean_ports("+13055551234")
    p.history.attempts = [("+13055551234", NOW - timedelta(hours=1))] * 3
    d = decide(req(e164="+13055551234", state="FL", tz="America/New_York"), p, loose, NOW)
    assert "(cap 3)" in check(d, "frequency").detail


def test_7_day_cap_and_queue_insert_is_informational():
    p = clean_ports()
    p.history.attempts = [(NUMBER, NOW - timedelta(days=d)) for d in (2, 3, 4, 5, 6)]
    assert "FREQUENCY_CAP_7D" in decide(req(), p, RULES, NOW).block_reasons
    d = decide(req(purpose=Purpose.QUEUE_INSERT), p, RULES, NOW)
    assert d.allowed and check(d, "frequency").status is CheckStatus.INFO


# --------------------------------------------------------------------------- fail closed


@pytest.mark.parametrize(
    "port,check_name,reason",
    [
        ("internal_dnc", "internal_dnc", "INTERNAL_DNC_UNAVAILABLE"),
        ("national_dnc", "national_dnc", "NATIONAL_DNC_UNAVAILABLE"),
        ("litigators", "litigator", "LITIGATOR_UNAVAILABLE"),
        ("consents", "consent", "CONSENT_UNAVAILABLE"),
        ("line_types", "line_type", "LINE_TYPE_UNAVAILABLE"),
        ("history", "frequency", "FREQUENCY_UNAVAILABLE"),
    ],
)
def test_any_provider_error_blocks(port, check_name, reason):
    p = clean_ports()
    getattr(p, port).fail = True
    d = decide(req(), p, RULES, NOW)
    assert not d.allowed
    c = check(d, check_name)
    assert c.status is CheckStatus.BLOCK and c.reason_code == reason and "Boom" in c.detail


def test_state_list_provider_error_blocks():
    p = clean_ports()
    p.state_dnc.fail = True
    d = decide(req(e164=TX_NUMBER, state="TX", tz="America/Chicago"), p, RULES, NOW)
    assert "STATE_DNC_UNAVAILABLE" in d.block_reasons


def test_consent_failure_does_not_crash_dependent_checks():
    """If consent can't be read, checks that depend on it must assume there is no consent."""
    p = clean_ports(line_type=LineType.WIRELESS)
    p.consents.fail = True
    d = decide(req(kind=CallKind.CALLBACK_REQUESTED), p, RULES, NOW)
    assert {"CONSENT_UNAVAILABLE", "LINE_TYPE_WIRELESS_NO_PEWC"} <= set(d.block_reasons)
