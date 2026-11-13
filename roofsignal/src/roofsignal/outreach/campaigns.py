"""Campaign creation and print-vendor CSV export (direct mail / door hangers)."""

from __future__ import annotations

import csv
import io
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from roofsignal.adapters.factory import telephony_provider
from roofsignal.core.settings import get_settings
from roofsignal.db.models import Campaign, County, MailPiece, ScoringRun, Trade
from roofsignal.outreach import tracking
from roofsignal.outreach.copy import GENERIC_TRIGGER, roof_age_trigger, storm_trigger

CSV_COLUMNS = [
    "tracking_code", "owner_name", "mail_address", "mail_city", "mail_state", "mail_zip", "property_address",
    "property_zip", "message_variant", "trigger_text", "tracking_phone", "landing_url", "tier", "batch_id",
]

# Owner names that are clearly not a household are skipped for residential mail.
_NON_HOUSEHOLD = ("LLC", " INC", " CORP", "TRUST CO", "BANK", "COUNTY OF", "TOWN OF", "STATE OF", "VILLAGE OF",
                  "HOUSING AUTH", "CHURCH", "ASSOCIATION", "ASSN")


def _trigger(storm_ev: dict | None, roof_ev: dict | None, area: str) -> tuple[str, str]:
    events = (storm_ev or {}).get("events") or []
    if events:
        ev = events[0]  # most recent qualifying event
        return "storm", storm_trigger(ev["type"], date.fromisoformat(ev["date"]), area)
    if roof_ev and roof_ev.get("estimated_age_years") and roof_ev["estimated_age_years"] >= 15:
        return "roof_age", roof_age_trigger(roof_ev["estimated_age_years"], roof_ev["source"])
    return "generic", GENERIC_TRIGGER


def create_campaign(
    session: Session,
    county: County,
    run: ScoringRun,
    name: str,
    tiers: list[str],
    limit: int,
    channel: str = "direct_mail",
    area_code: str = "631",
    tracking_phone: str | None = None,
    owner_occupied_only: bool = True,
) -> Campaign:
    phone_is_mock = tracking_phone is None
    if tracking_phone is None:
        provider = telephony_provider(session)
        tracking_phone = provider.allocate_tracking_number(area_code, name)
        phone_is_mock = provider.is_mock

    campaign = Campaign(
        name=name, county_id=county.id, trade=run.trade, channel=channel, scoring_run_id=run.id, tier_filter=tiers,
        tracking_phone=tracking_phone, tracking_phone_is_mock=phone_is_mock,
    )
    session.add(campaign)
    session.flush()

    # Properties already mailed in another campaign for this trade are excluded to avoid duplicate drops.
    rows = session.execute(
        text(
            """
            SELECT p.id, p.owner_name, p.town, p.municipality, s.tier, s.score,
                   (SELECT evidence FROM signal_result r WHERE r.run_id = s.run_id AND r.property_id = p.id
                     AND r.signal = 'storm') AS storm_ev,
                   (SELECT evidence FROM signal_result r WHERE r.run_id = s.run_id AND r.property_id = p.id
                     AND r.signal = 'roof_age') AS roof_ev
            FROM score s JOIN property p ON p.id = s.property_id
            WHERE s.run_id = :run AND s.tier = ANY(:tiers)
              AND p.owner_mail_address IS NOT NULL
              AND (:oo = false OR p.owner_occupied_guess IS TRUE)
              AND NOT EXISTS (
                SELECT 1 FROM mail_piece mp JOIN campaign c ON c.id = mp.campaign_id
                WHERE mp.property_id = p.id AND c.trade = :trade)
            ORDER BY s.score DESC, p.id
            LIMIT :lim
            """
        ),
        {"run": run.id, "tiers": tiers, "oo": owner_occupied_only, "trade": run.trade.value, "lim": limit * 2},
    ).all()

    batch_id = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    made = 0
    for r in rows:
        if made >= limit:
            break
        owner = (r.owner_name or "").upper()
        if any(tok in owner for tok in _NON_HOUSEHOLD):
            continue
        area = (r.municipality or r.town or "your area").title()
        variant, trigger = _trigger(r.storm_ev, r.roof_ev, area)
        for _ in range(5):  # retry on the (astronomically unlikely) code collision
            try:
                with session.begin_nested():
                    session.add(
                        MailPiece(campaign_id=campaign.id, property_id=r.id, tracking_code=tracking.new_code(),
                                  message_variant=variant, trigger_text=trigger, batch_id=batch_id)
                    )
                break
            except IntegrityError:
                continue
        made += 1
    session.flush()
    return campaign


def export_csv(session: Session, campaign: Campaign) -> str:
    base = get_settings().landing_base_url.rstrip("/")
    rows = session.execute(
        text(
            """
            SELECT mp.tracking_code, p.owner_name, p.owner_mail_address, p.owner_mail_city, p.owner_mail_state,
                   p.owner_mail_zip, p.site_address, p.zip, mp.message_variant, mp.trigger_text, s.tier, mp.batch_id
            FROM mail_piece mp
            JOIN property p ON p.id = mp.property_id
            JOIN campaign c ON c.id = mp.campaign_id
            LEFT JOIN score s ON s.run_id = c.scoring_run_id AND s.property_id = p.id
            WHERE mp.campaign_id = :c ORDER BY p.owner_mail_zip, p.owner_mail_address
            """
        ),
        {"c": campaign.id},
    ).all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(CSV_COLUMNS)
    for r in rows:
        w.writerow([
            tracking.display(r.tracking_code), r.owner_name, r.owner_mail_address, r.owner_mail_city,
            r.owner_mail_state, r.owner_mail_zip, r.site_address, r.zip, r.message_variant, r.trigger_text,
            campaign.tracking_phone, f"{base}/r/{r.tracking_code}", r.tier, r.batch_id,
        ])
    session.execute(
        text("UPDATE mail_piece SET exported_at = now() WHERE campaign_id = :c AND exported_at IS NULL"),
        {"c": campaign.id},
    )
    return buf.getvalue()


def get_campaign(session: Session, campaign_id: uuid.UUID | str) -> Campaign | None:
    return session.get(Campaign, uuid.UUID(str(campaign_id)))


def campaign_by_name(session: Session, name: str) -> Campaign | None:
    return session.scalar(select(Campaign).where(Campaign.name == name))


__all__ = ["create_campaign", "export_csv", "CSV_COLUMNS", "Trade"]
