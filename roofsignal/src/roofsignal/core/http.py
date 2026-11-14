"""Shared HTTP client for free public data sources, with an on-disk cache so re-runs don't re-download."""

from __future__ import annotations

import hashlib
import time
from pathlib import Path

import httpx

from roofsignal.core.settings import get_settings


def make_client() -> httpx.Client:
    s = get_settings()
    return httpx.Client(
        headers={"User-Agent": s.http_user_agent},
        timeout=s.http_timeout_seconds,
        follow_redirects=True,
    )


def cached_get(
    client: httpx.Client,
    url: str,
    *,
    params: dict | None = None,
    cache_dir: Path | None = None,
    allow_404: bool = False,
    retries: int = 3,
) -> bytes | None:
    """GET with a disk cache keyed by URL+params. Returns None on 404 when allow_404 is set."""
    cache_dir = cache_dir or get_settings().data_cache_dir
    key = hashlib.sha256((url + "?" + repr(sorted((params or {}).items()))).encode()).hexdigest()
    path = cache_dir / key[:2] / key
    if path.exists():
        data = path.read_bytes()
        return None if data == b"__404__" else data

    last_exc: Exception | None = None
    for attempt in range(retries):
        try:
            resp = client.get(url, params=params)
            if resp.status_code == 404 and allow_404:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"__404__")
                return None
            resp.raise_for_status()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(resp.content)
            return resp.content
        except (httpx.TransportError, httpx.HTTPStatusError) as exc:
            last_exc = exc
            time.sleep(2**attempt)
    raise RuntimeError(f"GET {url} failed after {retries} attempts: {last_exc}")
