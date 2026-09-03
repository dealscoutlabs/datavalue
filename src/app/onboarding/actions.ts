"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserStrict } from "@/lib/org";
import { EMPLOYEE_RANGES, INDUSTRIES } from "@/config/business";


const schema = z.object({
  name: z.string().trim().min(1, "Enter your company name").max(200),
  website: z.string().trim().max(300).optional().or(z.literal("")),
  industry: z.enum(INDUSTRIES),
  employeeRange: z.enum(EMPLOYEE_RANGES),
});

export type OnboardingState = { fieldErrors?: Record<string, string> };

export async function createOrganizationAction(
  _prev: OnboardingState,
  formData: FormData
): Promise<OnboardingState> {
  const user = await requireUserStrict();

  const parsed = schema.safeParse({
    name: formData.get("name"),
    website: formData.get("website"),
    industry: formData.get("industry"),
    employeeRange: formData.get("employeeRange"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
    }
    return { fieldErrors };
  }

  const existing = await prisma.organizationMember.findFirst({ where: { userId: user.id } });
  if (existing) redirect("/dashboard");

  const org = await prisma.organization.create({
    data: {
      name: parsed.data.name,
      website: parsed.data.website || null,
      industry: parsed.data.industry,
      employeeRange: parsed.data.employeeRange,
      members: { create: { userId: user.id, role: "OWNER" } },
    },
  });

  await prisma.auditEvent.create({
    data: { organizationId: org.id, userId: user.id, action: "organization.created" },
  });

  redirect("/sources");
}
