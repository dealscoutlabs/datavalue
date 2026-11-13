"""Load scrub lists into dnc_dataset / dnc_entry.

* National DNC: the FTC lets a registered seller (SAN) download the registry per area code. Files contain one
  10-digit number per line (other characters are ignored). The download date must be recorded: the gate refuses
  data 31+ days old.
* State lists and litigator lists: same loader, kind 'state' (key = state) or 'litigator' (key = '*').
* `seed_mock_datasets` creates EMPTY datasets flagged is_mock. The gate only accepts them while telephony is mocked,
  so a development call flow works end-to-end but no real call can ever rely on them.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from roofsignal.db.models import DncDataset

_DIGITS = re.compile(r"\D")


def _numbers(lines: Iterable[str]) -> Iterable[str]:
    for line in lines:
        d = _DIGITS.sub("", line)
        if len(d) == 11 and d.startswith("1"):
            d = d[1:]
        if len(d) == 10:
            yield "+1" + d


def load_dataset(s: Session, kind: str, key: str, path: Path, downloaded_at: datetime, name: str | None = None,
                 batch: int = 50000) -> DncDataset:
    if kind not in ("national", "state", "litigator"):
        raise ValueError("kind must be national, state or litigator")
    if downloaded_at.tzinfo is None:
        raise ValueError("downloaded_at must include a timezone")
    if downloaded_at > datetime.now(timezone.utc):
        raise ValueError("downloaded_at is in the future")
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    ds = DncDataset(kind=kind, key=key.upper() if kind == "state" else key, name=name or path.name,
                    downloaded_at=downloaded_at, record_count=0, sha256=sha, is_mock=False)
    s.add(ds)
    s.flush()
    rows: list[dict] = []
    n = 0
    with path.open(encoding="utf-8", errors="ignore") as fh:
        for e164 in _numbers(fh):
            if kind == "national" and e164[2:5] != key:
                continue  # a national file must only contain its own area code
            rows.append({"d": ds.id, "n": e164})
            if len(rows) >= batch:
                n += _insert(s, rows)
                rows.clear()
    n += _insert(s, rows)
    ds.record_count = n
    s.flush()
    return ds


def _insert(s: Session, rows: list[dict]) -> int:
    if not rows:
        return 0
    s.execute(text("INSERT INTO dnc_entry (dataset_id, e164) VALUES (:d, :n) ON CONFLICT DO NOTHING"), rows)
    return len(rows)


def seed_mock_datasets(s: Session, area_codes: list[str], states: list[str]) -> list[DncDataset]:
    now = datetime.now(timezone.utc)
    out = []
    for kind, keys in (("national", area_codes), ("state", states), ("litigator", ["*"])):
        for key in keys:
            ds = DncDataset(kind=kind, key=key, name="MOCK (empty)", downloaded_at=now, record_count=0,
                            sha256="0" * 64, is_mock=True)
            s.add(ds)
            out.append(ds)
    s.flush()
    return out
