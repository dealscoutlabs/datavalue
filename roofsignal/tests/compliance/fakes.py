"""In-memory fakes for the compliance ports, plus helpers to build requests and data."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from roofsignal.compliance.rules import load_rules
from roofsignal.compliance.types import (
    CallKind,
    ConsentKind,
    ConsentSnapshot,
    DatasetInfo,
    GateRequest,
    LineType,
    LineTypeInfo,
    Purpose,
)

ROOT = Path(__file__).resolve().parents[2]
RULES = load_rules(ROOT / "config" / "compliance" / "rules.yaml")
DISCLOSURE_SHA = RULES.accepted_disclosures["consent_v1"]

# Tue 2026-11-10 15:00 UTC = 10:00 New York, 09:00 Chicago
NOW = datetime(2026, 11, 10, 15, 0, tzinfo=timezone.utc)
NUMBER = "+16315551234"   # Suffolk (ET)
TX_NUMBER = "+12145551234"  # Dallas (CT)


class Boom(RuntimeError):
    pass


@dataclass
class FakeScrub:
    datasets: dict[str, DatasetInfo] = field(default_factory=dict)
    listed: set[tuple[str, str]] = field(default_factory=set)
    fail: bool = False

    def dataset(self, key):
        if self.fail:
            raise Boom("scrub provider down")
        return self.datasets.get(key)

    def contains(self, key, e164):
        if self.fail:
            raise Boom("scrub provider down")
        return (key, e164) in self.listed


@dataclass
class FakeInternal:
    numbers: set[str] = field(default_factory=set)
    fail: bool = False

    def contains(self, e164):
        if self.fail:
            raise Boom("db down")
        return e164 in self.numbers


@dataclass
class FakeConsents:
    by_number: dict[str, list[ConsentSnapshot]] = field(default_factory=dict)
    fail: bool = False

    def for_number(self, e164):
        if self.fail:
            raise Boom("db down")
        return self.by_number.get(e164, [])


@dataclass
class FakeLineTypes:
    results: dict[str, LineTypeInfo] = field(default_factory=dict)
    fail: bool = False

    def lookup(self, e164):
        if self.fail:
            raise Boom("lookup down")
        return self.results.get(e164)


@dataclass
class FakeReassigned:
    answer: bool | None = False
    calls: list = field(default_factory=list)

    def disconnected_since(self, e164, since: date):
        self.calls.append((e164, since))
        return self.answer


@dataclass
class FakeHistory:
    attempts: list[tuple[str, datetime]] = field(default_factory=list)
    fail: bool = False

    def attempts_since(self, e164, since):
        if self.fail:
            raise Boom("db down")
        return sum(1 for n, t in self.attempts if n == e164 and t >= since)


@dataclass
class FakePorts:
    internal_dnc: FakeInternal = field(default_factory=FakeInternal)
    national_dnc: FakeScrub = field(default_factory=FakeScrub)
    state_dnc: FakeScrub = field(default_factory=FakeScrub)
    litigators: FakeScrub = field(default_factory=FakeScrub)
    consents: FakeConsents = field(default_factory=FakeConsents)
    line_types: FakeLineTypes = field(default_factory=FakeLineTypes)
    reassigned: FakeReassigned | None = None
    history: FakeHistory = field(default_factory=FakeHistory)


def fresh(name="ds", days_old=1.0, mock=False, now=NOW):
    return DatasetInfo(name, now - timedelta(days=days_old), is_mock=mock)


def clean_ports(*numbers, line_type=LineType.LANDLINE, states=("NY", "TX", "FL", "OK", "LA")) -> FakePorts:
    """Ports where every scrub list is fresh and clean and every number is a landline."""
    p = FakePorts()
    for ac in ("631", "516", "212", "214", "972", "305", "405", "504", "999", "432", "850", "915"):
        p.national_dnc.datasets[ac] = fresh(f"ftc-{ac}")
    for st in states:
        p.state_dnc.datasets[st] = fresh(f"state-{st}")
    p.litigators.datasets["*"] = fresh("litigators")
    for n in numbers or (NUMBER, TX_NUMBER):
        p.line_types.results[n] = LineTypeInfo(line_type, NOW - timedelta(days=1), "test")
    return p


def pewc(id="c1", captured=None, revoked=None, version="consent_v1", sha=DISCLOSURE_SHA, sellers=("RoofSignal",)):
    return ConsentSnapshot(id, ConsentKind.PEWC, captured or NOW - timedelta(days=2), revoked, version, sha,
                           tuple(sellers))


def callback(id="cb1", captured=None, revoked=None):
    return ConsentSnapshot(id, ConsentKind.CALLBACK_REQUEST, captured or NOW - timedelta(days=1), revoked, None,
                           None, ())


def req(e164=NUMBER, purpose=Purpose.DIAL, kind=CallKind.OUTBOUND_COLD, state="NY", tz="America/New_York"):
    return GateRequest(e164, purpose, kind, state, tz)
