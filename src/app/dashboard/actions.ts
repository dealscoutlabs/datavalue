"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { signOut } from "@/lib/auth";
import { requireUserStrict, requireConnection } from "@/lib/org";
import { getAdapter } from "@/lib/connectors/registry";
import { decryptOptional } from "@/lib/crypto";
import { startScan } from "@/lib/scan/runner";
import { refreshEligibility } from "@/lib/eligibility/service";
import { log, safeErrorMessage } from "@/lib/logging";

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}

const idSchema = z.object({ connectionId: z.string().cuid() });

export async function rescanAction(formData: FormData) {
  const user = await requireUserStrict();
  const { connectionId } = idSchema.parse({ connectionId: formData.get("connectionId") });
  await requireConnection(user.id, connectionId);
  await startScan(connectionId);
  revalidatePath("/dashboard");
}

/**
 * Disconnect: revoke at the provider where supported, then remove every stored
 * token, checkpoint and measurement. The connection row is retained in a
 * DISCONNECTED state only so the audit trail stays intact — it holds no
 * credential afterwards.
 */
export async function disconnectAction(formData: FormData) {
  const user = await requireUserStrict();
  const { connectionId } = idSchema.parse({ connectionId: formData.get("connectionId") });
  const connection = await requireConnection(user.id, connectionId);

  if (!connection.isDemo && connection.accessTokenEnc) {
    try {
      const adapter = getAdapter(connection.provider);
      await adapter.disconnect({ accessToken: decryptOptional(connection.accessTokenEnc) });
    } catch (err) {
      // Revocation is best effort. Local teardown proceeds regardless.
      log("disconnect.revoke_failed", {
        provider: connection.provider,
        reason: safeErrorMessage(err),
      });
    }
  }

  await prisma.$transaction([
    prisma.dataAssetMetric.deleteMany({ where: { connectionId } }),
    prisma.valuationSnapshot.deleteMany({ where: { connectionId } }),
    prisma.scanJob.deleteMany({ where: { connectionId } }),
    prisma.providerConnection.update({
      where: { id: connectionId },
      data: {
        status: "DISCONNECTED",
        accessTokenEnc: null,
        refreshTokenEnc: null,
        accessTokenExpiresAt: null,
        grantedScopes: null,
        disconnectedAt: new Date(),
        lastError: null,
      },
    }),
    prisma.auditEvent.create({
      data: {
        organizationId: connection.organizationId,
        userId: user.id,
        action: "connection.disconnected",
        detail: { provider: connection.provider },
      },
    }),
  ]);

  await refreshEligibility(connection.organizationId);
  revalidatePath("/dashboard");
  revalidatePath("/sources");
  redirect("/dashboard");
}

/** Deletes the account, the organisation, and every credential and measurement. */
export async function deleteAccountAction() {
  const user = await requireUserStrict();
  const memberships = await prisma.organizationMember.findMany({
    where: { userId: user.id },
    include: { organization: { include: { connections: true } } },
  });

  for (const m of memberships) {
    for (const connection of m.organization.connections) {
      if (connection.isDemo || !connection.accessTokenEnc) continue;
      try {
        await getAdapter(connection.provider).disconnect({
          accessToken: decryptOptional(connection.accessTokenEnc),
        });
      } catch {
        /* best effort */
      }
    }
    // Cascades remove connections, jobs, checkpoints, metrics, snapshots and leads.
    if (m.role === "OWNER") {
      await prisma.organization.delete({ where: { id: m.organizationId } });
    }
  }

  await prisma.user.delete({ where: { id: user.id } });
  log("account.deleted", {});
  await signOut({ redirect: false });
  redirect("/deleted");
}

// ---------------------------------------------------------------- dev controls

/**
 * Developer-only state simulation for the demo organisation.
 *
 * Guarded twice: the control is not rendered outside development, and this
 * action refuses to run outside development and refuses any non-demo connection.
 * It exists so the scanning, partial, scope-limited, expired and error states can
 * be exercised without waiting for a provider to misbehave.
 */
const simulateSchema = z.object({
  connectionId: z.string().cuid(),
  scenario: z.enum(["RESCAN", "SUCCESS", "SCOPE_LIMITED", "ERROR", "EXPIRED"]),
});

export async function simulateStateAction(formData: FormData) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Simulation controls are unavailable outside development.");
  }
  const user = await requireUserStrict();
  const parsed = simulateSchema.parse({
    connectionId: formData.get("connectionId"),
    scenario: formData.get("scenario"),
  });
  const connection = await requireConnection(user.id, parsed.connectionId);
  if (!connection.isDemo) {
    throw new Error("State simulation is only available for demo sources.");
  }

  switch (parsed.scenario) {
    case "RESCAN": {
      // Clears the measurement so the scan visibly runs from zero again.
      await prisma.scanJob.deleteMany({ where: { connectionId: connection.id } });
      await prisma.dataAssetMetric.deleteMany({ where: { connectionId: connection.id } });
      await prisma.valuationSnapshot.deleteMany({ where: { connectionId: connection.id } });
      await startScan(connection.id);
      break;
    }
    case "SUCCESS":
      await prisma.providerConnection.update({
        where: { id: connection.id },
        data: { status: "SCANNED", lastError: null },
      });
      break;
    case "SCOPE_LIMITED":
      await prisma.providerConnection.update({
        where: { id: connection.id },
        data: { status: "SCOPE_LIMITED", lastError: null },
      });
      await prisma.dataAssetMetric.updateMany({
        where: { connectionId: connection.id },
        data: { scopeLimited: true, confidence: "SCOPE_LIMITED" },
      });
      break;
    case "ERROR":
      await prisma.providerConnection.update({
        where: { id: connection.id },
        data: {
          status: "ERROR",
          lastError: "Simulated provider error: the provider returned a server error.",
        },
      });
      break;
    case "EXPIRED":
      await prisma.providerConnection.update({
        where: { id: connection.id },
        data: {
          status: "EXPIRED",
          lastError: "Simulated expiry: the authorization for this source is no longer valid.",
        },
      });
      break;
  }

  await refreshEligibility(connection.organizationId);
  revalidatePath("/dashboard");
}
