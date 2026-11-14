"""SQLAlchemy models.

Phase 1 tables: geography, properties, permits, storms, signals, scores, campaigns/mail pieces, spend ledger.
Later phases add their own tables through new Alembic migrations (see ARCHITECTURE.md §4).
"""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from geoalchemy2 import Geometry
from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

JSONType = JSON().with_variant(JSONB(), "postgresql")


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


def _uuid() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class Trade(str, enum.Enum):
    roofing = "roofing"
    hvac = "hvac"
    driveway = "driveway"


class WorkCategory(str, enum.Enum):
    roof = "roof"
    hvac = "hvac"
    driveway = "driveway"
    solar = "solar"
    other = "other"


class StormType(str, enum.Enum):
    hail = "hail"
    wind = "wind"


class SignalKind(str, enum.Enum):
    storm = "storm"
    roof_age = "roof_age"
    imagery = "imagery"


# --------------------------------------------------------------------------- geography


class County(TimestampMixin, Base):
    __tablename__ = "county"

    id: Mapped[uuid.UUID] = _uuid()
    key: Mapped[str] = mapped_column(String(64), unique=True)  # e.g. "suffolk_ny" -> config/counties/suffolk_ny.yaml
    fips: Mapped[str] = mapped_column(String(5), unique=True)
    name: Mapped[str] = mapped_column(String(128))
    state: Mapped[str] = mapped_column(String(2))
    timezone: Mapped[str] = mapped_column(String(64))


class Jurisdiction(TimestampMixin, Base):
    """A permit-issuing body (town, city or village). In NY these are not the county."""

    __tablename__ = "jurisdiction"
    __table_args__ = (UniqueConstraint("county_id", "name", "kind"),)

    id: Mapped[uuid.UUID] = _uuid()
    county_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("county.id"))
    name: Mapped[str] = mapped_column(String(128))
    kind: Mapped[str] = mapped_column(String(16))  # town | city | village
    permit_data_status: Mapped[str] = mapped_column(String(32), default="none")  # none | foil_pending | loaded


# --------------------------------------------------------------------------- properties & permits


class Property(TimestampMixin, Base):
    __tablename__ = "property"
    __table_args__ = (
        UniqueConstraint("county_id", "parcel_id"),
        Index("ix_property_geom", "geom", postgresql_using="gist"),
        Index("ix_property_centroid", "centroid", postgresql_using="gist"),
        Index("ix_property_addr_key", "county_id", "address_key"),
    )

    id: Mapped[uuid.UUID] = _uuid()
    county_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("county.id"))
    parcel_id: Mapped[str] = mapped_column(String(64))  # county-unique id (NY: SWIS + SBL)
    sbl: Mapped[str | None] = mapped_column(String(64))
    swis: Mapped[str | None] = mapped_column(String(10))
    town: Mapped[str | None] = mapped_column(String(128))
    municipality: Mapped[str | None] = mapped_column(String(128))
    site_address: Mapped[str | None] = mapped_column(String(255))
    address_key: Mapped[str | None] = mapped_column(String(255))  # normalized, for permit matching
    zip: Mapped[str | None] = mapped_column(String(10), index=True)
    property_class: Mapped[str | None] = mapped_column(String(10))
    year_built: Mapped[int | None] = mapped_column(Integer)
    owner_name: Mapped[str | None] = mapped_column(String(255))
    owner_mail_address: Mapped[str | None] = mapped_column(String(255))
    owner_mail_city: Mapped[str | None] = mapped_column(String(128))
    owner_mail_state: Mapped[str | None] = mapped_column(String(32))
    owner_mail_zip: Mapped[str | None] = mapped_column(String(16))
    owner_occupied_guess: Mapped[bool | None] = mapped_column(Boolean)
    # Owner asked the appraisal district to keep their name/address confidential (e.g. Texas Tax Code 25.025:
    # peace officers, judges, family-violence survivors). We store no owner data and never mail these homes.
    owner_info_restricted: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Building attributes from the assessor when available (roof material/type, heating, A/C, condition...).
    attributes: Mapped[dict] = mapped_column(JSONType, default=dict, server_default="{}")
    geom = mapped_column(Geometry("GEOMETRY", srid=4326, spatial_index=False), nullable=True)  # polygon, or point if only a location is known
    centroid = mapped_column(Geometry("POINT", srid=4326, spatial_index=False), nullable=True)
    source: Mapped[str] = mapped_column(String(64))
    source_version: Mapped[str | None] = mapped_column(String(64))

    permits: Mapped[list[Permit]] = relationship(back_populates="property")


