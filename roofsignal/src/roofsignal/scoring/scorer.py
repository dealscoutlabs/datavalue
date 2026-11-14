"""Transparent weighted score.

    points_i = 100 * weight_i * normalized_i * confidence_i / sum(weight_j for every signal j that counts)
    score    = sum(points_i)

A signal "counts" if it is enabled in scoring.yaml and is not a mock (unless include_mock_signals is set for a demo).
Missing data for one property (e.g. no year built) scores 0 for that signal; it is never dropped from the
denominator, so missing data can't inflate a score. Every component is stored with the score.
"""

from __future__ import annotations

from dataclasses import dataclass

from roofsignal.core.config import TradeScoring
from roofsignal.signals.core import SignalOutput


@dataclass
class ScoreResult:
    score: float
    tier: str
    reason_codes: list[str]
    components: list[dict]


def tier_for(score: float, tiers: dict[str, float]) -> str:
    for letter, minimum in sorted(tiers.items(), key=lambda kv: kv[1], reverse=True):
        if score >= minimum:
            return letter
    return "D"


def score_property(outputs: dict[str, SignalOutput], cfg: TradeScoring) -> ScoreResult:
    counted = {
        name: sw
        for name, sw in cfg.signals.items()
        if sw.enabled and name in outputs and (cfg.include_mock_signals or not outputs[name].is_mock)
    }
    denom = sum(sw.weight for sw in counted.values())

    components: list[dict] = []
    total = 0.0
    for name, out in outputs.items():
        sw = cfg.signals.get(name)
        counts = name in counted
        points = 0.0
        if counts and denom > 0:
            points = 100.0 * sw.weight * out.normalized * out.confidence / denom
        total += points
        components.append(
            {
                "signal": name,
                "counted": counts,
                "weight": sw.weight if sw else 0.0,
                "normalized": out.normalized,
                "confidence": out.confidence,
                "points": round(points, 2),
                "reason_codes": out.reason_codes,
                "is_mock": out.is_mock,
            }
        )

    components.sort(key=lambda c: c["points"], reverse=True)
    reason_codes: list[str] = []
    for c in components:
        for code in c["reason_codes"]:
            if code not in reason_codes:
                reason_codes.append(code)

    total = round(min(100.0, total), 2)
    return ScoreResult(score=total, tier=tier_for(total, cfg.tiers), reason_codes=reason_codes, components=components)
