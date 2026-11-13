"""`roofsignal` command line. Every command works on one county config (config/counties/<key>.yaml)."""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import typer
from sqlalchemy import select

from roofsignal.adapters.storms.noaa_storm_events import NoaaStormEvents
from roofsignal.adapters.storms.spc_reports import SpcReports
from roofsignal.core.config import list_counties, load_county, load_scoring
from roofsignal.core.spend import SpendGuard
from roofsignal.db.models import County
from roofsignal.db.session import session_scope
from roofsignal.ingestion.loaders import ensure_county, load_parcels, load_permits, load_storms, parcel_source_for
from roofsignal.outreach.campaigns import create_campaign, export_csv
from roofsignal.scoring.run import latest_run, run_scoring

app = typer.Typer(no_args_is_help=True, help="RoofSignal data pipeline")
parcels_app = typer.Typer(no_args_is_help=True, help="Parcel ingestion")
permits_app = typer.Typer(no_args_is_help=True, help="Permit ingestion")
storms_app = typer.Typer(no_args_is_help=True, help="Storm ingestion")
mail_app = typer.Typer(no_args_is_help=True, help="Direct mail / door hanger campaigns")
spend_app = typer.Typer(no_args_is_help=True, help="Paid-provider spend approvals")
for name, sub in (("parcels", parcels_app), ("permits", permits_app), ("storms", storms_app), ("mail", mail_app),
                  ("spend", spend_app)):
    app.add_typer(sub, name=name)

STORM_SOURCES = {"noaa_storm_events": NoaaStormEvents, "spc_reports": SpcReports}


def _echo(obj) -> None:
    typer.echo(json.dumps(obj, indent=2, default=str))


@app.command()
def counties() -> None:
    """List configured counties."""
    for key in list_counties():
        c = load_county(key)
        typer.echo(f"{key:14} {c.name}, {c.state}  parcels via {c.parcels.get('adapter')}")


@parcels_app.command("count")
def parcels_count(county: str, town: list[str] = typer.Option(None, help="Limit to these towns")) -> None:
    """Count residential parcels available from the county's source without loading them."""
    cfg = load_county(county)
    src = parcel_source_for(cfg, {"towns": town} if town else None)
    if not hasattr(src, "count"):
        raise typer.BadParameter("This parcel source cannot count remotely")
    typer.echo(src.count())


@parcels_app.command("load")
def parcels_load(
    county: str,
    limit: int = typer.Option(None, help="Stop after N parcels (for a quick sample)"),
    town: list[str] = typer.Option(None, help="Limit to these towns (overrides config)"),
) -> None:
    """Load residential parcels for a county."""
    cfg = load_county(county)
    src = parcel_source_for(cfg, {"towns": town} if town else None)
    with session_scope() as s:
        stats = load_parcels(s, cfg, src, limit=limit, progress=lambda n: typer.echo(f"  {n} parcels", err=True)
                             if n % 10000 == 0 else None)
    _echo(stats)


@permits_app.command("load")
def permits_load(
    county: str,
    jurisdiction: str = typer.Option(..., help="Town/village name as it appears in the parcel data"),
    file: Path = typer.Option(..., exists=True, readable=True),
    columns: str = typer.Option(..., help='JSON column map, e.g. {"permit_no":"Permit #","issued_on":"Date",...}'),
    kind: str = typer.Option("town", help="town | city | village"),
) -> None:
    """Load one jurisdiction's permit CSV (FOIL response or portal export) and match permits to parcels."""
    cfg = load_county(county)
    with session_scope() as s:
        stats = load_permits(s, cfg, jurisdiction, file, json.loads(columns), jurisdiction_kind=kind)
    _echo(stats)


