import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { log, safeErrorMessage } from "@/lib/logging";

/**
 * Liveness + readiness probe.
 *
 * A process that is up but cannot reach Postgres is not serving anything, so
 * this executes a trivial query and reports 200 only if the database answers.
 * Anything else is 503, which is what a platform health check needs in order to
 * hold traffic off a broken instance.
 *
 * The response body is deliberately generic. Prisma connection errors embed the
 * database host, and sometimes the credentials, in their message — this endpoint
 * is unauthenticated, so the detail is logged server-side and never returned.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Bounded so a hung connection fails the check instead of hanging it. */
const DB_TIMEOUT_MS = 5_000;

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET() {
  const startedAt = Date.now();
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error("Database check timed out")), DB_TIMEOUT_MS)
      ),
    ]);

    return NextResponse.json(
      { status: "ok", database: "reachable", latencyMs: Date.now() - startedAt },
      { status: 200, headers: NO_STORE }
    );
  } catch (err) {
    log("health.database_unreachable", { reason: safeErrorMessage(err) });
    return NextResponse.json(
      { status: "unavailable", database: "unreachable", latencyMs: Date.now() - startedAt },
      { status: 503, headers: NO_STORE }
    );
  }
}
