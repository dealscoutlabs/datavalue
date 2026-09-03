/**
 * Durable, resumable scan jobs.
 *
 * Inngest was not configurable inside this timebox, so scans run as
 * database-backed jobs advanced by bounded continuation requests: the client (or
 * a cron) calls advanceScan repeatedly, and each call does a small, bounded
 * amount of provider work and then checkpoints. Every piece of state a resume
 * needs — provider cursors, partial totals, page counts, error state, timestamps
 * — lives in ScanJob and ScanCheckpoint, so a crashed or timed-out invocation
 * loses at most one page.
 *
 * Production upgrade path is documented in the README: swap advanceScan's caller
 * for an Inngest step function. advanceScan itself does not change.
 */
import { prisma } from "@/lib/prisma";
import { getAdapter } from "@/lib/connectors/registry";
import { demoMetricsFor } from "@/lib/connectors/demo";
import {
  emptyMetrics,
  normalizedMetricsSchema,
  type NormalizedMetrics,
  type ScanCursorState,
} from "@/lib/connectors/types";
import { decryptSecret, encryptOptional } from "@/lib/crypto";
import { ProviderError, safeErrorMessage, log } from "@/lib/logging";
import { refreshEligibility } from "@/lib/eligibility/service";
import type { ConnectionStatus, ProviderConnection, ScanJob } from "@/generated/prisma";

export type AdvanceResult = {
  scanJobId: string;
  status: ScanJob["status"];
  progressPct: number;
  progressLabel: string;
  done: boolean;
  error?: string;
  retryAfterMs?: number;
};

