"""Runtime settings. Every value comes from the environment (see .env.example); nothing secret lives in code."""

from __future__ import annotations

from decimal import Decimal
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+psycopg://roofsignal:roofsignal@localhost:5432/roofsignal"
    redis_url: str = "redis://localhost:6379/0"

    config_dir: Path = PROJECT_ROOT / "config"
    data_cache_dir: Path = PROJECT_ROOT / ".cache" / "data"

    # Generic client name: never put personal contact details in outbound requests.
    http_user_agent: str = "RoofSignal-ingest/0.1"
    http_timeout_seconds: float = 120.0

    # --- Paid-provider safety (see core/spend.py). Defaults keep every paid provider mocked. ---
    paid_providers_enabled: bool = False
    approved_providers: list[str] = Field(default_factory=list)
    imagery_provider: str = "mock"
    telephony_provider: str = "mock"
    line_type_provider: str = "mock"
    # Outbound caller ID used for agent calls (must be a number we own once telephony is live).
    outbound_caller_id: str = "+15555550100"

    # Session lifetime for logged-in staff.
    session_hours: int = 12

    # Shared secret proving a request came from our own Next.js server (never sent to browsers). Staff requests
    # additionally carry a per-user session token.
    service_api_token: str | None = None

    landing_base_url: str = "http://localhost:3000"

    spend_step_usd: Decimal = Decimal("5.00")


@lru_cache
def get_settings() -> Settings:
    return Settings()