class Permit(TimestampMixin, Base):
    __tablename__ = "permit"
    __table_args__ = (UniqueConstraint("jurisdiction_id", "permit_no"),)

    id: Mapped[uuid.UUID] = _uuid()
    jurisdiction_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("jurisdiction.id"))
    property_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("property.id"), index=True)
    permit_no: Mapped[str] = mapped_column(String(64))
    issued_on: Mapped[date | None] = mapped_column(Date)
    work_type_raw: Mapped[str | None] = mapped_column(Text)
    work_category: Mapped[WorkCategory] = mapped_column(Enum(WorkCategory, name="work_category"))
    raw_address: Mapped[str | None] = mapped_column(String(255))
    raw_parcel_id: Mapped[str | None] = mapped_column(String(64))
    match_method: Mapped[str | None] = mapped_column(String(32))  # parcel_id | address_zip | address_town
    match_confidence: Mapped[float | None] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(64))

    property: Mapped[Property | None] = relationship(back_populates="permits")


# --------------------------------------------------------------------------- storms


class StormEvent(TimestampMixin, Base):
    __tablename__ = "storm_event"
    __table_args__ = (
        UniqueConstraint("source", "source_id"),
        Index("ix_storm_event_geom", "geom", postgresql_using="gist"),
        Index("ix_storm_event_swath", "swath", postgresql_using="gist"),
    )

    id: Mapped[uuid.UUID] = _uuid()
    source: Mapped[str] = mapped_column(String(32))  # noaa_storm_events | spc_reports
    source_id: Mapped[str] = mapped_column(String(128))
    event_type: Mapped[StormType] = mapped_column(Enum(StormType, name="storm_type"))
    magnitude: Mapped[float | None] = mapped_column(Float)  # hail: inches; wind: mph (converted from knots if needed)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    location_label: Mapped[str | None] = mapped_column(String(255))
    geom = mapped_column(Geometry("GEOMETRY", srid=4326, spatial_index=False))
    # Buffered footprint used for parcel matching; NULL when the event is below the qualifying threshold.
    swath = mapped_column(Geometry("GEOMETRY", srid=4326, spatial_index=False), nullable=True)
    swath_radius_m: Mapped[float | None] = mapped_column(Float)
    raw: Mapped[dict] = mapped_column(JSONType, default=dict)


# --------------------------------------------------------------------------- signals & scoring


class SignalResult(Base):
    __tablename__ = "signal_result"
    __table_args__ = (Index("ix_signal_result_prop_run", "property_id", "run_id"),)

    id: Mapped[uuid.UUID] = _uuid()
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("scoring_run.id", ondelete="CASCADE"), index=True)
    property_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("property.id"))
    signal: Mapped[SignalKind] = mapped_column(Enum(SignalKind, name="signal_kind"))
    adapter: Mapped[str] = mapped_column(String(64))
    is_mock: Mapped[bool] = mapped_column(Boolean, default=False)
    value: Mapped[float | None] = mapped_column(Float)
    normalized: Mapped[float] = mapped_column(Float)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    reason_codes: Mapped[list[str]] = mapped_column(ARRAY(String(64)))
    evidence: Mapped[dict] = mapped_column(JSONType, default=dict)
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ScoringRun(Base):
    __tablename__ = "scoring_run"

    id: Mapped[uuid.UUID] = _uuid()
    county_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("county.id"))
    trade: Mapped[Trade] = mapped_column(Enum(Trade, name="trade"))
    as_of: Mapped[date] = mapped_column(Date)
    config_hash: Mapped[str] = mapped_column(String(64))
    config_snapshot: Mapped[dict] = mapped_column(JSONType)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    stats: Mapped[dict] = mapped_column(JSONType, default=dict)


