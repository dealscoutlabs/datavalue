"""Background jobs (RQ). The CLI runs these inline; the scheduler/worker runs them on a cadence.

Start a worker:   rq worker --url $REDIS_URL roofsignal
Enqueue:          python -m roofsignal.jobs.tasks enqueue refresh_storms suffolk_ny
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone

from redis import Redis
from rq import Queue

from roofsignal.adapters.storms.noaa_storm_events import NoaaStormEvents
from roofsignal.adapters.storms.spc_reports import SpcReports
from roofsignal.core.config import load_county, load_scoring
from roofsignal.core.settings import get_settings
from roofsignal.db.session import session_scope
from roofsignal.ingestion.loaders import load_parcels, load_storms
from roofsignal.scoring.run import run_scoring

QUEUE = "roofsignal"


def refresh_storms(county_key: str, days: int = 14) -> dict:
    """Daily: pull the last N days of SPC reports plus the current Storm Events year."""
    cfg = load_county(county_key)
    end = datetime.now(timezone.utc).date() - timedelta(days=1)
    with session_scope() as s:
        return load_storms(s, cfg, [SpcReports(), NoaaStormEvents()], end - timedelta(days=days), end)


def refresh_parcels(county_key: str) -> dict:
    with session_scope() as s:
        return load_parcels(s, load_county(county_key))


def rescore(county_key: str, trade: str = "roofing") -> dict:
    with session_scope() as s:
        run = run_scoring(s, load_county(county_key), load_scoring(), trade)
        return {"run_id": str(run.id), **run.stats}


JOBS = {"refresh_storms": refresh_storms, "refresh_parcels": refresh_parcels, "rescore": rescore}


def queue() -> Queue:
    return Queue(QUEUE, connection=Redis.from_url(get_settings().redis_url))


if __name__ == "__main__":  # pragma: no cover
    if len(sys.argv) >= 4 and sys.argv[1] == "enqueue":
        job = queue().enqueue(JOBS[sys.argv[2]], *sys.argv[3:], job_timeout=6 * 3600)
        print(job.id)
    else:
        print(__doc__)
