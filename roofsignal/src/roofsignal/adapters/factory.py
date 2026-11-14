"""Adapter factories. Paid providers default to mocks; a live provider is only returned when SpendGuard says the
provider is enabled and approved. No live paid adapter is implemented yet (none has been approved)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from roofsignal.adapters.imagery.base import ImageryProvider, MockImageryProvider
from roofsignal.adapters.telephony.base import MockTelephony, TelephonyProvider
from roofsignal.core.settings import Settings, get_settings
from roofsignal.core.spend import SpendApprovalRequired, SpendGuard

_LIVE_IMAGERY: dict[str, type[ImageryProvider]] = {}
_LIVE_TELEPHONY: dict[str, type[TelephonyProvider]] = {}


def _resolve(kind: str, requested: str, registry: dict, mock, session: Session | None, settings: Settings):
    if requested == "mock":
        return mock()
    guard = SpendGuard(session, settings) if session is not None else None
    if guard is None or not guard.is_provider_live(requested):
        raise SpendApprovalRequired(
            f"{kind} provider '{requested}' is paid and not approved. Set it back to 'mock' or get approval."
        )
    if requested not in registry:
        raise NotImplementedError(f"No live {kind} adapter named '{requested}' has been built yet.")
    return registry[requested](guard)


def imagery_provider(session: Session | None = None, settings: Settings | None = None) -> ImageryProvider:
    s = settings or get_settings()
    return _resolve("imagery", s.imagery_provider, _LIVE_IMAGERY, MockImageryProvider, session, s)


def telephony_provider(session: Session | None = None, settings: Settings | None = None) -> TelephonyProvider:
    s = settings or get_settings()
    return _resolve("telephony", s.telephony_provider, _LIVE_TELEPHONY, MockTelephony, session, s)
