/**
 * Rate engine.
 *
 * Returns an INDICATIVE PER-UNIT RATE RANGE for one source. It does not, and
 * must not, return a portfolio total. There is no function here that sums across
 * sources, and adding one would break the product's central framing constraint:
 * the deliverable is an inventory and an eligibility screen, not a valuation.
 *
 *   midpoint_rate = base_rate
 *                 x quality_multiplier
 *                 x recency_multiplier
 *                 x rights_multiplier
 *                 x uniqueness_multiplier
 *
 * Every multiplier is returned with a label so the full chain can be rendered.
 * The complete input snapshot and the formula version are persisted with each
 * computation, so editing a rate later never rewrites a historical result.
 */
import type { DataUnitType } from "@/generated/prisma";
import type { QuestionnaireInput } from "@/lib/eligibility/engine";
import type { NormalizedMetrics } from "@/lib/connectors/types";

export const FORMULA_VERSION = "1.0.0";

export type MultiplierStep = {
  key: "quality" | "recency" | "rights" | "uniqueness";
  label: string;
  value: number;
  /** Why this multiplier landed where it did. Rendered next to the number. */
  explanation: string;
};

export type RateComputation = {
  formulaVersion: string;
  unitType: DataUnitType;
  unitLabel: string;
  baseRate: number;
  baseRateNote: string;
  steps: MultiplierStep[];
  lowRate: number;
  midRate: number;
  highRate: number;
  /** The measured quantity the rate applies to, for context only — never multiplied out. */
  measuredQuantity: { value: number; unit: string };
};

export type FormulaParameters = {
  /** Low and high bounds are expressed as a fraction of the midpoint. */
  spreadLow: number;
  spreadHigh: number;
  bounds: { min: number; max: number };
};

export const DEFAULT_FORMULA_PARAMETERS: FormulaParameters = {
  // A 0.6x-1.6x band. Publicly reported corpus deals vary by more than this, but
  // a wider band would be uninformative and a narrower one would overstate our
  // precision.
  spreadLow: 0.6,
  spreadHigh: 1.6,
  bounds: { min: 0, max: 100000 },
};

// ---------------------------------------------------------------- multipliers

/**
 * Quality. Derived from what the scan actually measured, never from a self-report.
 * Structured sources use field completeness; unstructured sources use how
 * concentrated the corpus is in document-like categories, since a drive that is
 * 90% video backups is a different asset from one that is 90% documents.
 */
export function qualityMultiplier(metrics: NormalizedMetrics): MultiplierStep {
  if (metrics.unitType === "STRUCTURED_RECORDS") {
    const entries = metrics.recordBreakdown.filter((r) => r.fieldCompletenessPct != null);
    if (entries.length === 0) {
      return {
        key: "quality",
        label: "Quality",
        value: 0.8,
        explanation: "Field completeness could not be measured, so a conservative default is used.",
      };
    }
    const weightTotal = entries.reduce((a, e) => a + e.count, 0);
    const avg =
      weightTotal > 0
        ? entries.reduce((a, e) => a + (e.fieldCompletenessPct ?? 0) * e.count, 0) / weightTotal
        : entries.reduce((a, e) => a + (e.fieldCompletenessPct ?? 0), 0) / entries.length;
    // 40% complete -> 0.75x, 90% complete -> 1.15x, clamped.
    const value = clamp(0.75 + ((avg - 40) / 50) * 0.4, 0.7, 1.15);
    return {
      key: "quality",
      label: "Quality",
      value: round(value, 3),
      explanation: `${Math.round(avg)}% average field completeness across the measured object types.`,
    };
  }

  const mix = metrics.categoryMix;
  const totalBytes = Object.values(mix).reduce((a, b) => a + b.bytes, 0);
  if (totalBytes <= 0) {
    return {
      key: "quality",
      label: "Quality",
      value: 0.8,
      explanation: "No category mix was measured, so a conservative default is used.",
    };
  }
  const documentBytes =
    (mix.documents?.bytes ?? 0) +
    (mix.spreadsheets?.bytes ?? 0) +
    (mix.presentations?.bytes ?? 0) +
    (mix.email?.bytes ?? 0) +
    (mix.code?.bytes ?? 0);
  const share = documentBytes / totalBytes;
  // 10% document-like -> 0.75x, 80% -> 1.15x.
  const value = clamp(0.75 + ((share - 0.1) / 0.7) * 0.4, 0.7, 1.15);
  return {
    key: "quality",
    label: "Quality",
    value: round(value, 3),
    explanation: `${Math.round(share * 100)}% of measured bytes are document-like rather than media or archives.`,
  };
}

/**
 * Recency. Uses the measured newest item and the measured span. Corpora that
 * stopped growing years ago are worth less than live ones.
 */
export function recencyMultiplier(
  metrics: NormalizedMetrics,
  now: Date = new Date()
): MultiplierStep {
  if (!metrics.newestItemAt) {
    return {
      key: "recency",
      label: "Recency",
      value: 0.8,
      explanation: "No timestamps were measurable, so a conservative default is used.",
    };
  }
  const newest = Date.parse(metrics.newestItemAt);
  if (Number.isNaN(newest)) {
    return {
      key: "recency",
      label: "Recency",
      value: 0.8,
      explanation: "Timestamps could not be parsed, so a conservative default is used.",
    };
  }
  const monthsStale = Math.max(0, (now.getTime() - newest) / (1000 * 60 * 60 * 24 * 30.44));
  // Current (0 months) -> 1.15x; 36 months stale -> 0.65x.
  const value = clamp(1.15 - (monthsStale / 36) * 0.5, 0.65, 1.15);
  const desc =
    monthsStale < 2
      ? "The most recent measured item is within the last two months."
      : `The most recent measured item is about ${Math.round(monthsStale)} months old.`;
  return { key: "recency", label: "Recency", value: round(value, 3), explanation: desc };
}

