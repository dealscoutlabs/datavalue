import { describe, expect, it } from "vitest";
import {
  computeRate,
  DEFAULT_FORMULA_PARAMETERS,
  FORMULA_VERSION,
  qualityMultiplier,
  recencyMultiplier,
  rightsMultiplier,
  round,
  uniquenessMultiplier,
} from "@/lib/valuation/engine";
import type { NormalizedMetrics } from "@/lib/connectors/types";
import type { QuestionnaireInput } from "@/lib/eligibility/engine";

const GB = 1024 ** 3;

const CLEAN: QuestionnaireInput = {
  industry: "Manufacturing",
  dataAgeRange: "3–7 years",
  originCreatedOrControlled: "YES",
  thirdPartyPii: "NO",
  ndaBoundMaterial: "NO",
  employeePersonalData: "NO",
  uniqueness: "SOMEWHAT",
  alreadyLicensed: "NO",
  exclusivityPossible: "YES",
  personalData: "NO",
  healthData: "NO",
  financialData: "NO",
  childrensData: "NO",
  biometricData: "NO",
  legalPrivilegeData: "NO",
  credentialData: "NO",
  exportControlledData: "NO",
  willingToAnonymize: "YES",
};

function unstructured(overrides: Partial<NormalizedMetrics> = {}): NormalizedMetrics {
  return {
    unitType: "UNSTRUCTURED_BYTES",
    totalBytes: 100 * GB,
    totalRecords: 0,
    totalFiles: 1000,
    categoryMix: {
      documents: { bytes: 80 * GB, count: 800 },
      images: { bytes: 20 * GB, count: 200 },
    },
    recordBreakdown: [],
    oldestItemAt: "2020-01-01T00:00:00.000Z",
    newestItemAt: new Date().toISOString(),
    confidence: "EXACT",
    method: "test",
    caveats: [],
    scopeLimited: false,
    ...overrides,
  };
}

