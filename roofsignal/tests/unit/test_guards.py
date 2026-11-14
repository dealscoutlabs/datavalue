"""Build-level guards for the non-negotiable rules."""

import re
from pathlib import Path

import pytest

from roofsignal.adapters.factory import imagery_provider, telephony_provider
from roofsignal.core.settings import Settings
from roofsignal.core.spend import SpendApprovalRequired

ROOT = Path(__file__).resolve().parents[2]
GOOGLE = re.compile(
    r"(maps\.googleapis\.com|maps\.google\.|google\.com/maps|earth\.google|googleusercontent|khms?\d*\.google|"
    r"mt\d\.google|staticmap|googlemaps|google[-_.]?earth|gmaps)",
    re.IGNORECASE,
)


def _code_files():
    for base in (ROOT / "src", ROOT / "config", ROOT / "web" / "src"):
        for p in base.rglob("*"):
            if p.is_file() and p.suffix in {".py", ".yaml", ".ts", ".tsx", ".js", ".json"}:
                yield p


def test_no_google_maps_or_earth_anywhere_in_code():
    offenders = [str(p) for p in _code_files() if GOOGLE.search(p.read_text(errors="ignore"))]
    assert offenders == []


def test_paid_providers_default_to_mocks():
    s = Settings(database_url="sqlite://")
    assert imagery_provider(None, s).is_mock
    assert telephony_provider(None, s).is_mock
    assert s.paid_providers_enabled is False


def test_live_provider_refused_without_approval():
    s = Settings(database_url="sqlite://", imagery_provider="nearmap")
    with pytest.raises(SpendApprovalRequired):
        imagery_provider(None, s)
    s2 = Settings(database_url="sqlite://", telephony_provider="twilio", paid_providers_enabled=True,
                  approved_providers=["twilio"])
    with pytest.raises(SpendApprovalRequired):
        telephony_provider(None, s2)  # no session -> no guard -> refused


def test_env_example_lists_every_setting():
    env = (ROOT / ".env.example").read_text()
    for name in Settings.model_fields:
        assert name.upper() in env, name
