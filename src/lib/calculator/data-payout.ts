/**
 * Data-payout estimate calculator.
 *
 * PROVENANCE: these constants replicate the calculator published at
 * micro1.ai/data-payout. They were derived from that site's public JavaScript
 * bundle and reconciled against five figures the live page produces; see
 * tests/unit/data-payout.test.ts, which pins all five.
 *
 * HOW THE NUMBER IS BUILT — read this before changing anything:
 *
 *   estimate = band × (flatFee + perEmployee×E + perYear×Y + perGb×GB) × multipliers
 *
 * The GB term is NOT a measurement. Nothing in this calculator asks how much
 * data the business has; GB is assumed as employees × years × (1..14). Combined
 * with a $140,000 flat fee applied to every quote, the output is large for any
 * input, including a one-person company with one year of history ($116,681 low).
 *
 * This is a marketing estimator, not a valuation, and it shares no code with the
 * eligibility or rate engines. Those measure real provider metadata and refuse to
 * emit a figure for a corpus that has not passed a rights screen. Do not import
 * this module into either of them.
 */

export type Region = "US" | "CA_EU" | "OTHER";

export type PayoutInput = {
  employees: number;
  years: number;
  region: Region;
  /** Distinct data sources. Each one after the first adds 12.5%. */
  entities?: number;
  /** Share of the corpus in English, 0-100. Scales the result linearly. */
  englishPct?: number;
  /** Sensitive data present. Raises the estimate by half. */
  sensitive?: boolean;
};

export const PAYOUT_CONFIG = {
  /** Applied to every quote regardless of size. Dominates small inputs. */
  flatFee: 140_000,
  perEmployee: 2_333,
  perYear: 11_667,
  perGb: 15.75,

  /** Assumed data volume per employee per year. Not measured, not asked for. */
  gbPerEmployeeYearLow: 1,
  gbPerEmployeeYearHigh: 14,
  minGbLow: 100,
  minGbHigh: 200,

  /** The published range is a fixed band around the same base figure. */
  bandLow: 0.75,
  bandHigh: 1.25,

  regionMultiplier: { US: 1.0, CA_EU: 0.75, OTHER: 0.3 } as Record<Region, number>,
  sensitiveMultiplier: 1.5,
  perAdditionalEntity: 0.125,
} as const;

export type PayoutBreakdown = {
  low: number;
  high: number;
  /** Every component, so the arithmetic can be audited rather than trusted. */
  detail: {
    flatFee: number;
    employeeComponent: number;
    yearComponent: number;
    gbLow: number;
    gbHigh: number;
    gbComponentLow: number;
    gbComponentHigh: number;
    subtotalLow: number;
    subtotalHigh: number;
    multiplier: number;
  };
};

function clampNumber(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

export function calculateDataPayout(input: PayoutInput): PayoutBreakdown {
  const C = PAYOUT_CONFIG;

  const employees = Math.round(clampNumber(input.employees, 0, 1_000_000));
  const years = Math.round(clampNumber(input.years, 0, 200));
  const entities = Math.round(clampNumber(input.entities ?? 1, 1, 100));
  const englishPct = clampNumber(input.englishPct ?? 100, 0, 100);
  const region = C.regionMultiplier[input.region] != null ? input.region : "US";

  const multiplier =
    C.regionMultiplier[region] *
    (input.sensitive ? C.sensitiveMultiplier : 1) *
    (1 + C.perAdditionalEntity * Math.max(0, entities - 1)) *
    (englishPct / 100);

  const employeeComponent = C.perEmployee * employees;
  const yearComponent = C.perYear * years;

  const gbLow = Math.max(C.minGbLow, employees * years * C.gbPerEmployeeYearLow);
  const gbHigh = Math.max(C.minGbHigh, employees * years * C.gbPerEmployeeYearHigh);
  const gbComponentLow = C.perGb * gbLow;
  const gbComponentHigh = C.perGb * gbHigh;

  const subtotalLow = C.flatFee + employeeComponent + yearComponent + gbComponentLow;
  const subtotalHigh = C.flatFee + employeeComponent + yearComponent + gbComponentHigh;

  return {
    low: Math.round(C.bandLow * subtotalLow * multiplier),
    high: Math.round(C.bandHigh * subtotalHigh * multiplier),
    detail: {
      flatFee: C.flatFee,
      employeeComponent,
      yearComponent,
      gbLow,
      gbHigh,
      gbComponentLow,
      gbComponentHigh,
      subtotalLow,
      subtotalHigh,
      multiplier,
    },
  };
}

export const REGION_LABELS: Record<Region, string> = {
  US: "United States",
  CA_EU: "Canada / Europe",
  OTHER: "Other",
};

export function formatPayout(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}
