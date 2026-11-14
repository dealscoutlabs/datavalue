"""Resumable downloads of bulk county files (large zips over a proxy that may drop long transfers)."""

from __future__ import annotations

import time
import zipfile
from pathlib import Path

import httpx

from roofsignal.core.config import CountyConfig
from roofsignal.core.http import make_client
from roofsignal.core.settings import get_settings


def download_resumable(client: httpx.Client, url: str, dest: Path, attempts: int = 30) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return dest  # already complete (delete it to force a fresh download)
    part = dest.with_suffix(dest.suffix + ".part")
    total: int | None = None
    for attempt in range(attempts):
        have = part.stat().st_size if part.exists() else 0
        if total is not None and have >= total:
            break
        headers = {"Range": f"bytes={have}-"} if have else {}
        try:
            with client.stream("GET", url, headers=headers) as r:
                if r.status_code == 200 and have:
                    have = 0  # server ignored Range: start over
                    part.unlink(missing_ok=True)
                r.raise_for_status()
                if r.status_code == 206:
                    total = int(r.headers.get("content-range", "/0").split("/")[-1] or 0) or None
                else:
                    total = int(r.headers.get("content-length", 0)) or None
                with part.open("ab") as fh:
                    for chunk in r.iter_bytes(1 << 20):
                        fh.write(chunk)
            if total is None or part.stat().st_size >= total:
                break
        except (httpx.TransportError, httpx.HTTPStatusError):
            time.sleep(min(30, 2**attempt))
    else:
        raise RuntimeError(f"download of {url} did not complete after {attempts} attempts")
    part.replace(dest)
    return dest


def fetch_county_files(cfg: CountyConfig, client: httpx.Client | None = None) -> dict[str, Path]:
    downloads = cfg.parcels.get("downloads") or {}
    if not downloads:
        raise ValueError(f"{cfg.key} has no parcels.downloads in its config")
    base = get_settings().data_cache_dir.parent / "downloads" / cfg.key
    client = client or make_client()
    out = {}
    for name, url in downloads.items():
        zpath = download_resumable(client, url, base / f"{name}.zip")
        target = base / name
        target.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zpath) as zf:
            for member in zf.namelist():  # refuse path traversal in archive member names
                if member.startswith("/") or ".." in Path(member).parts:
                    raise ValueError(f"unsafe path in {zpath}: {member}")
            zf.extractall(target)
        out[name] = target
    return out