/**
 * Rights. Capped at 1.0 by construction — a sensitive or uncertain answer can
 * only ever restrict a rate, never raise one. This cap is a hard invariant and
 * is asserted in the unit tests.
 */
export function rightsMultiplier(q: QuestionnaireInput | null): MultiplierStep {
  if (!q) {
    return {
      key: "rights",
      label: "Rights",
      value: 0.5,
      explanation: "The questionnaire has not been completed.",
    };
  }
  let value = 1.0;
  const notes: string[] = [];

  if (q.originCreatedOrControlled !== "YES") {
    value *= 0.6;
    notes.push("origin or contractual control is unconfirmed");
  }
  if (q.alreadyLicensed === "YES") {
    value *= 0.85;
    notes.push("already licensed elsewhere");
  }
  if (q.exclusivityPossible === "NO") {
    value *= 0.9;
    notes.push("exclusivity is not available");
  } else if (q.exclusivityPossible === "UNSURE") {
    value *= 0.95;
    notes.push("exclusivity is unconfirmed");
  }
  // Any residual sensitivity flag restricts further. In practice such a source
  // would not reach the rate engine at all, because the eligibility engine
  // suppresses rates for it; this is defence in depth.
  const sensitive = [
    q.thirdPartyPii, q.ndaBoundMaterial, q.employeePersonalData, q.personalData,
    q.healthData, q.financialData, q.childrensData, q.biometricData,
    q.legalPrivilegeData, q.credentialData, q.exportControlledData,
  ];
  const restricting = sensitive.filter((s) => s !== "NO").length;
  if (restricting > 0) {
    value *= Math.max(0.4, 1 - restricting * 0.15);
    notes.push(`${restricting} sensitivity flag${restricting === 1 ? "" : "s"} reported`);
  }

  // Hard invariant: rights can only restrict.
  value = clamp(value, 0.2, 1.0);
  return {
    key: "rights",
    label: "Rights",
    value: round(value, 3),
    explanation:
      notes.length === 0
        ? "No restricting rights condition was reported. This multiplier can never exceed 1.0."
        : `Restricted because ${notes.join(", ")}. This multiplier can never exceed 1.0.`,
  };
}

export function uniquenessMultiplier(q: QuestionnaireInput | null): MultiplierStep {
  const map: Record<string, { v: number; why: string }> = {
    UNIQUE_PROPRIETARY: {
      v: 1.25,
      why: "You described the corpus as unique or proprietary.",
    },
    SOMEWHAT: { v: 1.0, why: "You described the corpus as partly distinctive." },
    COMMONLY_AVAILABLE: {
      v: 0.6,
      why: "You described the corpus as commonly available elsewhere.",
    },
  };
  const chosen = q ? map[q.uniqueness] : undefined;
  return {
    key: "uniqueness",
    label: "Uniqueness",
    value: chosen?.v ?? 0.8,
    explanation: chosen?.why ?? "Uniqueness was not reported, so a conservative default is used.",
  };
}

// ---------------------------------------------------------------- computation

export function computeRate(args: {
  baseRate: number;
  baseRateNote: string;
  metrics: NormalizedMetrics;
  questionnaire: QuestionnaireInput | null;
  parameters?: FormulaParameters;
  now?: Date;
}): RateComputation {
  const params = args.parameters ?? DEFAULT_FORMULA_PARAMETERS;
  const steps: MultiplierStep[] = [
    qualityMultiplier(args.metrics),
    recencyMultiplier(args.metrics, args.now),
    rightsMultiplier(args.questionnaire),
    uniquenessMultiplier(args.questionnaire),
  ];

  const base = Number.isFinite(args.baseRate) ? Math.max(0, args.baseRate) : 0;
  const product = steps.reduce((acc, s) => acc * s.value, 1);
  const rawMid = base * product;

  const structured = args.metrics.unitType === "STRUCTURED_RECORDS";
  const dp = structured ? 3 : 2;

  const mid = clamp(rawMid, params.bounds.min, params.bounds.max);
  const low = clamp(mid * params.spreadLow, params.bounds.min, params.bounds.max);
  const high = clamp(mid * params.spreadHigh, params.bounds.min, params.bounds.max);

  return {
    formulaVersion: FORMULA_VERSION,
    unitType: args.metrics.unitType,
    unitLabel: structured ? "per usable record" : "per GB",
    baseRate: round(base, dp),
    baseRateNote: args.baseRateNote,
    steps,
    lowRate: round(low, dp),
    midRate: round(mid, dp),
    highRate: round(high, dp),
    measuredQuantity: structured
      ? { value: args.metrics.totalRecords, unit: "records" }
      : { value: round(args.metrics.totalBytes / 1024 ** 3, 2), unit: "GB" },
  };
}

// ---------------------------------------------------------------- utils

export function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

export function round(v: number, dp: number): number {
  if (!Number.isFinite(v)) return 0;
  const f = 10 ** dp;
  // Nudge away from binary representation edges so 1.005 rounds to 1.01.
  return Math.round((v + Number.EPSILON * Math.abs(v)) * f) / f;
}
