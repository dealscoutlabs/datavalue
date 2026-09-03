"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserStrict, requireOrganization } from "@/lib/org";
import { refreshEligibility } from "@/lib/eligibility/service";
import { DATA_AGE_RANGES, INDUSTRIES } from "@/config/business";

const tri = z.enum(["YES", "NO", "UNSURE"]);

const schema = z.object({
  industry: z.enum(INDUSTRIES),
  dataAgeRange: z.enum(DATA_AGE_RANGES),
  originCreatedOrControlled: tri,
  thirdPartyPii: tri,
  ndaBoundMaterial: tri,
  employeePersonalData: tri,
  uniqueness: z.enum(["UNIQUE_PROPRIETARY", "SOMEWHAT", "COMMONLY_AVAILABLE"]),
  alreadyLicensed: tri,
  exclusivityPossible: tri,
  personalData: tri,
  healthData: tri,
  financialData: tri,
  childrensData: tri,
  biometricData: tri,
  legalPrivilegeData: tri,
  credentialData: tri,
  exportControlledData: tri,
  willingToAnonymize: tri,
  contactMethod: z.enum(["EMAIL", "PHONE", "EITHER"]),
});

export type QuestionnaireState = { fieldErrors?: Record<string, string>; error?: string };

export async function submitQuestionnaireAction(
  _prev: QuestionnaireState,
  formData: FormData
): Promise<QuestionnaireState> {
  const user = await requireUserStrict();
  const { organization } = await requireOrganization(user.id);

  const raw = Object.fromEntries(
    Array.from(formData.entries()).map(([k, v]) => [k, typeof v === "string" ? v : ""])
  );
  const parsed = schema.safeParse(raw);

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0] ?? "form")] ??= "Choose an answer.";
    }
    return {
      fieldErrors,
      error: "Answer every question. Anything left blank is treated as the most conservative answer.",
    };
  }

  await prisma.questionnaireResponse.upsert({
    where: { organizationId: organization.id },
    create: { organizationId: organization.id, ...parsed.data },
    update: { ...parsed.data, submittedAt: new Date() },
  });

  await prisma.auditEvent.create({
    data: {
      organizationId: organization.id,
      userId: user.id,
      action: "questionnaire.submitted",
    },
  });

  // Recompute eligibility, which in turn decides whether any rate exists at all.
  await refreshEligibility(organization.id);

  revalidatePath("/dashboard");
  revalidatePath("/report");
  redirect("/report");
}
