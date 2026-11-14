"""Telephony port. Mocked until a provider (e.g. Twilio) is approved.

The mock hands out numbers from the 555-0100..0199 range reserved for fiction, so nothing real is ever printed or
dialed by accident."""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class CallResult:
    provider_call_id: str
    status: str  # queued | ringing | completed | busy | no_answer | failed


class TelephonyProvider(ABC):
    name: str
    is_mock: bool = False

    @abstractmethod
    def allocate_tracking_number(self, area_code: str, label: str) -> str: ...

    @abstractmethod
    def place_call(self, to_e164: str, from_e164: str, agent_ref: str) -> CallResult: ...


class MockTelephony(TelephonyProvider):
    name = "mock_telephony"
    is_mock = True

    def __init__(self) -> None:
        self._next = 100
        self.calls: list[tuple[str, str, str]] = []

    def allocate_tracking_number(self, area_code: str, label: str) -> str:
        n = self._next
        self._next = 100 + (self._next - 99) % 100
        return f"+1{area_code}555{n:04d}"

    def place_call(self, to_e164: str, from_e164: str, agent_ref: str) -> CallResult:
        self.calls.append((to_e164, from_e164, agent_ref))
        return CallResult(f"mock-{uuid.uuid4().hex[:12]}", "completed")