class Score(Base):
    __tablename__ = "score"
    __table_args__ = (
        UniqueConstraint("run_id", "property_id"),
        Index("ix_score_run_tier", "run_id", "tier", "score"),
    )

    id: Mapped[uuid.UUID] = _uuid()
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("scoring_run.id", ondelete="CASCADE"))
    property_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("property.id"), index=True)
    trade: Mapped[Trade] = mapped_column(Enum(Trade, name="trade"))
    score: Mapped[float] = mapped_column(Float)
    tier: Mapped[str] = mapped_column(String(1))
    reason_codes: Mapped[list[str]] = mapped_column(ARRAY(String(64)))
    components: Mapped[list] = mapped_column(JSONType)  # per-signal weight x normalized x confidence = points


# --------------------------------------------------------------------------- outreach


class Campaign(TimestampMixin, Base):
    __tablename__ = "campaign"

    id: Mapped[uuid.UUID] = _uuid()
    name: Mapped[str] = mapped_column(String(128), unique=True)
    county_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("county.id"))
    trade: Mapped[Trade] = mapped_column(Enum(Trade, name="trade"))
    channel: Mapped[str] = mapped_column(String(32))  # direct_mail | door_hanger
    scoring_run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("scoring_run.id"))
    tier_filter: Mapped[list[str]] = mapped_column(ARRAY(String(1)))
    tracking_phone: Mapped[str] = mapped_column(String(20))
    tracking_phone_is_mock: Mapped[bool] = mapped_column(Boolean, default=True)
    cost_cents: Mapped[int | None] = mapped_column(Integer)  # print + postage, entered manually
    status: Mapped[str] = mapped_column(String(16), default="draft")


class MailPiece(TimestampMixin, Base):
    __tablename__ = "mail_piece"
    __table_args__ = (UniqueConstraint("campaign_id", "property_id"),)

    id: Mapped[uuid.UUID] = _uuid()
    campaign_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("campaign.id"), index=True)
    property_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("property.id"))
    tracking_code: Mapped[str] = mapped_column(String(16), unique=True)
    message_variant: Mapped[str] = mapped_column(String(32))  # storm | roof_age | generic
    trigger_text: Mapped[str] = mapped_column(Text)
    batch_id: Mapped[str] = mapped_column(String(32))
    exported_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# --------------------------------------------------------------------------- spend control


class SpendApproval(Base):
    """A human approval to spend up to `approved_through_usd` cumulative. Raised at most one step ($5) at a time."""

    __tablename__ = "spend_approval"

    id: Mapped[uuid.UUID] = _uuid()
    approved_through_usd: Mapped[Decimal] = mapped_column(Numeric(12, 4))
    approved_by: Mapped[str] = mapped_column(String(128))
    note: Mapped[str | None] = mapped_column(Text)
    # Set in Python (not now()) so two approvals in one transaction still order correctly.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class SpendLedger(Base):
    __tablename__ = "spend_ledger"

    id: Mapped[uuid.UUID] = _uuid()
    provider: Mapped[str] = mapped_column(String(64), index=True)
    operation: Mapped[str] = mapped_column(String(64))
    units: Mapped[int] = mapped_column(Integer)
    unit_cost_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6))
    amount_usd: Mapped[Decimal] = mapped_column(Numeric(12, 4))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class IngestionRun(Base):
    __tablename__ = "ingestion_run"

    id: Mapped[uuid.UUID] = _uuid()
    county_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("county.id"))
    kind: Mapped[str] = mapped_column(String(32))  # parcels | permits | storms
    source: Mapped[str] = mapped_column(String(64))
    params: Mapped[dict] = mapped_column(JSONType, default=dict)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(16), default="running")
    stats: Mapped[dict] = mapped_column(JSONType, default=dict)
    error: Mapped[str | None] = mapped_column(Text)


# =========================================================================== Phase 2: people, consent, compliance,
# call center. Integrity rules that matter legally are enforced by database triggers (migration 0003), not only
# by application code: compliance_decision is append-only, consent_record can only be revoked (never edited or
# deleted), and a queue item / outbound call cannot exist without a fresh ALLOW decision for that exact number.


