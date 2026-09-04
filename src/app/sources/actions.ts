"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserStrict, requireOrganization, assertOrgAccess } from "@/lib/org";
import { startScan } from "@/lib/scan/runner";
import { DEMO_ACCOUNT_LABELS } from "@/lib/connectors/demo";
import type { ProviderKey } from "@/generated/prisma";

const providerSchema = z.enum([
  "DROPBOX",
  "HUBSPOT",
  "MICROSOFT",
  "GOOGLE",
  "GOOGLE_ADMIN",
  "SLACK",
]);

/**
 * Adds a DEMO source. This is not an OAuth flow and does not pretend to be one:
 * no authorization screen is shown, no credential is stored, and the created
 * connection carries isDemo = true so every surface badges it as demo data.
 */
export async function addDemoSourceAction(formData: FormData) {
  const user = await requireUserStrict();
  const { organization } = await requireOrganization(user.id);
  await assertOrgAccess(user.id, organization.id);

  if (!organization.isDemo) {
    throw new Error("Demo sources can only be added to a demo organisation.");
  }

  const provider = providerSchema.parse(formData.get("provider")) as ProviderKey;

  const existing = await prisma.providerConnection.findFirst({
    where: { organizationId: organization.id, provider },
  });

  const connection =
    existing ??
    (await prisma.providerConnection.create({
      data: {
        organizationId: organization.id,
        provider,
        isDemo: true,
        status: "CONNECTED",
        accountLabel: DEMO_ACCOUNT_LABELS[provider] ?? "Demo account",
        connectedAt: new Date(),
      },
    }));

  if (existing) {
    await prisma.providerConnection.update({
      where: { id: existing.id },
      data: { status: "CONNECTED", disconnectedAt: null, lastError: null },
    });
  }

  await startScan(connection.id);
  revalidatePath("/dashboard");
  redirect("/dashboard");
}
