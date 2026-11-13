"""TCPA / DNC compliance gate.

A standalone, dependency-free package: no web framework, no ORM. Everything it needs comes through the ports in
`ports.py`, so it can be tested exhaustively with in-memory fakes and an injected clock. The single entry point is
`gate.decide()`. It FAILS CLOSED: missing data, stale data, an unknown answer or a provider error all mean BLOCK.

NOT LEGAL ADVICE: rule values live in config/compliance/rules.yaml and must be confirmed by counsel.
"""

from roofsignal.compliance.gate import decide
from roofsignal.compliance.types import (
    CallKind,
    CheckResult,
    CheckStatus,
    ConsentKind,
    ConsentSnapshot,
    Decision,
    GateRequest,
    LineType,
    Purpose,
)

__all__ = [
    "decide", "CallKind", "CheckResult", "CheckStatus", "ConsentKind", "ConsentSnapshot", "Decision",
    "GateRequest", "LineType", "Purpose",
]
