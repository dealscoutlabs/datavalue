"""Builds the agent script for a queue item. Only neutral, agent-visible facts are used: the public storm report
or the estimated roof age from public records. Imagery-derived scores are never passed to agents."""

from __future__ import annotations

from datetime import date
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from roofsignal.core.settings import get_settings
from roofsignal.outreach.copy import assert_neutral
from roofsignal.scoring.reason_codes import agent_visible


def talking_points(storm_ev: dict | None, roof_ev: dict | None) -> list[str]:
    points = []
    for ev in (storm_ev or {}).get("events", [])[:1]:
        kind = f"hail up to {ev['magnitude']:g} inch" if ev["type"] == "hail" else "high winds"
        when = date.fromisoformat(ev["date"]).strftime("%B %-d, %Y")
        points.append(f"The National Weather Service recorded {kind} in your area on {when}.")
    if roof_ev and roof_ev.get("estimated_age_years") and roof_ev["estimated_age_years"] >= 15:
        if roof_ev.get("source") == "permit":
            years = int(roof_ev["estimated_age_years"] // 5 * 5)
            points.append(f"Based on building permit records, the roof may be around {years} or more years old.")
        elif roof_ev.get("year_built"):
            # Never turn a build year into a roof age: old homes have usually been re-roofed.
            points.append(f"Public property records show the home was built in {roof_ev['year_built']}.")
    if not points:
        points.append("Homeowners in your area are getting free roof estimates from licensed local contractors.")
    return [assert_neutral(p) for p in points]


def render(s: Session, queue_item_id, agent_name: str) -> dict:
    row = s.execute(text(
        """
        SELECT q.id, ct.first_name, p.site_address, p.id AS property_id, mp.id AS mail_piece_id,
          (SELECT r.evidence FROM signal_result r WHERE r.property_id = p.id AND r.signal = 'storm'
             ORDER BY r.computed_at DESC LIMIT 1) AS storm_ev,
          (SELECT r.evidence FROM signal_result r WHERE r.property_id = p.id AND r.signal = 'roof_age'
             ORDER BY r.computed_at DESC LIMIT 1) AS roof_ev,
          (SELECT sc.reason_codes FROM score sc JOIN scoring_run sr ON sr.id = sc.run_id
             WHERE sc.property_id = p.id ORDER BY sr.started_at DESC LIMIT 1) AS codes
        FROM call_queue_item q
        LEFT JOIN contact ct ON ct.id = q.contact_id
        LEFT JOIN property p ON p.id = q.property_id
        LEFT JOIN mail_piece mp ON mp.id = q.mail_piece_id
        WHERE q.id = :id
        """), {"id": queue_item_id}).mappings().first()
    if row is None:
        raise LookupError("queue item not found")
    points = talking_points(row["storm_ev"], row["roof_ev"])
    template = (Path(get_settings().config_dir) / "scripts" / "roofing_v1.md").read_text()
    template = template.split("-->", 1)[-1].strip()
    body = template.format(
        first_name=row["first_name"] or "the homeowner", agent_name=agent_name,
        request_context=" from the mailer you received" if row["mail_piece_id"] else "",
        talking_points="\n".join(f'- "{p}"' for p in points),
        property_address=row["site_address"] or "the property",
    )
    return {"script": assert_neutral(body), "talking_points": points,
            "reason_codes": agent_visible(list(row["codes"] or []))}
