/**
 * Pins the calculator to the five figures micro1.ai's live page produces.
 * If any of these drift, the clone no longer matches the thing it replicates.
 */
import { describe, expect, it } from "vitest";
import { calculateDataPayout, PAYOUT_CONFIG } from "@/lib/calculator/data-payout";

describe("data payout calculator — parity with the published figures", () => {
  const cases: [string, Parameters<typeof calculateDataPayout>[0], number, number][] = [
    ["50 employees / 10 years / US", { employees: 50, years: 10, region: "US" }, 285_896, 604_463],
    ["100 employees / 5 years / US", { employees: 100, years: 5, region: "US" }, 329_633, 677_356],
    ["50 / 10 / Canada-Europe", { employees: 50, years: 10, region: "CA_EU" }, 214_422, 453_347],
    ["50 / 10 / Other", { employees: 50, years: 10, region: "OTHER" }, 85_769, 181_339],
    ["1 employee / 1 year / US", { employees: 1, years: 1, region: "US" }, 116_681, 196_438],
  ];

  for (const [name, input, low, high] of cases) {
    it(name, () => {
      const r = calculateDataPayout(input);
      expect(r.low).toBe(low);
      expect(r.high).toBe(high);
    });
  }

  it("exposes the intermediate subtotal the range is derived from", () => {
    const r = calculateDataPayout({ employees: 50, years: 10, region: "US" });
    expect(r.detail.subtotalLow).toBe(381_195);
    expect(Math.round(r.detail.subtotalLow * PAYOUT_CONFIG.bandLow)).toBe(285_896);
  });
});

describe("multiplier behaviour", () => {
  const base = { employees: 50, years: 10, region: "US" as const };

  it("applies the non-US haircut exactly", () => {
    const us = calculateDataPayout(base);
    expect(calculateDataPayout({ ...base, region: "CA_EU" }).low).toBe(Math.round(us.low * 0.75));
    expect(calculateDataPayout({ ...base, region: "OTHER" }).low).toBe(Math.round(us.low * 0.3));
  });

  it("raises the estimate by half when sensitive data is declared", () => {
    const plain = calculateDataPayout(base);
    const sensitive = calculateDataPayout({ ...base, sensitive: true });
    expect(sensitive.low).toBe(Math.round(plain.low * 1.5));
  });

  it("adds 12.5% per data source after the first", () => {
    const one = calculateDataPayout(base);
    expect(calculateDataPayout({ ...base, entities: 3 }).low).toBe(Math.round(one.low * 1.25));
  });

  it("scales linearly with the English share", () => {
    const full = calculateDataPayout(base);
    expect(calculateDataPayout({ ...base, englishPct: 50 }).low).toBe(Math.round(full.low * 0.5));
  });
});

describe("the flat fee dominates small inputs", () => {
  it("still quotes six figures for a one-person, one-year company", () => {
    const r = calculateDataPayout({ employees: 1, years: 1, region: "US" });
    expect(r.low).toBeGreaterThan(100_000);
    // Almost the entire figure is the flat fee, not anything about the business.
    expect(r.detail.flatFee / r.detail.subtotalLow).toBeGreaterThan(0.85);
  });

  it("quotes six figures even for zero employees and zero years", () => {
    const r = calculateDataPayout({ employees: 0, years: 0, region: "US" });
    expect(r.low).toBeGreaterThan(100_000);
  });
});

describe("input hardening", () => {
  it("does not produce NaN or negatives from hostile input", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -50]) {
      const r = calculateDataPayout({ employees: bad, years: bad, region: "US" });
      expect(Number.isFinite(r.low)).toBe(true);
      expect(Number.isFinite(r.high)).toBe(true);
      expect(r.low).toBeGreaterThanOrEqual(0);
    }
  });

  it("falls back to the US multiplier for an unknown region", () => {
    const r = calculateDataPayout({
      employees: 50,
      years: 10,
      region: "ATLANTIS" as never,
    });
    expect(r.low).toBe(285_896);
  });
});
