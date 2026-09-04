/**
 * Dashboard data loading.
 *
 * NOTE: this module intentionally exposes no function that sums money. It
 * aggregates VOLUME (bytes), COUNTS (files, records) and CATEGORY MIX across
 * sources, because those are measurements. Rates are per-source and per-unit and
 * are read individually from ValuationSnapshot; they are never totalled.
 */
import { prisma } from "@/lib/prisma";
import { loadLatestEligibility, type OrganizationEligibility } from "@/lib/eligibility/service";
import { CATEGORY_LABELS, type CategoryKey } from "@/lib/connectors/types";
import type {
  ConfidenceTier,
  ConnectionStatus,
  DataUnitType,
  ProviderKey,
} from "@/generated/prisma";
import type { EligibilityStatus } from "@/generated/prisma";

export type SourceView = {
  connectionId: string;
  provider: ProviderKey;
  label: string;
  accountLabel: string | null;
  status: ConnectionStatus;
  isDemo: boolean;
  scanPath: string | null;
  lastError: string | null;
  connectedAt: Date | null;

  metrics: {
    unitType: DataUnitType;
    totalBytes: number;
    totalRecords: number;
    totalFiles: number;
    categoryMix: Record<string, { bytes: number; count: number }>;
    recordBreakdown: { objectType: string; count: number; fieldCompletenessPct: number | null }[];
    oldestItemAt: Date | null;
    newestItemAt: Date | null;
    confidence: ConfidenceTier;
    method: string;
    caveats: string[];
    scopeLimited: boolean;
    measuredAt: Date;
  } | null;

  activeScan: {
    id: string;
    status: string;
    progressPct: number;
    progressLabel: string | null;
    lastError: string | null;
  } | null;

  eligibility: { status: EligibilityStatus; ratesUnlocked: boolean } | null;

  /** Present ONLY when this source's eligibility unlocked rates. */
  rate: {
    unitLabel: string;
    unitType: DataUnitType;
    lowRate: number;
    midRate: number;
    highRate: number;
    inputSnapshot: unknown;
  } | null;
};

export type OrganizationSummary = {
  organization: {
    id: string;
    name: string;
    website: string | null;
    industry: string | null;
    employeeRange: string | null;
    isDemo: boolean;
  };
  sources: SourceView[];
  totals: {
    measuredBytes: number;
    totalRecords: number;
    totalFiles: number;
    categoryMix: { key: CategoryKey; label: string; bytes: number; count: number }[];
    oldestItemAt: Date | null;
    newestItemAt: Date | null;
    lastUpdatedAt: Date | null;
    scannedSourceCount: number;
    lowestConfidence: ConfidenceTier | null;
    anyScopeLimited: boolean;
  };
  eligibility: OrganizationEligibility | null;
  questionnaireSubmittedAt: Date | null;
};

const PROVIDER_LABELS: Record<ProviderKey, string> = {
  DROPBOX: "Dropbox",
  HUBSPOT: "HubSpot CRM",
  MICROSOFT: "Microsoft 365",
  GOOGLE: "Google Workspace",
  GOOGLE_ADMIN: "Google Workspace (Admin)",
  SLACK: "Slack",
  DEMO: "Demo source",
};

export function providerLabel(p: ProviderKey): string {
  return PROVIDER_LABELS[p];
}

const CONFIDENCE_RANK: Record<ConfidenceTier, number> = {
  EXACT: 0,
  DERIVED: 1,
  SAMPLED: 2,
  SCOPE_LIMITED: 3,
};

export const CONFIDENCE_COPY: Record<ConfidenceTier, { label: string; blurb: string }> = {
  EXACT: {
    label: "Exact",
    blurb: "The provider reported this figure directly.",
  },
  DERIVED: {
    label: "Derived",
    blurb: "Computed from figures the provider reported, not reported directly.",
  },
  SAMPLED: {
    label: "Estimated from a sample",
    blurb: "The provider does not expose a total, so this is a bounded estimate from a metadata sample.",
  },
  SCOPE_LIMITED: {
    label: "Scope limited",
    blurb: "The provider structurally prevents measuring part of this corpus.",
  },
};

