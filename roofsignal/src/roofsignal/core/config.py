"""Loads YAML config: per-county adapters/sources and scoring weights. Config is hashed so every scoring run
records exactly which weights produced it."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

from roofsignal.core.settings import get_settings


class JurisdictionConfig(BaseModel):
    name: str
    kind: str = "town"
    permit_data_status: str = "none"


class CountyConfig(BaseModel):
    key: str
    name: str
    state: str
    fips: str
    timezone: str
    bbox: tuple[float, float, float, float]  # min_lon, min_lat, max_lon, max_lat
    parcels: dict[str, Any]
    jurisdictions: list[JurisdictionConfig] = Field(default_factory=list)
    storms: dict[str, Any] = Field(default_factory=dict)
    permit_feeds: list[dict[str, Any]] = Field(default_factory=list)
    area_code: str | None = None
    notes: str | None = None


class SignalWeight(BaseModel):
    weight: float
    enabled: bool = True
    params: dict[str, Any] = Field(default_factory=dict)


class TradeScoring(BaseModel):
    enabled: bool = True
    signals: dict[str, SignalWeight]
    tiers: dict[str, float]  # tier letter -> minimum score, e.g. {"A": 70, "B": 50, "C": 30}
    include_mock_signals: bool = False


class ScoringConfig(BaseModel):
    version: str
    trades: dict[str, TradeScoring]

    def config_hash(self) -> str:
        return hashlib.sha256(json.dumps(self.model_dump(), sort_keys=True).encode()).hexdigest()


def _config_dir(config_dir: Path | None) -> Path:
    return config_dir or get_settings().config_dir


def load_county(key: str, config_dir: Path | None = None) -> CountyConfig:
    path = _config_dir(config_dir) / "counties" / f"{key}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"No county config at {path}")
    return CountyConfig.model_validate(yaml.safe_load(path.read_text()))


def list_counties(config_dir: Path | None = None) -> list[str]:
    return sorted(p.stem for p in (_config_dir(config_dir) / "counties").glob("*.yaml"))


def load_scoring(config_dir: Path | None = None, path: Path | None = None) -> ScoringConfig:
    path = path or _config_dir(config_dir) / "scoring.yaml"
    return ScoringConfig.model_validate(yaml.safe_load(path.read_text()))
