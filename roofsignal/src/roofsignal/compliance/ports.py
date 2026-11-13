"""Everything the gate needs from the outside world. Any method may raise: the gate treats an exception as
'data unavailable' and blocks."""

from __future__ import annotations

from datetime import date, datetime
from typing import Protocol

from roofsignal.compliance.types import ConsentSnapshot, DatasetInfo, LineTypeInfo


class InternalDnc(Protocol):
    def contains(self, e164: str) -> bool: ...


class ScrubList(Protocol):
    """National DNC (keyed by area code), a state list (keyed by state), or a litigator list (key ignored)."""

    def dataset(self, key: str) -> DatasetInfo | None: ...
    def contains(self, key: str, e164: str) -> bool: ...


class ConsentStore(Protocol):
    def for_number(self, e164: str) -> list[ConsentSnapshot]: ...


class LineTypeLookup(Protocol):
    def lookup(self, e164: str) -> LineTypeInfo | None: ...


class ReassignedNumbers(Protocol):
    def disconnected_since(self, e164: str, since: date) -> bool | None: ...


class CallHistory(Protocol):
    def attempts_since(self, e164: str, since: datetime) -> int: ...


class Ports(Protocol):
    internal_dnc: InternalDnc
    national_dnc: ScrubList
    state_dnc: ScrubList
    litigators: ScrubList
    consents: ConsentStore
    line_types: LineTypeLookup
    reassigned: ReassignedNumbers | None
    history: CallHistory
