from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from roofsignal.core.settings import Settings
from roofsignal.core.spend import SpendApprovalRequired, SpendGuard
from roofsignal.db.models import Base, SpendApproval, SpendLedger


@pytest.fixture
def session():
    eng = create_engine("sqlite://")
    Base.metadata.create_all(eng, tables=[SpendApproval.__table__, SpendLedger.__table__])
    with Session(eng) as s:
        yield s


def settings(**kw):
    base = {"paid_providers_enabled": True, "approved_providers": ["lookup"], "database_url": "sqlite://"}
    return Settings(**{**base, **kw})


def test_disabled_by_default(session):
    g = SpendGuard(session, Settings(database_url="sqlite://"))
    assert not g.is_provider_live("lookup")
    with pytest.raises(SpendApprovalRequired, match="PAID_PROVIDERS_ENABLED"):
        g.authorize("lookup", "q", 1, Decimal("0.01"))


def test_unapproved_provider_refused(session):
    with pytest.raises(SpendApprovalRequired, match="not in APPROVED_PROVIDERS"):
        SpendGuard(session, settings()).authorize("imagery", "q", 1, Decimal("0.01"))


def test_no_approval_means_no_spend(session):
    with pytest.raises(SpendApprovalRequired, match="past the approved"):
        SpendGuard(session, settings()).authorize("lookup", "q", 1, Decimal("0.01"))


def test_spend_within_approval_then_stops_at_ceiling(session):
    g = SpendGuard(session, settings())
    g.approve(Decimal("5.00"), "owner")
    for _ in range(4):
        g.authorize("lookup", "q", 100, Decimal("0.01"))  # $1 each
    assert g.status().spent_usd == Decimal("4.00")
    g.authorize("lookup", "q", 100, Decimal("0.01"))  # exactly $5
    with pytest.raises(SpendApprovalRequired):
        g.authorize("lookup", "q", 1, Decimal("0.01"))
    assert g.status().remaining_usd == 0


def test_approval_limited_to_one_step_past_actual_spend(session):
    g = SpendGuard(session, settings())
    with pytest.raises(SpendApprovalRequired, match="max approvable"):
        g.approve(Decimal("10.00"), "owner")
    g.approve(Decimal("5.00"), "owner")
    g.authorize("lookup", "q", 300, Decimal("0.01"))  # $3
    with pytest.raises(SpendApprovalRequired):
        g.approve(Decimal("8.01"), "owner")
    g.approve(Decimal("8.00"), "owner")
    assert g.status().approved_through_usd == Decimal("8.00")


def test_approval_validation(session):
    g = SpendGuard(session, settings())
    with pytest.raises(ValueError):
        g.approve(Decimal("1"), "  ")
    g.approve(Decimal("2"), "owner")
    g.authorize("lookup", "q", 2, Decimal("1"))
    with pytest.raises(ValueError):
        g.approve(Decimal("1"), "owner")
    with pytest.raises(ValueError):
        g.authorize("lookup", "q", 0, Decimal("1"))
