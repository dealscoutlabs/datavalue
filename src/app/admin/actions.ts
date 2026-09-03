"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/org";

/** Server-side authorization. The nav link being hidden is not a control. */
async function requireAdmin() {
  const user = await getSessionUser();
  if (!user?.isPlatformAdmin) throw new Error("Not authorized");
  return user;
}

const rateSchema = z.object({
  rateId: z.string().cuid(),
  baseRate: z.coerce.number().min(0).max(100000),
  sourceNote: z.string().trim().min(10).max(2000),
});

export async function updateRateAction(formData: FormData) {
  const user = await requireAdmin();
  const parsed = rateSchema.parse({
    rateId: formData.get("rateId"),
    baseRate: formData.get("baseRate"),
    sourceNote: formData.get("sourceNote"),
  });

  const before = await prisma.valuationRate.findUniqueOrThrow({ where: { id: parsed.rateId } });

  await prisma.valuationRate.update({
    where: { id: parsed.rateId },
    data: { baseRate: parsed.baseRate, sourceNote: parsed.sourceNote },
  });

  // Historical ValuationSnapshot rows are untouched by design: each one carries a
  // frozen copy of the base rate it used, so editing here never rewrites a result
  // a customer has already seen.
  await prisma.auditEvent.create({
    data: {
      userId: user.id,
      action: "admin.rate_updated",
      detail: {
        rateId: parsed.rateId,
        provider: before.provider,
        from: before.baseRate,
        to: parsed.baseRate,
      },
    },
  });

  revalidatePath("/admin");
}

const leadSchema = z.object({
  leadId: z.string().cuid(),
  status: z.enum(["NEW", "CONTACTED", "CLOSED"]),
});

export async function updateLeadStatusAction(formData: FormData) {
  const user = await requireAdmin();
  const parsed = leadSchema.parse({
    leadId: formData.get("leadId"),
    status: formData.get("status"),
  });
  await prisma.offerRequest.update({
    where: { id: parsed.leadId },
    data: { status: parsed.status },
  });
  await prisma.auditEvent.create({
    data: { userId: user.id, action: "admin.lead_status_updated", detail: { leadId: parsed.leadId } },
  });
  revalidatePath("/admin");
}
