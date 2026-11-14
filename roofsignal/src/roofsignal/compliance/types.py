from __future__ import annotations

import enum
from dataclasses import dataclass, field
from datetime import datetime


class Purpose(str, enum.Enum):
    QUEUE_INSERT = "queue_insert"  # may this number enter an outbound queue at all?
    DIAL = "dial"                  # may an agent dial it right now?


class CallKind(str, enum.Enum):
    OUTBOUND_COLD = "outbound_cold"            # we initiate; no request from the homeowner
    CALLBACK_REQUESTED = "callback_requested"  # homeowner asked us to call (web form or inbound call)


class ConsentKind(str, enum.Enum):
    PEWC = "pewc"                          # prior express written consent (signed web form with disclosure)
    CALLBACK_REQUEST = "callback_request"  # homeowner asked for a call back, without written consent


class LineType(str, enum.Enum):
    LANDLINE = "landline"
    WIRELESS = "wireless"
    VOIP = "voip"
    TOLL_FREE = "toll_free"
    UNKNOWN = "unknown"


class CheckStatus(str, enum.Enum):
    PASS = "pass"
    BLOCK = "block"
    INFO = "info"   # recorded but not blocking for this purpose (e.g. calling hours at queue time)
    SKIP = "skip"   # not applicable (e.g. reassigned-number check disabled)


@dataclass(frozen=True)
class ConsentSnapshot:
    id: str
    kind: ConsentKind
    captured_at: datetime
    revoked_at: datetime | None
    disclosure_version: str | None
    disclosure_sha256: str | None
    seller_names: tuple[str, ...] = ()


@dataclass(frozen=True)
class DatasetInfo:
    """A scrub list (national DNC area code, state list, litigator list) and when it was downloaded."""
    name: str
    downloaded_at: datetime
    is_mock: bool = False


@dataclass(frozen=True)
class LineTypeInfo:
    line_type: LineType
    checked_at: datetime
    source: str
    is_mock: bool = False


@dataclass(frozen=True)
class GateRequest:
    e164: str
    purpose: Purpose
    call_kind: CallKind
    recipient_state: str | None      # two-letter state of the recipient's address
    recipient_timezone: str | None   # IANA zone of the recipient's address (property county), if known
    actor: str = "system"


@dataclass(frozen=True)
class CheckResult:
    check: str
    status: CheckStatus
    reason_code: str
    detail: str = ""
    data_version: str | None = None


@dataclass
class Decision:
    e164: str
    purpose: Purpose
    call_kind: CallKind
    allowed: bool
    checks: list[CheckResult]
    ruleset_version: str
    ruleset_hash: str
    evaluated_at: datetime
    recipient_timezones: list[str] = field(default_factory=list)
    next_window_start: datetime | None = None  # earliest time the calling-hours check would pass (UTC)

    @property
    def block_reasons(self) -> list[str]:
        return [c.reason_code for c in self.checks if c.status is CheckStatus.BLOCK]