/** Idempotent: an in-flight job for the connection is reused rather than duplicated. */
export async function startScan(connectionId: string): Promise<ScanJob> {
  const connection = await prisma.providerConnection.findUniqueOrThrow({
    where: { id: connectionId },
  });

  const existing = await prisma.scanJob.findFirst({
    where: { connectionId, status: { in: ["QUEUED", "RUNNING", "PARTIAL", "RATE_LIMITED"] } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;

  const job = await prisma.scanJob.create({
    data: {
      organizationId: connection.organizationId,
      connectionId,
      status: "QUEUED",
      progressLabel: "Queued",
    },
  });
  await prisma.providerConnection.update({
    where: { id: connectionId },
    data: { status: "SCANNING", lastError: null },
  });
  await prisma.auditEvent.create({
    data: {
      organizationId: connection.organizationId,
      action: "scan.started",
      detail: { provider: connection.provider, scanJobId: job.id },
    },
  });
  return job;
}

export async function advanceScan(scanJobId: string): Promise<AdvanceResult> {
  const job = await prisma.scanJob.findUniqueOrThrow({
    where: { id: scanJobId },
    include: { connection: true },
  });

  if (job.status === "SUCCEEDED" || job.status === "FAILED" || job.status === "CANCELLED") {
    return {
      scanJobId,
      status: job.status,
      progressPct: job.progressPct,
      progressLabel: job.progressLabel ?? "",
      done: true,
      error: job.lastError ?? undefined,
    };
  }

  if (job.nextAttemptAt && job.nextAttemptAt > new Date()) {
    return {
      scanJobId,
      status: job.status,
      progressPct: job.progressPct,
      progressLabel: job.progressLabel ?? "Waiting out a provider rate limit",
      done: false,
      retryAfterMs: job.nextAttemptAt.getTime() - Date.now(),
    };
  }

  await prisma.scanJob.update({
    where: { id: scanJobId },
    data: {
      status: "RUNNING",
      startedAt: job.startedAt ?? new Date(),
      attempts: { increment: 1 },
      nextAttemptAt: null,
    },
  });

  try {
    if (job.connection.isDemo) return await advanceDemoScan(job.id, job.connection);
    return await advanceLiveScan(job.id, job.connection);
  } catch (err) {
    return await failJob(job.id, job.connection, err);
  }
}

// ---------------------------------------------------------------- live

async function advanceLiveScan(
  scanJobId: string,
  connection: ProviderConnection
): Promise<AdvanceResult> {
  const adapter = getAdapter(connection.provider);
  const accessToken = await getFreshAccessToken(connection);

  const checkpoints = await prisma.scanCheckpoint.findMany({ where: { scanJobId } });
  const state: ScanCursorState = {};
  for (const cp of checkpoints) {
    state[cp.stream] = {
      cursor: cp.cursor,
      completed: cp.completed,
      pageCount: cp.pageCount,
      sampling: (cp.samplingJson as Record<string, unknown> | null) ?? undefined,
    };
  }

  const job = await prisma.scanJob.findUniqueOrThrow({ where: { id: scanJobId } });
  const partial = loadPartial(job.partialTotals, adapter.unitType);

  const result = await adapter.scanPage({
    accessToken,
    state,
    partial,
    scanPath: connection.scanPath,
  });

  // Persist every stream cursor before doing anything else, so a crash right here
  // still leaves the job resumable from exactly this point.
  for (const [stream, s] of Object.entries(result.state)) {
    await prisma.scanCheckpoint.upsert({
      where: { scanJobId_stream: { scanJobId, stream } },
      create: {
        scanJobId,
        stream,
        cursor: s.cursor,
        completed: s.completed,
        pageCount: s.pageCount,
        samplingJson: (s.sampling as object | undefined) ?? undefined,
      },
      update: {
        cursor: s.cursor,
        completed: s.completed,
        pageCount: s.pageCount,
        samplingJson: (s.sampling as object | undefined) ?? undefined,
      },
    });
  }

  const done = !result.hasMore;
  await prisma.scanJob.update({
    where: { id: scanJobId },
    data: {
      status: done ? "SUCCEEDED" : "PARTIAL",
      progressPct: result.progressPct,
      progressLabel: result.progressLabel,
      pagesCompleted: { increment: 1 },
      itemsSeen: { increment: result.itemsSeen },
      partialTotals: result.partial as unknown as object,
      finishedAt: done ? new Date() : null,
      lastError: null,
      errorCode: null,
    },
  });

  if (done) {
    await finalize(connection, adapter.normalizeMetrics(result.partial));
  }

  return {
    scanJobId,
    status: done ? "SUCCEEDED" : "PARTIAL",
    progressPct: result.progressPct,
    progressLabel: result.progressLabel,
    done,
    retryAfterMs: result.retryAfterMs,
  };
}

// ---------------------------------------------------------------- demo

/**
 * The demo scan is a real job with real checkpoints; only the data source is a
 * fixture. It advances in visible steps so the scanning, partial and success
 * states are all exercised rather than skipped.
 */
const DEMO_STEPS = 4;

async function advanceDemoScan(
  scanJobId: string,
  connection: ProviderConnection
): Promise<AdvanceResult> {
  const job = await prisma.scanJob.findUniqueOrThrow({ where: { id: scanJobId } });
  const step = Math.min(DEMO_STEPS, job.pagesCompleted + 1);
  const done = step >= DEMO_STEPS;
  const target = demoMetricsFor(connection.provider);

  const partial: NormalizedMetrics = done
    ? target
    : scaleMetrics(target, step / DEMO_STEPS);

  const progressPct = done ? 100 : Math.round((step / DEMO_STEPS) * 90);
  const progressLabel = done
    ? "Scan complete"
    : `Reading metadata — ${Math.round(partial.totalFiles).toLocaleString()} items so far`;

  await prisma.scanCheckpoint.upsert({
    where: { scanJobId_stream: { scanJobId, stream: "demo:fixture" } },
    create: { scanJobId, stream: "demo:fixture", cursor: String(step), completed: done, pageCount: step },
    update: { cursor: String(step), completed: done, pageCount: step },
  });

  await prisma.scanJob.update({
    where: { id: scanJobId },
    data: {
      status: done ? "SUCCEEDED" : "PARTIAL",
      progressPct,
      progressLabel,
      pagesCompleted: step,
      itemsSeen: Math.round(partial.totalFiles + partial.totalRecords),
      partialTotals: partial as unknown as object,
      finishedAt: done ? new Date() : null,
    },
  });

  if (done) await finalize(connection, target);

  return { scanJobId, status: done ? "SUCCEEDED" : "PARTIAL", progressPct, progressLabel, done };
}

function scaleMetrics(m: NormalizedMetrics, f: number): NormalizedMetrics {
  const mix: NormalizedMetrics["categoryMix"] = {};
  for (const [k, v] of Object.entries(m.categoryMix)) {
    mix[k] = { bytes: Math.round(v.bytes * f), count: Math.round(v.count * f) };
  }
  return {
    ...m,
    totalBytes: Math.round(m.totalBytes * f),
    totalRecords: Math.round(m.totalRecords * f),
    totalFiles: Math.round(m.totalFiles * f),
    categoryMix: mix,
    recordBreakdown: m.recordBreakdown.map((r) => ({ ...r, count: Math.round(r.count * f) })),
  };
}

// ---------------------------------------------------------------- shared

async function finalize(connection: ProviderConnection, metrics: NormalizedMetrics) {
  const parsed = normalizedMetricsSchema.parse(metrics);

  await prisma.dataAssetMetric.upsert({
    where: { connectionId: connection.id },
    create: {
      organizationId: connection.organizationId,
      connectionId: connection.id,
      provider: connection.provider,
      unitType: parsed.unitType,
      totalBytes: BigInt(Math.round(parsed.totalBytes)),
      totalRecords: BigInt(Math.round(parsed.totalRecords)),
      totalFiles: BigInt(Math.round(parsed.totalFiles)),
      categoryMix: parsed.categoryMix,
      recordBreakdown: parsed.recordBreakdown,
      oldestItemAt: parsed.oldestItemAt ? new Date(parsed.oldestItemAt) : null,
      newestItemAt: parsed.newestItemAt ? new Date(parsed.newestItemAt) : null,
      confidence: parsed.confidence,
      method: parsed.method,
      caveats: parsed.caveats,
      scopeLimited: parsed.scopeLimited,
      isDemo: connection.isDemo,
      measuredAt: new Date(),
    },
    update: {
      unitType: parsed.unitType,
      totalBytes: BigInt(Math.round(parsed.totalBytes)),
      totalRecords: BigInt(Math.round(parsed.totalRecords)),
      totalFiles: BigInt(Math.round(parsed.totalFiles)),
      categoryMix: parsed.categoryMix,
      recordBreakdown: parsed.recordBreakdown,
      oldestItemAt: parsed.oldestItemAt ? new Date(parsed.oldestItemAt) : null,
      newestItemAt: parsed.newestItemAt ? new Date(parsed.newestItemAt) : null,
      confidence: parsed.confidence,
      method: parsed.method,
      caveats: parsed.caveats,
      scopeLimited: parsed.scopeLimited,
      measuredAt: new Date(),
    },
  });

  const status: ConnectionStatus = parsed.scopeLimited ? "SCOPE_LIMITED" : "SCANNED";
  await prisma.providerConnection.update({
    where: { id: connection.id },
    data: { status, lastError: null },
  });

  await prisma.auditEvent.create({
    data: {
      organizationId: connection.organizationId,
      action: "scan.completed",
      detail: {
        provider: connection.provider,
        confidence: parsed.confidence,
        scopeLimited: parsed.scopeLimited,
      },
    },
  });

  await refreshEligibility(connection.organizationId);
}

async function failJob(
  scanJobId: string,
  connection: ProviderConnection,
  err: unknown
): Promise<AdvanceResult> {
  const message = safeErrorMessage(err);
  const isRateLimit = err instanceof ProviderError && err.code.endsWith("_RATE_LIMITED");
  const isAuth = err instanceof ProviderError && err.status === 401;
  const retryAfterMs = err instanceof ProviderError ? err.retryAfterMs : undefined;

  await prisma.scanJob.update({
    where: { id: scanJobId },
    data: {
      status: isRateLimit ? "RATE_LIMITED" : "FAILED",
      lastError: message,
      errorCode: err instanceof ProviderError ? err.code : "UNKNOWN",
      finishedAt: isRateLimit ? null : new Date(),
      resumable: isRateLimit || !isAuth,
      nextAttemptAt: isRateLimit ? new Date(Date.now() + (retryAfterMs ?? 60_000)) : null,
      progressLabel: isRateLimit
        ? "Paused — the provider is rate limiting this scan"
        : "Scan stopped",
    },
  });

  await prisma.providerConnection.update({
    where: { id: connection.id },
    data: { status: isAuth ? "EXPIRED" : isRateLimit ? "SCANNING" : "ERROR", lastError: message },
  });

  log("scan.failed", { provider: connection.provider, code: err instanceof ProviderError ? err.code : "UNKNOWN" });

  return {
    scanJobId,
    status: isRateLimit ? "RATE_LIMITED" : "FAILED",
    progressPct: 0,
    progressLabel: isRateLimit ? "Paused — the provider is rate limiting this scan" : "Scan stopped",
    done: !isRateLimit,
    error: message,
    retryAfterMs: retryAfterMs ?? undefined,
  };
}

function loadPartial(raw: unknown, unitType: NormalizedMetrics["unitType"]): NormalizedMetrics {
  if (!raw) return emptyMetrics(unitType, "Scan in progress");
  const parsed = normalizedMetricsSchema.safeParse(raw);
  return parsed.success ? parsed.data : emptyMetrics(unitType, "Scan in progress");
}

/**
 * Decrypt the stored access token, refreshing it first when it is expired or
 * about to be. The plaintext token exists only inside this function's caller and
 * is never returned to a client component or written to a log.
 */
export async function getFreshAccessToken(connection: ProviderConnection): Promise<string> {
  if (!connection.accessTokenEnc) {
    throw new ProviderError("NO_CREDENTIAL", "This source is not connected.");
  }
  const expiresSoon =
    connection.accessTokenExpiresAt != null &&
    connection.accessTokenExpiresAt.getTime() - Date.now() < 120_000;

  if (!expiresSoon) return decryptSecret(connection.accessTokenEnc);

  if (!connection.refreshTokenEnc) {
    throw new ProviderError(
      "TOKEN_EXPIRED",
      "The authorization for this source has expired. Reconnect to continue.",
      401
    );
  }

  const adapter = getAdapter(connection.provider);
  const refreshed = await adapter.refreshToken({
    refreshToken: decryptSecret(connection.refreshTokenEnc),
  });

  await prisma.providerConnection.update({
    where: { id: connection.id },
    data: {
      accessTokenEnc: encryptOptional(refreshed.accessToken),
      refreshTokenEnc: refreshed.refreshToken
        ? encryptOptional(refreshed.refreshToken)
        : connection.refreshTokenEnc,
      accessTokenExpiresAt: refreshed.expiresAt,
      status: connection.status === "EXPIRED" ? "CONNECTED" : connection.status,
    },
  });

  return refreshed.accessToken;
}