class AppUser(Base):
    __tablename__ = "app_user"

    id: Mapped[uuid.UUID] = _uuid()
    email: Mapped[str] = mapped_column(String(255), unique=True)
    display_name: Mapped[str] = mapped_column(String(128))
    role: Mapped[str] = mapped_column(String(16))  # admin | supervisor | agent
    password_hash: Mapped[str] = mapped_column(String(255))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class UserSession(Base):
    __tablename__ = "user_session"

    id: Mapped[uuid.UUID] = _uuid()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.id"), index=True)
    token_sha256: Mapped[str] = mapped_column(String(64), unique=True)  # the raw token is never stored
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ip: Mapped[str | None] = mapped_column(String(64))


class Contact(Base):
    __tablename__ = "contact"

    id: Mapped[uuid.UUID] = _uuid()
    property_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("property.id"), index=True)
    first_name: Mapped[str | None] = mapped_column(String(128))
    last_name: Mapped[str | None] = mapped_column(String(128))
    email: Mapped[str | None] = mapped_column(String(255))
    address: Mapped[str | None] = mapped_column(String(255))
    zip: Mapped[str | None] = mapped_column(String(10))
    state: Mapped[str | None] = mapped_column(String(2))
    source: Mapped[str] = mapped_column(String(32))  # web_form | inbound_call | agent
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PhoneNumber(Base):
    __tablename__ = "phone_number"

    id: Mapped[uuid.UUID] = _uuid()
    e164: Mapped[str] = mapped_column(String(16), unique=True)
    contact_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("contact.id"))
    line_type: Mapped[str | None] = mapped_column(String(16))
    line_type_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    line_type_source: Mapped[str | None] = mapped_column(String(32))
    line_type_is_mock: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ConsentRecord(Base):
    __tablename__ = "consent_record"

    id: Mapped[uuid.UUID] = _uuid()
    phone_number_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("phone_number.id"), index=True)
    contact_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("contact.id"))
    kind: Mapped[str] = mapped_column(String(32))  # pewc | callback_request
    disclosure_version: Mapped[str | None] = mapped_column(String(32))
    disclosure_text: Mapped[str | None] = mapped_column(Text)  # exact text shown, copied at capture time
    disclosure_sha256: Mapped[str | None] = mapped_column(String(64))
    seller_names: Mapped[list[str]] = mapped_column(ARRAY(String(128)), default=list)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    captured_by: Mapped[str] = mapped_column(String(64))  # web | agent:<user id>
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(Text)
    page_url: Mapped[str | None] = mapped_column(Text)
    form_payload: Mapped[dict] = mapped_column(JSONType, default=dict)
    mail_piece_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("mail_piece.id"))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revocation_channel: Mapped[str | None] = mapped_column(String(32))  # web | call | sms | email | admin
    revocation_note: Mapped[str | None] = mapped_column(Text)


class InternalDnc(Base):
    __tablename__ = "internal_dnc"

    id: Mapped[uuid.UUID] = _uuid()
    e164: Mapped[str] = mapped_column(String(16), index=True)
    reason: Mapped[str] = mapped_column(String(64))
    source: Mapped[str] = mapped_column(String(32))  # disposition | web_optout | admin | complaint
    added_by: Mapped[str] = mapped_column(String(64))
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    removed_by: Mapped[str | None] = mapped_column(String(64))
    removal_reason: Mapped[str | None] = mapped_column(Text)


class DncDataset(Base):
    """A loaded scrub list: national DNC for one area code, a state list, or the litigator list."""

    __tablename__ = "dnc_dataset"
    __table_args__ = (Index("ix_dnc_dataset_kind_key", "kind", "key", "downloaded_at"),)

    id: Mapped[uuid.UUID] = _uuid()
    kind: Mapped[str] = mapped_column(String(16))  # national | state | litigator
    key: Mapped[str] = mapped_column(String(8))     # area code | state | '*'
    name: Mapped[str] = mapped_column(String(128))
    downloaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    record_count: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    is_mock: Mapped[bool] = mapped_column(Boolean, default=False)
    loaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DncEntry(Base):
    __tablename__ = "dnc_entry"

    dataset_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("dnc_dataset.id", ondelete="CASCADE"),
                                                  primary_key=True)
    e164: Mapped[str] = mapped_column(String(16), primary_key=True)


