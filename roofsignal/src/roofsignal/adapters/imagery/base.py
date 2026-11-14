"""Imagery is only ever sourced from a properly licensed provider (Nearmap, EagleView, or similar) through this
interface. Google Maps / Google Earth imagery must never be scraped or analyzed (their terms forbid it); a test
enforces that no Google imagery host or SDK appears in this codebase."""

from __future__ import annotations

import hashlib
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class RoofCondition:
    condition_score: float  # 0 = like new, 1 = poor condition
    confidence: float
    captured_on: str | None
    provider: str
    is_mock: bool


class ImageryProvider(ABC):
    name: str
    is_mock: bool = False
    unit_cost_usd: str = "0"  # per-parcel cost; checked by SpendGuard for live providers

    @abstractmethod
    def roof_condition(self, parcel_id: str, lon: float, lat: float) -> RoofCondition | None: ...


class MockImageryProvider(ImageryProvider):
    """Deterministic fake scores (hash of parcel id) so the pipeline runs end-to-end without a paid provider.
    Scores from this provider are excluded from real scoring unless a scoring config opts in for demos."""

    name = "mock_imagery"
    is_mock = True

    def roof_condition(self, parcel_id: str, lon: float, lat: float) -> RoofCondition:
        h = int(hashlib.sha256(parcel_id.encode()).hexdigest()[:8], 16)
        return RoofCondition(
            condition_score=round((h % 1000) / 1000, 3),
            confidence=0.5,
            captured_on=None,
            provider=self.name,
            is_mock=True,
        )