describe("rate engine", () => {
  it("multiplies the full chain into the midpoint and derives low and high from it", () => {
    const metrics = unstructured();
    const r = computeRate({ baseRate: 8, baseRateNote: "note", metrics, questionnaire: CLEAN });

    const product = r.steps.reduce((a, s) => a * s.value, 1);
    expect(r.midRate).toBeCloseTo(round(8 * product, 2), 2);
    expect(r.lowRate).toBeCloseTo(round(r.midRate * DEFAULT_FORMULA_PARAMETERS.spreadLow, 2), 2);
    expect(r.highRate).toBeCloseTo(round(r.midRate * DEFAULT_FORMULA_PARAMETERS.spreadHigh, 2), 2);
    expect(r.lowRate).toBeLessThanOrEqual(r.midRate);
    expect(r.midRate).toBeLessThanOrEqual(r.highRate);
  });

  it("stamps the formula version on every computation", () => {
    const r = computeRate({
      baseRate: 8,
      baseRateNote: "n",
      metrics: unstructured(),
      questionnaire: CLEAN,
    });
    expect(r.formulaVersion).toBe(FORMULA_VERSION);
  });

  it("returns a per-unit label, never a portfolio total", () => {
    const unstruct = computeRate({
      baseRate: 8,
      baseRateNote: "n",
      metrics: unstructured(),
      questionnaire: CLEAN,
    });
    expect(unstruct.unitLabel).toBe("per GB");

    const struct = computeRate({
      baseRate: 0.25,
      baseRateNote: "n",
      metrics: unstructured({
        unitType: "STRUCTURED_RECORDS",
        totalRecords: 24318,
        recordBreakdown: [{ objectType: "contacts", count: 24318, fieldCompletenessPct: 71.4 }],
      }),
      questionnaire: CLEAN,
    });
    expect(struct.unitLabel).toBe("per usable record");
    // The measured quantity is carried for context and is never multiplied in.
    expect(struct.measuredQuantity.value).toBe(24318);
    expect(struct.midRate).toBeLessThan(1);
  });

  it("exposes every multiplier with a label and an explanation", () => {
    const r = computeRate({
      baseRate: 8,
      baseRateNote: "n",
      metrics: unstructured(),
      questionnaire: CLEAN,
    });
    expect(r.steps.map((s) => s.key).sort()).toEqual(["quality", "recency", "rights", "uniqueness"]);
    for (const step of r.steps) {
      expect(step.label.length).toBeGreaterThan(0);
      expect(step.explanation.length).toBeGreaterThan(0);
      expect(Number.isFinite(step.value)).toBe(true);
    }
  });

  // --- the hard invariant --------------------------------------------------
  it("never lets the rights multiplier exceed 1.0, for any combination of answers", () => {
    const fields = [
      "thirdPartyPii", "ndaBoundMaterial", "employeePersonalData", "personalData",
      "healthData", "financialData", "childrensData", "biometricData",
      "legalPrivilegeData", "credentialData", "exportControlledData",
      "alreadyLicensed", "exclusivityPossible", "originCreatedOrControlled", "willingToAnonymize",
    ] as const;

    for (const field of fields) {
      for (const value of ["YES", "NO", "UNSURE"] as const) {
        const step = rightsMultiplier({ ...CLEAN, [field]: value });
        expect(step.value).toBeLessThanOrEqual(1.0);
        expect(step.value).toBeGreaterThan(0);
      }
    }
  });

  it("only ever lowers the rate when a sensitive answer is added", () => {
    const metrics = unstructured();
    const base = computeRate({ baseRate: 8, baseRateNote: "n", metrics, questionnaire: CLEAN });
    for (const field of ["healthData", "childrensData", "thirdPartyPii", "biometricData"] as const) {
      const worse = computeRate({
        baseRate: 8,
        baseRateNote: "n",
        metrics,
        questionnaire: { ...CLEAN, [field]: "YES" },
      });
      expect(worse.midRate).toBeLessThan(base.midRate);
    }
  });

  it("uses a conservative rights multiplier when there is no questionnaire", () => {
    expect(rightsMultiplier(null).value).toBeLessThan(1);
  });

  // --- edge cases ----------------------------------------------------------
  it("handles a zero base rate", () => {
    const r = computeRate({
      baseRate: 0,
      baseRateNote: "n",
      metrics: unstructured(),
      questionnaire: CLEAN,
    });
    expect(r.lowRate).toBe(0);
    expect(r.midRate).toBe(0);
    expect(r.highRate).toBe(0);
  });

  it("handles an empty corpus without producing NaN", () => {
    const r = computeRate({
      baseRate: 8,
      baseRateNote: "n",
      metrics: unstructured({
        totalBytes: 0,
        totalFiles: 0,
        categoryMix: {},
        oldestItemAt: null,
        newestItemAt: null,
      }),
      questionnaire: CLEAN,
    });
    for (const v of [r.lowRate, r.midRate, r.highRate]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it("clamps an absurd base rate to the configured bound", () => {
    const r = computeRate({
      baseRate: Number.MAX_SAFE_INTEGER,
      baseRateNote: "n",
      metrics: unstructured(),
      questionnaire: CLEAN,
    });
    expect(r.highRate).toBeLessThanOrEqual(DEFAULT_FORMULA_PARAMETERS.bounds.max);
    expect(r.midRate).toBeLessThanOrEqual(DEFAULT_FORMULA_PARAMETERS.bounds.max);
  });

  it("does not produce NaN or Infinity from non-finite input", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const r = computeRate({
        baseRate: bad,
        baseRateNote: "n",
        metrics: unstructured(),
        questionnaire: CLEAN,
      });
      expect(Number.isFinite(r.midRate)).toBe(true);
      expect(r.midRate).toBeGreaterThanOrEqual(0);
    }
  });

  it("rounds per-GB rates to 2dp and per-record rates to 3dp", () => {
    const perGb = computeRate({
      baseRate: 8.123456,
      baseRateNote: "n",
      metrics: unstructured(),
      questionnaire: CLEAN,
    });
    expect(String(perGb.midRate).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(2);

    const perRecord = computeRate({
      baseRate: 0.256789,
      baseRateNote: "n",
      metrics: unstructured({ unitType: "STRUCTURED_RECORDS", totalRecords: 100 }),
      questionnaire: CLEAN,
    });
    expect(String(perRecord.midRate).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(3);
  });

  it("rounds half away from binary representation error", () => {
    expect(round(1.005, 2)).toBe(1.01);
    expect(round(2.675, 2)).toBe(2.68);
    expect(round(0.1 + 0.2, 2)).toBe(0.3);
  });

  // --- individual multipliers ---------------------------------------------
  it("rates a document-heavy corpus above a media-heavy one", () => {
    const docs = qualityMultiplier(unstructured());
    const media = qualityMultiplier(
      unstructured({ categoryMix: { video: { bytes: 100 * GB, count: 50 } } })
    );
    expect(docs.value).toBeGreaterThan(media.value);
  });

  it("rates a current corpus above a stale one", () => {
    const now = new Date("2026-09-01T00:00:00.000Z");
    const fresh = recencyMultiplier(unstructured({ newestItemAt: "2026-08-20T00:00:00.000Z" }), now);
    const stale = recencyMultiplier(unstructured({ newestItemAt: "2021-01-01T00:00:00.000Z" }), now);
    expect(fresh.value).toBeGreaterThan(stale.value);
    expect(stale.value).toBeGreaterThanOrEqual(0.65);
  });

  it("weights field completeness for structured sources", () => {
    const good = qualityMultiplier(
      unstructured({
        unitType: "STRUCTURED_RECORDS",
        recordBreakdown: [{ objectType: "contacts", count: 100, fieldCompletenessPct: 95 }],
      })
    );
    const poor = qualityMultiplier(
      unstructured({
        unitType: "STRUCTURED_RECORDS",
        recordBreakdown: [{ objectType: "contacts", count: 100, fieldCompletenessPct: 20 }],
      })
    );
    expect(good.value).toBeGreaterThan(poor.value);
  });

  it("discounts a commonly available corpus", () => {
    expect(uniquenessMultiplier({ ...CLEAN, uniqueness: "COMMONLY_AVAILABLE" }).value).toBeLessThan(
      uniquenessMultiplier({ ...CLEAN, uniqueness: "UNIQUE_PROPRIETARY" }).value
    );
  });
});
