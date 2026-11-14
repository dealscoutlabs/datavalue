"""Database-backed implementations of the compliance gate's ports."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from roofsignal.adapters.linetype import LineTypeProvider
from roofsignal.compliance.types import ConsentKind, ConsentSnapshot, DatasetInfo, LineType, LineTypeInfo
from roofsignal.db.models import ConsentRecord, DncDataset, PhoneNumber


class SqlInternalDnc:
    def __init__(self, s: Session) -> None:
        self.s = s

    def contains(self, e164: str) -> bool:
        return bool(self.s.scalar(
            text("SELECT EXISTS (SELECT 1 FROM internal_dnc WHERE e164 = :n AND removed_at IS NULL)"), {"n": e164}))


class SqlScrubList:
    """Latest dataset of a kind for a key (area code / state / '*'). A real dataset always wins over a mock one,
    even an older real one: mock data must never shadow registry data (the gate then judges freshness)."""

    def __init__(self, s: Session, kind: str) -> None:
        self.s, self.kind = s, kind
        self._cache: dict[str, DncDataset | None] = {}

    def _latest(self, key: str) -> DncDataset | None:
        if key not in self._cache:
            self._cache[key] = self.s.scalar(
                select(DncDataset).where(DncDataset.kind == self.kind, DncDataset.key == key)
                .order_by(DncDataset.is_mock.asc(), DncDataset.downloaded_at.desc()).limit(1))
        return self._cache[key]

    def dataset(self, key: str) -> DatasetInfo | None:
        ds = self._latest(key)
        if ds is None:
            return None
        return DatasetInfo(f"{self.kind}:{key}:{ds.name}", ds.downloaded_at, is_mock=ds.is_mock)

    def contains(self, key: str, e164: str) -> bool:
        ds = self._latest(key)
        if ds is None:
            raise LookupError(f"no {self.kind} dataset for {key}")
        return bool(self.s.scalar(
            text("SELECT EXISTS (SELECT 1 FROM dnc_entry WHERE dataset_id = :d AND e164 = :n)"),
            {"d": ds.id, "n": e164}))


class SqlConsentStore:
    def __init__(self, s: Session) -> None:
        self.s = s

    def for_number(self, e164: str) -> list[ConsentSnapshot]:
        rows = self.s.scalars(
            select(ConsentRecord).join(PhoneNumber, PhoneNumber.id == ConsentRecord.phone_number_id)
            .where(PhoneNumber.e164 == e164))
        return [
            ConsentSnapshot(
                id=str(r.id), kind=ConsentKind(r.kind), captured_at=r.captured_at, revoked_at=r.revoked_at,
                disclosure_version=r.disclosure_version, disclosure_sha256=r.disclosure_sha256,
                seller_names=tuple(r.seller_names or ()),
            )
            for r in rows
        ]


class SqlLineTypes:
    """Uses the cached result on phone_number; asks the provider (and caches) when there is none."""

    def __init__(self, s: Session, provider: LineTypeProvider) -> None:
        self.s, self.provider = s, provider

    def lookup(self, e164: str) -> LineTypeInfo | None:
        phone = self.s.scalar(select(PhoneNumber).where(PhoneNumber.e164 == e164))
        if phone is not None and phone.line_type and phone.line_type_checked_at:
            return LineTypeInfo(LineType(phone.line_type), phone.line_type_checked_at, phone.line_type_source or "",
                                is_mock=phone.line_type_is_mock)
        info = self.provider.lookup(e164)
        if info is not None and phone is not None:
            phone.line_type, phone.line_type_checked_at = info.line_type.value, info.checked_at
            phone.line_type_source, phone.line_type_is_mock = info.source, info.is_mock
        return info


class SqlCallHistory:
    def __init__(self, s: Session) -> None:
        self.s = s

    def attempts_since(self, e164: str, since: datetime) -> int:
        return int(self.s.scalar(text(
            "SELECT count(*) FROM call c JOIN phone_number p ON p.id = c.phone_number_id "
            "WHERE p.e164 = :n AND c.direction = 'outbound' AND c.started_at >= :since"),
            {"n": e164, "since": since}) or 0)


class NoReassignedProvider:
    """FCC Reassigned Numbers Database is paid; not configured. The gate blocks if the check is enabled."""

    def disconnected_since(self, e164: str, since: date) -> bool | None:
        return None


@dataclass
class SqlPorts:
    internal_dnc: SqlInternalDnc
    national_dnc: SqlScrubList
    state_dnc: SqlScrubList
    litigators: SqlScrubList
    consents: SqlConsentStore
    line_types: SqlLineTypes
    reassigned: NoReassignedProvider | None
    history: SqlCallHistory

    @classmethod
    def build(cls, s: Session, line_type_provider: LineTypeProvider) -> SqlPorts:
        return cls(SqlInternalDnc(s), SqlScrubList(s, "national"), SqlScrubList(s, "state"),
                   SqlScrubList(s, "litigator"), SqlConsentStore(s), SqlLineTypes(s, line_type_provider),
                   None, SqlCallHistory(s))
