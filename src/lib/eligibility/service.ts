/**
 * Persistence layer for the eligibility engine.
 *
 * Every write here also decides whether rates exist at all: a source whose
 * assessment is not LIKELY_ELIGIBLE has its ValuationSnapshot deleted, so there
 * is no stale dollar figure left in the database for a UI bug to surface later.
 */
import { prisma } from "@/lib/prisma";
import {
  assessOrganization,
  type EligibilityResult,
  type QuestionnaireInput,
  type SourceInput,
} from "./engine";
import { computeSnapshotsForOrganization } from "@/lib/valuation/service";
import type { QuestionnaireResponse } from "@/generated/prisma";

export function toQuestionnaireInput(
  row: QuestionnaireResponse | null
): QuestionnaireInput | null {
  if (!row) return null;
  return {
    industry: row.industry,
    dataAgeRange: row.dataAgeRange,
    originCreatedOrControlled: row.originCreatedOrControlled,
    thirdPartyPii: row.thirdPartyPii,
    ndaBoundMaterial: row.ndaBoundMaterial,
    employeePersonalData: row.employeePersonalData,
    uniqueness: row.uniqueness as QuestionnaireInput["uniqueness"],
    alreadyLicensed: row.alreadyLicensed,
    exclusivityPossible: row.exclusivityPossible,
    personalData: row.personalData,
    healthData: row.healthData,
    financialData: row.financialData,
    childrensData: row.childrensData,
    biometricData: row.biometricData,
    legalPrivilegeData: row.legalPrivilegeData,
    credentialData: row.credentialData,
    exportControlledData: row.exportControlledData,
    willingToAnonymize: row.willingToAnonymize,
  };
}

export async function loadSourceInputs(organizationId: string): Promise<SourceInput[]> {
  const connections = await prisma.providerConnection.findMany({
    where: { organizationId, status: { not: "DISCONNECTED" } },
    include: { metrics: true },
  });
  return connections.map((c) => {
    const m = c.metrics;
    return {
      connectionId: c.id,
      provider: c.provider,
      categoryKeys: m?.categoryMix ? Object.keys(m.categoryMix as object) : [],
      scopeLimited: m?.scopeLimited ?? false,
      hasMetrics: Boolean(m),
    } satisfies SourceInput;
  });
}

export type OrganizationEligibility = EligibilityResult & {
  perSource: Record<string, EligibilityResult>;
};

/**
 * Recompute and persist. Called after every scan completion, questionnaire
 * submission, and disconnect.
 */
export async function refreshEligibility(
  organizationId: string
): Promise<OrganizationEligibility> {
  const [questionnaireRow, sources] = await Promise.all([
    prisma.questionnaireResponse.findUnique({ where: { organizationId } }),
    loadSourceInputs(organizationId),
  ]);
  const questionnaire = toQuestionnaireInput(questionnaireRow);
  const result = assessOrganization(sources, questionnaire);

  const snapshot = {
    questionnaire: questionnaire ?? null,
    sources: sources.map((s) => ({
      connectionId: s.connectionId,
      provider: s.provider,
      categoryKeys: s.categoryKeys,
      scopeLimited: s.scopeLimited,
      hasMetrics: s.hasMetrics,
    })),
  };

  await prisma.$transaction([
    prisma.eligibilityAssessment.create({
      data: {
        organizationId,
        connectionId: null,
        status: result.status,
        engineVersion: result.engineVersion,
        reasons: result.reasons,
        inputSnapshot: snapshot,
        ratesUnlocked: result.ratesUnlocked,
      },
    }),
    ...Object.entries(result.perSource).map(([connectionId, r]) =>
      prisma.eligibilityAssessment.create({
        data: {
          organizationId,
          connectionId,
          status: r.status,
          engineVersion: r.engineVersion,
          reasons: r.reasons,
          inputSnapshot: {
            questionnaire: questionnaire ?? null,
            source: sources.find((s) => s.connectionId === connectionId) ?? null,
          },
          ratesUnlocked: r.ratesUnlocked,
        },
      })
    ),
  ]);

  // Rates are derived state. Recompute them only for sources this assessment
  // actually unlocked, and delete any snapshot for a source it did not.
  await computeSnapshotsForOrganization(organizationId, result);

  return result;
}

/** Latest persisted assessment, without recomputing. */
export async function loadLatestEligibility(
  organizationId: string
): Promise<OrganizationEligibility | null> {
  const rows = await prisma.eligibilityAssessment.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 60,
  });
  if (rows.length === 0) return null;

  const orgRow = rows.find((r) => r.connectionId == null);
  if (!orgRow) return null;

  const perSource: Record<string, EligibilityResult> = {};
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.connectionId || seen.has(r.connectionId)) continue;
    if (r.createdAt < orgRow.createdAt) continue;
    seen.add(r.connectionId);
    perSource[r.connectionId] = {
      status: r.status,
      engineVersion: r.engineVersion,
      reasons: r.reasons as EligibilityResult["reasons"],
      ratesUnlocked: r.ratesUnlocked,
    };
  }

  return {
    status: orgRow.status,
    engineVersion: orgRow.engineVersion,
    reasons: orgRow.reasons as EligibilityResult["reasons"],
    ratesUnlocked: orgRow.ratesUnlocked,
    perSource,
  };
}
