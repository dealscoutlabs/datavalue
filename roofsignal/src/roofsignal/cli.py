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
users_app = typer.Typer(no_args_is_help=True, help="Staff accounts")
dnc_app = typer.Typer(no_args_is_help=True, help="Do-not-call / scrub lists")
for name, sub in (("parcels", parcels_app), ("permits", permits_app), ("storms", storms_app), ("mail", mail_app),
                  ("spend", spend_app), ("users", users_app), ("dnc", dnc_app)):
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


@parcels_app.command("fetch")
def parcels_fetch(county: str) -> None:
    """Download a county's bulk parcel files (counties whose config lists `parcels.downloads`)."""
    from roofsignal.ingestion.downloads import fetch_county_files

    cfg = load_county(county)
    for name, path in fetch_county_files(cfg).items():
        typer.echo(f"{name}: {path}")


@permits_app.command("fetch")
def permits_fetch(county: str, limit: int = typer.Option(None)) -> None:
    """Pull permits from every open-data feed in the county config and match them to parcels."""
    from roofsignal.adapters.permits.socrata import SocrataPermits
    from roofsignal.ingestion.loaders import load_permit_records

    cfg = load_county(county)
    if not cfg.permit_feeds:
        raise typer.BadParameter(f"{county} has no permit_feeds; use `permits load` with a CSV")
    out = {}
    for feed in cfg.permit_feeds:
        if feed.get("adapter") != "socrata":
            raise typer.BadParameter(f"unknown permit adapter {feed.get('adapter')}")
        src = SocrataPermits(feed["domain"], feed["dataset"], feed["columns"], feed.get("where"))
        with session_scope() as s:
            out[feed["jurisdiction"]] = load_permit_records(
                s, cfg, feed["jurisdiction"], src.iter_permits(limit=limit), feed.get("kind", "city"),
                source=f"socrata:{feed['domain']}/{feed['dataset']}",
            )
    _echo(out)


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
    area_code: str = typer.Option(None, help="Area code for a mock tracking number (default: county config)"),
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
        camp = create_campaign(s, c, run, name, tiers.split(","), limit, channel, area_code or cfg.area_code or "555",
                               tracking_phone,
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


@users_app.command("create")
def users_create(email: str, name: str = typer.Option(...), role: str = typer.Option("agent"),
                 password: str = typer.Option(None, help="Omit to generate one (printed once)")) -> None:
    """Create a staff account (admin, supervisor or agent)."""
    import secrets

    from roofsignal.core.auth import create_user

    pw = password or secrets.token_urlsafe(18)
    with session_scope() as s:
        u = create_user(s, email, name, role, pw)
        typer.echo(f"created {u.role} {u.email}")
    if not password:
        typer.echo(f"password (shown once): {pw}")


@dnc_app.command("load")
def dnc_load(kind: str = typer.Option(..., help="national | state | litigator"),
             key: str = typer.Option(..., help="area code (national), state (state) or * (litigator)"),
             file: Path = typer.Option(..., exists=True, readable=True),
             downloaded_at: str = typer.Option(..., help="ISO time the file was downloaded, e.g. 2026-11-13T09:00-05:00")
             ) -> None:
    """Load a scrub list file. The gate refuses lists 31+ days old, so the download time matters."""
    from roofsignal.callcenter.dnc_load import load_dataset

    with session_scope() as s:
        ds = load_dataset(s, kind, key, file, datetime.fromisoformat(downloaded_at))
        _echo({"dataset": ds.id, "kind": ds.kind, "key": ds.key, "records": ds.record_count})


@dnc_app.command("seed-mock")
def dnc_seed_mock(area_code: list[str] = typer.Option(["631", "516", "214", "469", "972"]),
                  state: list[str] = typer.Option(["TX"])) -> None:
    """DEV ONLY: empty scrub lists flagged as mock. Usable only while telephony is mocked."""
    from roofsignal.callcenter.dnc_load import seed_mock_datasets

    with session_scope() as s:
        n = len(seed_mock_datasets(s, list(area_code), list(state)))
    typer.echo(f"seeded {n} mock datasets (the gate rejects them once real telephony is enabled)")


@dnc_app.command("add")
def dnc_add(phone: str, reason: str = typer.Option(...), by: str = typer.Option(...)) -> None:
    from roofsignal.callcenter import service as cc

    e164 = cc.normalize_us_phone(phone)
    if not e164:
        raise typer.BadParameter("invalid phone")
    with session_scope() as s:
        cc.add_internal_dnc(s, e164, reason, "admin", by)
    typer.echo(f"{e164} added to the internal DNC list")


@dnc_app.command("check")
def dnc_check(phone: str, state: str = typer.Option(...), tz: str = typer.Option(None),
              callback: bool = typer.Option(False, help="Evaluate as a requested callback")) -> None:
    """Run the compliance gate for a number right now (the decision is logged like any other)."""
    from roofsignal.callcenter import service as cc
    from roofsignal.compliance.types import CallKind, Purpose

    e164 = cc.normalize_us_phone(phone)
    if not e164:
        raise typer.BadParameter("invalid phone")
    with session_scope() as s:
        d, _ = cc.evaluate(s, e164, Purpose.DIAL, CallKind.CALLBACK_REQUESTED if callback else CallKind.OUTBOUND_COLD,
                           state, tz, "cli")
    _echo({"allowed": d.allowed, "block_reasons": d.block_reasons,
           "checks": [f"{c.check}: {c.status.value} {c.reason_code} {c.detail}".strip() for c in d.checks]})


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
