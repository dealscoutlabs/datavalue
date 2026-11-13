"""The compliance gate. `decide()` is the only way a number may enter an outbound queue or be dialed.

Design rules:
  * Every check runs every time, even after an earlier BLOCK, so the decision log is complete.
  * Fail closed: an exception from any port, missing data, stale data and unknown answers all BLOCK.
  * Mock scrub data (from a mocked provider) never allows a call unless the caller explicitly says mock data is
    acceptable, which the service layer only does while telephony itself is mocked.
  * Calling hours are evaluated in EVERY candidate time zone for the recipient (address zone, and every zone the
    area code could be in); the call must be allowed in all of them.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from roofsignal.compliance import numbers
from roofsignal.compliance.ports import Ports
from roofsignal.compliance.rules import RuleSet, Window
from roofsignal.compliance.types import (
    CallKind,
    CheckResult,
    CheckStatus,
    ConsentKind,
    ConsentSnapshot,
    DatasetInfo,
    Decision,
    GateRequest,
    LineType,
    Purpose,
)

PASS, BLOCK, INFO, SKIP = CheckStatus.PASS, CheckStatus.BLOCK, CheckStatus.INFO, CheckStatus.SKIP


def candidate_zones(req: GateRequest) -> list[str]:
    zones: list[str] = []
    if req.recipient_timezone:
        zones.append(req.recipient_timezone)
    else:
        zones.extend(numbers.STATE_TZ.get((req.recipient_state or "").upper(), numbers.MAINLAND))
    for z in numbers.area_code_zones(req.e164):
        if z not in zones:
            zones.append(z)
    return zones


# --------------------------------------------------------------------------- consent


class _ConsentView:
    """Which consents are usable right now, and why the others are not."""

    def __init__(self, consents: list[ConsentSnapshot], rules: RuleSet, now: datetime) -> None:
        self.valid: list[ConsentSnapshot] = []
        self.problems: list[str] = []
        revocations = [c.revoked_at for c in consents if c.revoked_at is not None and c.revoked_at <= now]
        self.latest_revocation = max(revocations) if revocations else None
        for c in consents:
            if c.captured_at > now:
                self.problems.append("CONSENT_CAPTURED_IN_FUTURE")
            elif c.revoked_at is not None and c.revoked_at <= now:
                self.problems.append("CONSENT_REVOKED")
            elif self.latest_revocation is not None and c.captured_at <= self.latest_revocation:
                # A revocation covers every consent given before it, not only the record it was attached to.
                self.problems.append("CONSENT_REVOKED")
            elif now - c.captured_at > timedelta(days=self._max_age(c, rules)):
                self.problems.append("CONSENT_EXPIRED")
            elif c.kind is ConsentKind.PEWC and not self._disclosure_ok(c, rules):
                self.problems.append("CONSENT_DISCLOSURE_MISMATCH")
            elif c.kind is ConsentKind.PEWC and rules.company_name not in c.seller_names:
                self.problems.append("CONSENT_SELLER_NOT_NAMED")
            else:
                self.valid.append(c)

    @staticmethod
    def _max_age(c: ConsentSnapshot, rules: RuleSet) -> int:
        return rules.pewc_max_age_days if c.kind is ConsentKind.PEWC else rules.callback_request_max_age_days

    @staticmethod
    def _disclosure_ok(c: ConsentSnapshot, rules: RuleSet) -> bool:
        expected = rules.accepted_disclosures.get(c.disclosure_version or "")
        return expected is not None and expected == c.disclosure_sha256

    def kinds(self) -> set[str]:
        return {c.kind.value for c in self.valid}

    def newest(self) -> ConsentSnapshot | None:
        return max(self.valid, key=lambda c: c.captured_at, default=None)


# --------------------------------------------------------------------------- helpers


def _stale(ds: DatasetInfo, max_days: int, now: datetime) -> bool:
    return now - ds.downloaded_at >= timedelta(days=max_days)


def _intersect(a: Window, b: Window) -> Window:
    return Window(max(a.start, b.start), min(a.end, b.end))


def _window_problem(local: datetime, rules: RuleSet, state: str | None) -> str | None:
    if local.date() in rules.no_call_dates:
        return "NO_CALL_DATE"
    sr = rules.state(state)
    window = _intersect(rules.federal_window, sr.window) if sr.window else rules.federal_window
    if local.weekday() == 6:
        if sr.no_sunday_calls:
            return "STATE_NO_SUNDAY_CALLS"
        if sr.sunday_window:
            window = _intersect(window, sr.sunday_window)
    if not window.contains(local.time()):
        return "OUTSIDE_CALLING_HOURS"
    return None


def _hours_problems(at: datetime, zones: list[str], rules: RuleSet, state: str | None) -> list[str]:
    out = []
    for z in zones:
        p = _window_problem(at.astimezone(ZoneInfo(z)), rules, state)
        if p:
            out.append(f"{p}@{z}")
    return out


def next_window_start(now: datetime, zones: list[str], rules: RuleSet, state: str | None,
                      horizon_days: int = 10, step_minutes: int = 15) -> datetime | None:
    t = now.replace(second=0, microsecond=0)
    t += timedelta(minutes=(-t.minute) % step_minutes)
    end = now + timedelta(days=horizon_days)
    while t <= end:
        if not _hours_problems(t, zones, rules, state):
            return t
        t += timedelta(minutes=step_minutes)
    return None


# --------------------------------------------------------------------------- the gate


def decide(req: GateRequest, ports: Ports, rules: RuleSet, now: datetime, allow_mock_data: bool = False) -> Decision:
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    checks: list[CheckResult] = []
    timed = req.purpose is Purpose.DIAL  # time-dependent checks only block at dial time

    def run(name: str, fn: Callable[[], CheckResult]) -> None:
        try:
            checks.append(fn())
        except Exception as exc:  # noqa: BLE001 - any failure to verify is a block
            checks.append(CheckResult(name, BLOCK, f"{name.upper()}_UNAVAILABLE", f"{type(exc).__name__}: {exc}"))

    parts = numbers.parse(req.e164)
    area_code = parts[0] if parts else ""
    state = (req.recipient_state or "").upper() or None

    # 1. number validity --------------------------------------------------------------
    def number_validity() -> CheckResult:
        problem = numbers.validity_problem(req.e164)
        return CheckResult("number_validity", BLOCK if problem else PASS, problem or "NUMBER_VALID")

    run("number_validity", number_validity)

    # 2. internal do-not-call list -------------------------------------------------------
    def internal_dnc() -> CheckResult:
        if ports.internal_dnc.contains(req.e164):
            return CheckResult("internal_dnc", BLOCK, "INTERNAL_DNC_LISTED")
        return CheckResult("internal_dnc", PASS, "INTERNAL_DNC_CLEAR")

    run("internal_dnc", internal_dnc)

    # 3. consent ---------------------------------------------------------------------------
    view_box: list[_ConsentView] = []

    def consent() -> CheckResult:
        view = _ConsentView(ports.consents.for_number(req.e164), rules, now)
        view_box.append(view)
        if view.valid:
            newest = view.newest()
            return CheckResult("consent", PASS, f"CONSENT_VALID_{newest.kind.value.upper()}",
                               f"consent {newest.id} captured {newest.captured_at.isoformat()}")
        if req.call_kind is CallKind.CALLBACK_REQUESTED:
            reason = view.problems[-1] if view.problems else "CONSENT_MISSING"
            return CheckResult("consent", BLOCK, reason, ", ".join(sorted(set(view.problems))))
        if view.latest_revocation is not None:
            return CheckResult("consent", BLOCK, "CONSENT_REVOKED",
                               f"revoked {view.latest_revocation.isoformat()}; no newer consent")
        return CheckResult("consent", PASS, "CONSENT_NOT_REQUIRED_COLD_CALL")

    run("consent", consent)
    valid_kinds = view_box[0].kinds() if view_box else set()

    # 4/5/6. scrub lists ---------------------------------------------------------------------
    def scrub(name: str, port, key: str, max_days: int, overridable: bool, prefix: str) -> CheckResult:
        ds = port.dataset(key)
        if ds is None:
            return CheckResult(name, BLOCK, f"{prefix}_NOT_AVAILABLE", f"no dataset for {key!r}")
        version = f"{ds.name}@{ds.downloaded_at.isoformat()}"
        if ds.is_mock and not allow_mock_data:
            return CheckResult(name, BLOCK, f"{prefix}_MOCK_DATA", "mock scrub data cannot authorize a call", version)
        if _stale(ds, max_days, now):
            age = (now - ds.downloaded_at).days
            return CheckResult(name, BLOCK, f"{prefix}_STALE", f"data is {age} days old (max {max_days - 1})", version)
        if port.contains(key, req.e164):
            if overridable and valid_kinds & rules.dnc_override_kinds:
                return CheckResult(name, PASS, f"{prefix}_LISTED_CONSENT_OVERRIDE", "", version)
            return CheckResult(name, BLOCK, f"{prefix}_LISTED", "", version)
        return CheckResult(name, PASS, f"{prefix}_CLEAR", "", version)

    run("national_dnc", lambda: scrub("national_dnc", ports.national_dnc, area_code,
                                      rules.national_dnc_max_age_days, True, "NATIONAL_DNC"))

    def state_dnc() -> CheckResult:
        if state is None:
            return CheckResult("state_dnc", BLOCK, "RECIPIENT_STATE_UNKNOWN", "state rules cannot be applied")
        if not rules.state(state).state_dnc_list:
            return CheckResult("state_dnc", SKIP, "STATE_DNC_NOT_APPLICABLE", state)
        return scrub("state_dnc", ports.state_dnc, state, rules.state_dnc_max_age_days, True, "STATE_DNC")

    run("state_dnc", state_dnc)
    run("litigator", lambda: scrub("litigator", ports.litigators, "*", rules.litigator_max_age_days, False,
                                   "LITIGATOR"))

    # 7. line type ----------------------------------------------------------------------------
    def line_type() -> CheckResult:
        info = ports.line_types.lookup(req.e164)
        lt = LineType.UNKNOWN
        detail = "no line-type result"
        if info is not None:
            if info.is_mock and not allow_mock_data:
                detail = "mock line-type data ignored"
            elif now - info.checked_at > timedelta(days=rules.line_type_max_age_days):
                detail = f"line-type result from {info.checked_at.date()} is stale"
            else:
                lt, detail = info.line_type, f"{info.source} {info.checked_at.date()}"
        if lt is LineType.TOLL_FREE:
            return CheckResult("line_type", BLOCK, "LINE_TYPE_TOLL_FREE", detail)
        if lt is LineType.LANDLINE:
            return CheckResult("line_type", PASS, "LINE_TYPE_LANDLINE", detail)
        if valid_kinds & rules.wireless_kinds:
            return CheckResult("line_type", PASS, f"LINE_TYPE_{lt.value.upper()}_WITH_PEWC", detail)
        return CheckResult("line_type", BLOCK, f"LINE_TYPE_{lt.value.upper()}_NO_PEWC", detail)

    run("line_type", line_type)

    # 8. reassigned numbers --------------------------------------------------------------------
    def reassigned() -> CheckResult:
        newest = view_box[0].newest() if view_box else None
        if not rules.reassigned_enabled:
            return CheckResult("reassigned", SKIP, "REASSIGNED_CHECK_DISABLED")
        if newest is None:
            return CheckResult("reassigned", SKIP, "REASSIGNED_NO_CONSENT_RELIED_ON")
        if now - newest.captured_at < timedelta(days=rules.reassigned_after_days):
            return CheckResult("reassigned", PASS, "REASSIGNED_CONSENT_RECENT")
        if ports.reassigned is None:
            return CheckResult("reassigned", BLOCK, "REASSIGNED_UNAVAILABLE", "no provider configured")
        result = ports.reassigned.disconnected_since(req.e164, newest.captured_at.date())
        if result is None:
            return CheckResult("reassigned", BLOCK, "REASSIGNED_UNKNOWN")
        if result:
            return CheckResult("reassigned", BLOCK, "REASSIGNED_SINCE_CONSENT")
        return CheckResult("reassigned", PASS, "REASSIGNED_NOT_DISCONNECTED")

    run("reassigned", reassigned)

    # 9. calling hours in every candidate zone ------------------------------------------------
    zones = candidate_zones(req)
    next_start: list[datetime | None] = [None]

    def calling_hours() -> CheckResult:
        problems = _hours_problems(now, zones, rules, state)
        if not problems:
            return CheckResult("calling_hours", PASS, "WITHIN_CALLING_HOURS", ", ".join(zones))
        next_start[0] = next_window_start(now, zones, rules, state)
        reason = problems[0].split("@")[0]
        detail = "; ".join(problems) + (f"; next window {next_start[0].isoformat()}" if next_start[0] else "")
        return CheckResult("calling_hours", BLOCK if timed else INFO, reason, detail)

    run("calling_hours", calling_hours)

    # 10. frequency caps -------------------------------------------------------------------------
    def frequency() -> CheckResult:
        cap_24h = rules.max_attempts_24h
        state_cap = rules.state(state).max_attempts_24h
        if state_cap is not None:
            cap_24h = min(cap_24h, state_cap)
        n24 = ports.history.attempts_since(req.e164, now - timedelta(hours=24))
        n7 = ports.history.attempts_since(req.e164, now - timedelta(days=7))
        status = BLOCK if timed else INFO
        if n24 >= cap_24h:
            return CheckResult("frequency", status, "FREQUENCY_CAP_24H", f"{n24} attempts in 24h (cap {cap_24h})")
        if n7 >= rules.max_attempts_7d:
            return CheckResult("frequency", status, "FREQUENCY_CAP_7D",
                               f"{n7} attempts in 7d (cap {rules.max_attempts_7d})")
        return CheckResult("frequency", PASS, "FREQUENCY_OK", f"{n24}/24h, {n7}/7d")

    run("frequency", frequency)

    allowed = all(c.status is not BLOCK for c in checks)
    return Decision(
        e164=req.e164, purpose=req.purpose, call_kind=req.call_kind, allowed=allowed, checks=checks,
        ruleset_version=rules.version, ruleset_hash=rules.hash, evaluated_at=now, recipient_timezones=zones,
        next_window_start=next_start[0],
    )


__all__ = ["decide", "candidate_zones", "next_window_start"]