@storms_app.command("load")
def storms_load(
    county: str,
    months: int = typer.Option(13, help="How far back to load"),
    source: list[str] = typer.Option(None, help="noaa_storm_events and/or spc_reports (default: county config)"),
) -> None:
    """Load hail and wind reports around the county and build swath footprints."""
    cfg = load_county(county)
    names = source or cfg.storms.get("sources", list(STORM_SOURCES))
    end = datetime.now(timezone.utc).date() - timedelta(days=1)
    start = end - timedelta(days=int(months * 30.5))
    with session_scope() as s:
        stats = load_storms(s, cfg, [STORM_SOURCES[n]() for n in names], start, end)
    _echo({"start": start, "end": end, **stats})


@app.command()
def score(
    county: str,
    trade: str = "roofing",
    as_of: str = typer.Option(None, help="YYYY-MM-DD (default today)"),
) -> None:
    """Score every loaded property for a trade and assign tiers."""
    cfg = load_county(county)
    with session_scope() as s:
        run = run_scoring(s, cfg, load_scoring(), trade, date.fromisoformat(as_of) if as_of else None,
                          progress=lambda n: typer.echo(f"  scored {n}", err=True))
        _echo({"run_id": run.id, "config_hash": run.config_hash[:12], **run.stats})


@mail_app.command("create")
def mail_create(
    county: str,
    name: str = typer.Option(...),
    tiers: str = typer.Option("A,B"),
    limit: int = typer.Option(500),
    channel: str = typer.Option("direct_mail", help="direct_mail | door_hanger"),
    area_code: str = typer.Option("631"),
    tracking_phone: str = typer.Option(None, help="Real tracking number; default allocates a mock 555 number"),
    include_non_owner_occupied: bool = False,
    out: Path = typer.Option(None, help="Write the print-vendor CSV here"),
) -> None:
    """Create a campaign from the latest scoring run and export the print-vendor CSV."""
    cfg = load_county(county)
    with session_scope() as s:
        c = ensure_county(s, cfg)
        run = latest_run(s, c)
        if run is None:
            raise typer.BadParameter("No finished scoring run for this county; run `roofsignal score` first")
        camp = create_campaign(s, c, run, name, tiers.split(","), limit, channel, area_code, tracking_phone,
                               owner_occupied_only=not include_non_owner_occupied)
        data = export_csv(s, camp)
    if out:
        out.write_text(data)
        typer.echo(f"wrote {data.count(chr(10)) - 1} rows to {out}")
    else:
        typer.echo(data)


@spend_app.command("status")
def spend_status() -> None:
    with session_scope() as s:
        st = SpendGuard(s).status()
    _echo({"spent_usd": st.spent_usd, "approved_through_usd": st.approved_through_usd, "remaining": st.remaining_usd})


@spend_app.command("approve")
def spend_approve(to: str = typer.Option(..., help="New cumulative ceiling in USD"),
                  by: str = typer.Option(..., help="Who approved"), note: str = "") -> None:
    """Record a human approval. Refused if it goes more than one $5 step past actual spend."""
    with session_scope() as s:
        row = SpendGuard(s).approve(Decimal(to), by, note or None)
        _echo({"approved_through_usd": row.approved_through_usd})


@app.command()
def status(county: str) -> None:
    """Show what is loaded for a county and the latest scoring run."""
    from sqlalchemy import text

    cfg = load_county(county)
    with session_scope() as s:
        c = s.scalar(select(County).where(County.key == cfg.key))
        if c is None:
            typer.echo("nothing loaded")
            return
        counts = s.execute(
            text(
                "SELECT (SELECT count(*) FROM property WHERE county_id=:c) AS properties, "
                "(SELECT count(*) FROM property WHERE county_id=:c AND year_built IS NOT NULL) AS with_year_built, "
                "(SELECT count(*) FROM permit pm JOIN jurisdiction j ON j.id=pm.jurisdiction_id "
                " WHERE j.county_id=:c) AS permits, "
                "(SELECT count(*) FROM storm_event WHERE swath IS NOT NULL) AS storm_reports"
            ),
            {"c": c.id},
        ).mappings().one()
        run = latest_run(s, c)
        _echo({**counts, "latest_run": run.stats if run else None})


if __name__ == "__main__":
    app()
