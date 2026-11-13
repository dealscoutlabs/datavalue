from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import date, time
from pathlib import Path
from typing import Any

import yaml


def _t(s: str) -> time:
    h, m = s.split(":")
    return time(int(h), int(m))


@dataclass(frozen=True)
class Window:
    start: time
    end: time  # exclusive: a call may start strictly before `end`

    @classmethod
    def from_dict(cls, d: dict) -> Window:
        return cls(_t(d["start"]), _t(d["end"]))

    def contains(self, t: time) -> bool:
        return self.start <= t < self.end


@dataclass(frozen=True)
class StateRule:
    window: Window | None = None
    sunday_window: Window | None = None
    no_sunday_calls: bool = False
    max_attempts_24h: int | None = None
    state_dnc_list: bool = False


@dataclass(frozen=True)
class RuleSet:
    version: str
    hash: str
    company_name: str
    national_dnc_max_age_days: int
    state_dnc_max_age_days: int
    litigator_max_age_days: int
    line_type_max_age_days: int
    pewc_max_age_days: int
    callback_request_max_age_days: int
    accepted_disclosures: dict[str, str]
    dnc_override_kinds: frozenset[str]
    wireless_kinds: frozenset[str]
    reassigned_enabled: bool
    reassigned_after_days: int
    federal_window: Window
    max_attempts_24h: int
    max_attempts_7d: int
    states: dict[str, StateRule] = field(default_factory=dict)
    no_call_dates: frozenset[date] = frozenset()

    def state(self, code: str | None) -> StateRule:
        return self.states.get((code or "").upper(), StateRule())


def load_rules(path: Path, disclosures_dir: Path | None = None) -> RuleSet:
    raw: dict[str, Any] = yaml.safe_load(path.read_text())
    consent = raw["consent"]
    accepted = dict(consent.get("accepted_disclosures") or {})
    disclosures_dir = disclosures_dir or path.parent.parent / "disclosures"
    for version in list(accepted):
        text = (disclosures_dir / f"{version}.txt").read_text()
        accepted[version] = hashlib.sha256(text.encode()).hexdigest()
    digest = hashlib.sha256(json.dumps({"rules": raw, "disclosures": accepted}, sort_keys=True,
                                       default=str).encode()).hexdigest()
    states = {
        code.upper(): StateRule(
            window=Window.from_dict(v["window"]) if v.get("window") else None,
            sunday_window=Window.from_dict(v["sunday_window"]) if v.get("sunday_window") else None,
            no_sunday_calls=bool(v.get("no_sunday_calls")),
            max_attempts_24h=v.get("max_attempts_24h"),
            state_dnc_list=bool(v.get("state_dnc_list")),
        )
        for code, v in (raw.get("states") or {}).items()
    }
    rn = raw.get("reassigned_numbers") or {}
    return RuleSet(
        version=str(raw["version"]),
        hash=digest,
        company_name=raw["company_name"],
        national_dnc_max_age_days=int(raw["national_dnc_max_age_days"]),
        state_dnc_max_age_days=int(raw["state_dnc_max_age_days"]),
        litigator_max_age_days=int(raw["litigator_max_age_days"]),
        line_type_max_age_days=int(raw["line_type_max_age_days"]),
        pewc_max_age_days=int(consent["pewc_max_age_days"]),
        callback_request_max_age_days=int(consent["callback_request_max_age_days"]),
        accepted_disclosures=accepted,
        dnc_override_kinds=frozenset(consent.get("dnc_override_kinds") or []),
        wireless_kinds=frozenset(consent.get("wireless_kinds") or []),
        reassigned_enabled=bool(rn.get("enabled")),
        reassigned_after_days=int(rn.get("check_if_consent_older_than_days", 30)),
        federal_window=Window.from_dict(raw["federal_window"]),
        max_attempts_24h=int(raw["caps"]["max_attempts_24h"]),
        max_attempts_7d=int(raw["caps"]["max_attempts_7d"]),
        states=states,
        no_call_dates=frozenset(date.fromisoformat(str(d)) for d in raw.get("no_call_dates") or []),
    )
