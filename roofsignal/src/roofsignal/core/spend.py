"""SpendGuard: the only path by which a paid/metered provider may be called.

Rules (from the product brief):
  * Nothing paid runs unless PAID_PROVIDERS_ENABLED is true AND the provider is listed in APPROVED_PROVIDERS.
  * Cumulative spend may never exceed the latest human approval in `spend_approval`.
  * A human can raise the approval by at most one step (default $5) beyond what has actually been spent,
    so the system pauses for confirmation at every $5 of cumulative spend.

Adapters call `authorize()` *before* each billable request and get back a ledger entry; if the call fails
upstream they still keep the ledger entry (providers usually bill for failed calls too).
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from roofsignal.core.settings import Settings, get_settings
from roofsignal.db.models import SpendApproval, SpendLedger


class SpendApprovalRequired(RuntimeError):
    """Raised when a paid call is not (or no longer) approved. The message says exactly what is needed."""


@dataclass(frozen=True)
class SpendStatus:
    spent_usd: Decimal
    approved_through_usd: Decimal

    @property
    def remaining_usd(self) -> Decimal:
        return max(Decimal("0"), self.approved_through_usd - self.spent_usd)


class SpendGuard:
    def __init__(self, session: Session, settings: Settings | None = None) -> None:
        self.session = session
        self.settings = settings or get_settings()

    # ------------------------------------------------------------------ queries
    def status(self) -> SpendStatus:
        spent = self.session.scalar(select(func.coalesce(func.sum(SpendLedger.amount_usd), 0)))
        approved = self.session.scalar(
            select(SpendApproval.approved_through_usd).order_by(SpendApproval.created_at.desc()).limit(1)
        )
        return SpendStatus(Decimal(spent), Decimal(approved or 0))

    def is_provider_live(self, provider: str) -> bool:
        return self.settings.paid_providers_enabled and provider in self.settings.approved_providers

    # ------------------------------------------------------------------ approvals
    def approve(self, approved_through_usd: Decimal, approved_by: str, note: str | None = None) -> SpendApproval:
        if not approved_by.strip():
            raise ValueError("approved_by is required")
        status = self.status()
        ceiling = status.spent_usd + self.settings.spend_step_usd
        if approved_through_usd > ceiling:
            raise SpendApprovalRequired(
                f"An approval can only extend ${self.settings.spend_step_usd} past actual spend "
                f"(spent ${status.spent_usd:.2f}; max approvable now ${ceiling:.2f})."
            )
        if approved_through_usd < status.spent_usd:
            raise ValueError("Cannot approve less than what has already been spent")
        row = SpendApproval(approved_through_usd=approved_through_usd, approved_by=approved_by, note=note)
        self.session.add(row)
        self.session.flush()
        return row

    # ------------------------------------------------------------------ the gate
    def authorize(self, provider: str, operation: str, units: int, unit_cost_usd: Decimal) -> SpendLedger:
        if units <= 0:
            raise ValueError("units must be positive")
        if not self.settings.paid_providers_enabled:
            raise SpendApprovalRequired("PAID_PROVIDERS_ENABLED is false; paid providers are mocked.")
        if provider not in self.settings.approved_providers:
            raise SpendApprovalRequired(f"Provider '{provider}' is not in APPROVED_PROVIDERS.")
        amount = (unit_cost_usd * units).quantize(Decimal("0.0001"))
        status = self.status()
        if status.spent_usd + amount > status.approved_through_usd:
            raise SpendApprovalRequired(
                f"{provider}.{operation} would cost ${amount} and push spend to "
                f"${status.spent_usd + amount:.2f}, past the approved ${status.approved_through_usd:.2f}. "
                "Ask the owner to approve the next step."
            )
        entry = SpendLedger(
            provider=provider, operation=operation, units=units, unit_cost_usd=unit_cost_usd, amount_usd=amount
        )
        self.session.add(entry)
        self.session.flush()
        return entry
