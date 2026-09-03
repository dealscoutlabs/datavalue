/**
 * Persistence layer for the rate engine.
 *
 * Invariants enforced here, not in the UI:
 *  1. A ValuationSnapshot exists ONLY for a connection whose latest eligibility
 *     assessment is LIKELY_ELIGIBLE. Anything else has its snapshot deleted.
 *  2. Nothing in this file sums across connections. There is no portfolio total.
 */
import { prisma } from "@/lib/prisma";
import { computeRate, DEFAULT_FORMULA_PARAMETERS, FORMULA_VERSION, type FormulaParameters } from "./engine";
import { toQuestionnaireInput } from "@/lib/eligibility/service";
import type { EligibilityResult } from "@/lib/eligibility/engine";
import { normalizedMetricsSchema, type NormalizedMetrics } from "@/lib/connectors/types";
import type { DataAssetMetric } from "@/generated/prisma";

export async function getActiveFormulaVersion() {
  const active = await prisma.valuationFormulaVersion.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });
  if (active) return active;
  return prisma.valuationFormulaVersion.findFirst({ orderBy: { createdAt: "desc" } });
}

export function metricRowToNormalized(m: DataAssetMetric): NormalizedMetrics {
  return normalizedMetricsSchema.parse({
    unitType: m.unitType,
    totalBytes: Number(m.totalBytes),
    totalRecords: Number(m.totalRecords),
    totalFiles: Number(m.totalFiles),
    categoryMix: (m.categoryMix as NormalizedMetrics["categoryMix"]) ?? {},
    recordBreakdown: (m.recordBreakdown as NormalizedMetrics["recordBreakdown"]) ?? [],
    oldestItemAt: m.oldestItemAt?.toISOString() ?? null,
    newestItemAt: m.newestItemAt?.toISOString() ?? null,
    confidence: m.confidence,
    method: m.method,
    caveats: m.caveats,
    scopeLimited: m.scopeLimited,
  });
}

export async function computeSnapshotsForOrganization(
  organizationId: string,
  eligibility: { perSource: Record<string, EligibilityResult> }
) {
  const formula = await getActiveFormulaVersion();
  if (!formula) return;

  const [questionnaireRow, metrics, rates] = await Promise.all([
    prisma.questionnaireResponse.findUnique({ where: { organizationId } }),
    prisma.dataAssetMetric.findMany({ where: { organizationId } }),
    prisma.valuationRate.findMany({ where: { formulaVersionId: formula.id, isActive: true } }),
  ]);
  const questionnaire = toQuestionnaireInput(questionnaireRow);
  const parameters = (formula.parameters as FormulaParameters | null) ?? DEFAULT_FORMULA_PARAMETERS;

  for (const metric of metrics) {
    const verdict = eligibility.perSource[metric.connectionId];
    const unlocked = verdict?.ratesUnlocked === true;

    if (!unlocked) {
      // Leave nothing behind that a later UI change could render.
      await prisma.valuationSnapshot.deleteMany({ where: { connectionId: metric.connectionId } });
      continue;
    }

    const rate = rates.find(
      (r) => r.provider === metric.provider && r.unitType === metric.unitType
    );
    if (!rate) continue;

    const normalized = metricRowToNormalized(metric);
    const computation = computeRate({
      baseRate: rate.baseRate,
      baseRateNote: rate.sourceNote,
      metrics: normalized,
      questionnaire,
      parameters,
    });

    await prisma.valuationSnapshot.deleteMany({ where: { connectionId: metric.connectionId } });
    await prisma.valuationSnapshot.create({
      data: {
        organizationId,
        connectionId: metric.connectionId,
        formulaVersionId: formula.id,
        unitType: metric.unitType,
        unitLabel: computation.unitLabel,
        lowRate: computation.lowRate,
        midRate: computation.midRate,
        highRate: computation.highRate,
        // Frozen inputs: a later edit to ValuationRate cannot rewrite this row.
        inputSnapshot: {
          formulaVersion: FORMULA_VERSION,
          baseRate: computation.baseRate,
          baseRateNote: computation.baseRateNote,
          steps: computation.steps,
          measuredQuantity: computation.measuredQuantity,
          parameters,
          questionnaire: questionnaire ?? null,
          metricsMeasuredAt: metric.measuredAt.toISOString(),
        },
      },
    });
  }
}
