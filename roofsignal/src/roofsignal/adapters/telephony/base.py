"""Telephony port. Phase 1 only needs tracking numbers for mail campaigns; calling arrives in Phase 2.
The mock hands out numbers from the 555-0100..0199 range reserved for fiction, so nothing real is ever printed
by accident without a provider."""

from __future__ import annotations

from abc import ABC, abstractmethod


class TelephonyProvider(ABC):
    name: str
    is_mock: bool = False

    @abstractmethod
    def allocate_tracking_number(self, area_code: str, label: str) -> str: ...


class MockTelephony(TelephonyProvider):
    name = "mock_telephony"
    is_mock = True

    def __init__(self) -> None:
        self._next = 100

    def allocate_tracking_number(self, area_code: str, label: str) -> str:
        n = self._next
        self._next = 100 + (self._next - 99) % 100
        return f"+1{area_code}555{n:04d}"
