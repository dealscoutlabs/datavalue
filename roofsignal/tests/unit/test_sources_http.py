import gzip
from datetime import date

import httpx
import pytest
import respx

from roofsignal.adapters.storms import noaa_storm_events as nse
from roofsignal.adapters.storms import spc_reports as spc
from roofsignal.core.http import cached_get
from pathlib import Path

FIX = Path(__file__).parent.parent / "fixtures"
SUFFOLK = (-73.5, 40.55, -71.8, 41.32)


@pytest.fixture(autouse=True)
def tmp_cache(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_CACHE_DIR", str(tmp_path / "cache"))
    from roofsignal.core.settings import get_settings

    get_settings.cache_clear()
    monkeypatch.setattr("roofsignal.core.http.time.sleep", lambda s: None)
    yield
    get_settings.cache_clear()


@respx.mock
def test_cached_get_caches_and_remembers_404():
    route = respx.get("https://x.test/a").mock(return_value=httpx.Response(200, content=b"hello"))
    c = httpx.Client()
    assert cached_get(c, "https://x.test/a") == b"hello"
    assert cached_get(c, "https://x.test/a") == b"hello"
    assert route.call_count == 1
    r404 = respx.get("https://x.test/missing").mock(return_value=httpx.Response(404))
    assert cached_get(c, "https://x.test/missing", allow_404=True) is None
    assert cached_get(c, "https://x.test/missing", allow_404=True) is None
    assert r404.call_count == 1


@respx.mock
def test_cached_get_retries_then_fails():
    route = respx.get("https://x.test/b").mock(return_value=httpx.Response(500))
    with pytest.raises(RuntimeError, match="failed after 3"):
        cached_get(httpx.Client(), "https://x.test/b")
    assert route.call_count == 3


@respx.mock
def test_noaa_storm_events_picks_latest_file_and_filters():
    listing = (
        '<a href="StormEvents_details-ftp_v1.0_d2025_c20260101.csv.gz">x</a>'
        '<a href="StormEvents_details-ftp_v1.0_d2025_c20260819.csv.gz">y</a>'
    )
    respx.get(nse.BASE_URL).mock(return_value=httpx.Response(200, text=listing))
    blob = gzip.compress((FIX / "storm_events_sample.csv").read_bytes())
    file_route = respx.get(nse.BASE_URL + "StormEvents_details-ftp_v1.0_d2025_c20260819.csv.gz").mock(
        return_value=httpx.Response(200, content=blob)
    )
    reps = list(nse.NoaaStormEvents(httpx.Client()).iter_reports(date(2025, 7, 1), date(2025, 7, 31), SUFFOLK))
    assert file_route.called
    assert {r.source_id for r in reps} == {"1200001", "1200002"}  # Texas row outside bbox
    assert list(nse.NoaaStormEvents(httpx.Client()).iter_reports(date(2025, 8, 1), date(2025, 8, 31), SUFFOLK)) == []


@respx.mock
def test_noaa_storm_events_missing_year_is_skipped():
    respx.get(nse.BASE_URL).mock(return_value=httpx.Response(200, text="nothing here"))
    assert list(nse.NoaaStormEvents(httpx.Client()).iter_reports(date(2030, 1, 1), date(2030, 2, 1), SUFFOLK)) == []


@respx.mock
def test_spc_reports_fetch_days_skip_404_and_today():
    respx.get(f"{spc.BASE_URL}250714_rpts_filtered_hail.csv").mock(
        return_value=httpx.Response(200, content=(FIX / "spc_hail.csv").read_bytes()))
    respx.get(f"{spc.BASE_URL}250714_rpts_filtered_wind.csv").mock(
        return_value=httpx.Response(200, content=(FIX / "spc_wind.csv").read_bytes()))
    respx.get(url__regex=r".*250715_rpts_filtered_(hail|wind)\.csv").mock(return_value=httpx.Response(404))
    reps = list(spc.SpcReports(httpx.Client()).iter_reports(date(2025, 7, 14), date(2025, 7, 15), SUFFOLK))
    assert len(reps) == 4  # 2 NY hail + 2 NY wind; Wisconsin excluded
    from datetime import datetime, timezone

    today = datetime.now(timezone.utc).date()
    assert list(spc.SpcReports(httpx.Client()).iter_reports(today, today, SUFFOLK)) == []
