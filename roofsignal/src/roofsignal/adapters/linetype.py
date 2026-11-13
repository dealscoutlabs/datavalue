"""Line-type lookup (wireless / landline / VoIP). Paid in reality (e.g. carrier lookup APIs); mocked here.

The mock deliberately answers UNKNOWN: the gate treats unknown like wireless, so with the mock only numbers
backed by prior express written consent can ever pass. That is the safe failure mode."""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timezone

from roofsignal.compliance.types import LineType, LineTypeInfo


class LineTypeProvider(ABC):
    name: str
    is_mock: bool = False

    @abstractmethod
    def lookup(self, e164: str) -> LineTypeInfo | None: ...


class MockLineTypeProvider(LineTypeProvider):
    name = "mock_line_type"
    is_mock = True

    def lookup(self, e164: str) -> LineTypeInfo:
        return LineTypeInfo(LineType.UNKNOWN, datetime.now(timezone.utc), self.name, is_mock=True)