export async function loadOrganizationSummary(
  organizationId: string
): Promise<OrganizationSummary> {
  const [organization, connections, questionnaire, eligibility, snapshots] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    prisma.providerConnection.findMany({
      where: { organizationId, status: { not: "DISCONNECTED" } },
      include: {
        metrics: true,
        scanJobs: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.questionnaireResponse.findUnique({ where: { organizationId } }),
    loadLatestEligibility(organizationId),
    prisma.valuationSnapshot.findMany({ where: { organizationId } }),
  ]);

  const sources: SourceView[] = connections.map((c) => {
    const m = c.metrics;
    const job = c.scanJobs[0];
    const verdict = eligibility?.perSource[c.id] ?? null;
    const snapshot = snapshots.find((s) => s.connectionId === c.id) ?? null;

    return {
      connectionId: c.id,
      provider: c.provider,
      label: providerLabel(c.provider),
      accountLabel: c.accountLabel,
      status: c.status,
      isDemo: c.isDemo,
      scanPath: c.scanPath,
      lastError: c.lastError,
      connectedAt: c.connectedAt,
      metrics: m
        ? {
            unitType: m.unitType,
            totalBytes: Number(m.totalBytes),
            totalRecords: Number(m.totalRecords),
            totalFiles: Number(m.totalFiles),
            categoryMix: (m.categoryMix as Record<string, { bytes: number; count: number }>) ?? {},
            recordBreakdown:
              (m.recordBreakdown as SourceView["metrics"] extends null
                ? never
                : { objectType: string; count: number; fieldCompletenessPct: number | null }[]) ?? [],
            oldestItemAt: m.oldestItemAt,
            newestItemAt: m.newestItemAt,
            confidence: m.confidence,
            method: m.method,
            caveats: m.caveats,
            scopeLimited: m.scopeLimited,
            measuredAt: m.measuredAt,
          }
        : null,
      activeScan: job
        ? {
            id: job.id,
            status: job.status,
            progressPct: job.progressPct,
            progressLabel: job.progressLabel,
            lastError: job.lastError,
          }
        : null,
      eligibility: verdict ? { status: verdict.status, ratesUnlocked: verdict.ratesUnlocked } : null,
      // Belt and braces: even if a snapshot somehow survived, it is not surfaced
      // unless this source's latest assessment unlocked rates.
      rate:
        snapshot && verdict?.ratesUnlocked
          ? {
              unitLabel: snapshot.unitLabel,
              unitType: snapshot.unitType,
              lowRate: snapshot.lowRate,
              midRate: snapshot.midRate,
              highRate: snapshot.highRate,
              inputSnapshot: snapshot.inputSnapshot,
            }
          : null,
    };
  });

  const mix = new Map<string, { bytes: number; count: number }>();
  let measuredBytes = 0;
  let totalRecords = 0;
  let totalFiles = 0;
  let oldest: Date | null = null;
  let newest: Date | null = null;
  let lastUpdated: Date | null = null;
  let lowestConfidence: ConfidenceTier | null = null;
  let anyScopeLimited = false;
  let scannedSourceCount = 0;

  for (const s of sources) {
    if (!s.metrics) continue;
    scannedSourceCount += 1;
    measuredBytes += s.metrics.totalBytes;
    totalRecords += s.metrics.totalRecords;
    totalFiles += s.metrics.totalFiles;
    anyScopeLimited ||= s.metrics.scopeLimited;
    if (
      lowestConfidence == null ||
      CONFIDENCE_RANK[s.metrics.confidence] > CONFIDENCE_RANK[lowestConfidence]
    ) {
      lowestConfidence = s.metrics.confidence;
    }
    for (const [k, v] of Object.entries(s.metrics.categoryMix)) {
      const cur = mix.get(k) ?? { bytes: 0, count: 0 };
      mix.set(k, { bytes: cur.bytes + v.bytes, count: cur.count + v.count });
    }
    if (s.metrics.oldestItemAt && (!oldest || s.metrics.oldestItemAt < oldest)) {
      oldest = s.metrics.oldestItemAt;
    }
    if (s.metrics.newestItemAt && (!newest || s.metrics.newestItemAt > newest)) {
      newest = s.metrics.newestItemAt;
    }
    if (!lastUpdated || s.metrics.measuredAt > lastUpdated) lastUpdated = s.metrics.measuredAt;
  }

  const categoryMix = Array.from(mix.entries())
    .map(([key, v]) => ({
      key: key as CategoryKey,
      label: CATEGORY_LABELS[key as CategoryKey] ?? key,
      bytes: v.bytes,
      count: v.count,
    }))
    .sort((a, b) => b.bytes - a.bytes || b.count - a.count);

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      website: organization.website,
      industry: organization.industry,
      employeeRange: organization.employeeRange,
      isDemo: organization.isDemo,
    },
    sources,
    totals: {
      measuredBytes,
      totalRecords,
      totalFiles,
      categoryMix,
      oldestItemAt: oldest,
      newestItemAt: newest,
      lastUpdatedAt: lastUpdated,
      scannedSourceCount,
      lowestConfidence,
      anyScopeLimited,
    },
    eligibility,
    questionnaireSubmittedAt: questionnaire?.submittedAt ?? null,
  };
}
