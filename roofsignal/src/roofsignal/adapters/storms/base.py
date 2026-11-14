from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from roofsignal.db.models import StormType

KNOTS_TO_MPH = 1.150779


@dataclass
class StormReport:
    source: str
    source_id: str
    event_type: StormType
    magnitude: float | None  # hail: inches; wind: mph
    occurred_at: datetime  # tz-aware UTC
    lon: float
    lat: float
    end_lon: float | None = None
    end_lat: float | None = None
    location_label: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


BBox = tuple[float, float, float, float]


def in_bbox(lon: float, lat: float, bbox: BBox) -> bool:
    return bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]


class StormSource(ABC):
    name: str

    @abstractmethod
    def iter_reports(self, start: date, end: date, bbox: BBox) -> Iterator[StormReport]: ...