class ComplianceDecisionRow(Base):
    __tablename__ = "compliance_decision"
    __table_args__ = (Index("ix_compliance_decision_e164_at", "e164", "evaluated_at"),)

    id: Mapped[uuid.UUID] = _uuid()
    e164: Mapped[str] = mapped_column(String(16))
    purpose: Mapped[str] = mapped_column(String(16))     # queue_insert | dial
    call_kind: Mapped[str] = mapped_column(String(32))
    allowed: Mapped[bool] = mapped_column(Boolean)
    block_reasons: Mapped[list[str]] = mapped_column(ARRAY(String(64)))
    checks: Mapped[list] = mapped_column(JSONType)
    ruleset_version: Mapped[str] = mapped_column(String(32))
    ruleset_hash: Mapped[str] = mapped_column(String(64))
    evaluated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    recipient_timezones: Mapped[list[str]] = mapped_column(ARRAY(String(64)))
    recipient_state: Mapped[str | None] = mapped_column(String(2))
    next_window_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    allow_mock_data: Mapped[bool] = mapped_column(Boolean)
    actor: Mapped[str] = mapped_column(String(64))


class CallQueueItem(Base):
    __tablename__ = "call_queue_item"
    __table_args__ = (Index("ix_queue_ready", "status", "priority", "not_before"),)

    id: Mapped[uuid.UUID] = _uuid()
    phone_number_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("phone_number.id"))
    contact_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("contact.id"))
    property_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("property.id"))
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("campaign.id"))
    mail_piece_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("mail_piece.id"))
    queue: Mapped[str] = mapped_column(String(32))      # inbound_callback | outbound
    call_kind: Mapped[str] = mapped_column(String(32))
    compliance_decision_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("compliance_decision.id"))
    recipient_state: Mapped[str | None] = mapped_column(String(2))
    recipient_timezone: Mapped[str | None] = mapped_column(String(64))
    priority: Mapped[int] = mapped_column(Integer, default=100)  # lower = sooner
    not_before: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(16), default="ready")  # ready | claimed | done | blocked | expired
    assigned_agent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("app_user.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(),
                                                 onupdate=func.now())


class Call(Base):
    __tablename__ = "call"

    id: Mapped[uuid.UUID] = _uuid()
    queue_item_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("call_queue_item.id"), index=True)
    phone_number_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("phone_number.id"), index=True)
    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.id"))
    direction: Mapped[str] = mapped_column(String(16))  # outbound | inbound
    dial_decision_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("compliance_decision.id"))
    provider: Mapped[str] = mapped_column(String(32))
    provider_call_id: Mapped[str | None] = mapped_column(String(128))
    provider_status: Mapped[str | None] = mapped_column(String(32))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    recording_disclosed: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text)


class Disposition(Base):
    __tablename__ = "disposition"

    id: Mapped[uuid.UUID] = _uuid()
    call_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("call.id"), unique=True)
    code: Mapped[str] = mapped_column(String(32))
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Qualification(Base):
    __tablename__ = "qualification"

    id: Mapped[uuid.UUID] = _uuid()
    call_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("call.id"), unique=True)
    contact_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("contact.id"))
    property_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("property.id"))
    trade: Mapped[Trade] = mapped_column(Enum(Trade, name="trade", create_type=False))
    homeowner_confirmed: Mapped[bool] = mapped_column(Boolean)
    roof_concern: Mapped[str] = mapped_column(String(32))
    roof_concern_notes: Mapped[str | None] = mapped_column(Text)
    timeline: Mapped[str] = mapped_column(String(32))
    insurance_claim_interest: Mapped[str] = mapped_column(String(32))
    best_appointment_window: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class InboundTouch(Base):
    __tablename__ = "inbound_touch"

    id: Mapped[uuid.UUID] = _uuid()
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("campaign.id"), index=True)
    mail_piece_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("mail_piece.id"))
    channel: Mapped[str] = mapped_column(String(16))  # web_visit | web_form | call
    contact_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("contact.id"))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = _uuid()
    actor: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(64))
    entity: Mapped[str] = mapped_column(String(64))
    entity_id: Mapped[str | None] = mapped_column(String(64))
    detail: Mapped[dict] = mapped_column(JSONType, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
