from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ParcelRecord:
    parcel_id: str
    sbl: str | None = None
    swis: str | None = None
    town: str | None = None
    municipality: str | None = None
    site_address: str | None = None
    zip: str | None = None
    property_class: str | None = None
    year_built: int | None = None
    owner_name: str | None = None
    owner_mail_address: str | None = None
    owner_mail_city: str | None = None
    owner_mail_state: str | None = None
    owner_mail_zip: str | None = None
    geometry: dict[str, Any] | None = None  # GeoJSON geometry, EPSG:4326
    owner_info_restricted: bool = False
    attributes: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict)


class ParcelSource(ABC):
    """One implementation per data source. County YAML picks the adapter and its params."""

    name: str
    source_version: str | None = None

    @abstractmethod
    def iter_parcels(self, *, limit: int | None = None) -> Iterator[ParcelRecord]: ...
