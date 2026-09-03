"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserStrict, requireOrganization } from "@/lib/org";
import { loadOrganizationSummary } from "@/lib/summary";
import { notifyLead } from "@/lib/notify";
import { EMPLOYEE_RANGES, INDUSTRIES } from "@/config/business";

const schema = z.object({
  contactName: z.string().trim().min(1).max(120),
  contactRole: z.string().trim().min(1).max(120),
  businessEmail: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  companyName: z.string().trim().min(1).max(200),
  website: z.string().trim().max(300).optional().or(z.literal("")),
  industry: z.enum(INDUSTRIES),
  employeeRange: z.enum(EMPLOYEE_RANGES),
  consentToContact: z.literal("on"),
  acknowledgedNotAnOffer: z.literal("on"),
});

export type ReviewState = { fieldErrors?: Record<string, string>; error?: string };

export async function submitReviewRequestAction(
  _prev: ReviewState,
  formData: FormData
): Promise<ReviewState> {
  const user = await requireUserStrict();
  const { organization } = await requireOrganization(user.id);

  const parsed = schema.safeParse(
    Object.fromEntries(
      Array.from(formData.entries()).map(([k, v]) => [k, typeof v === "string" ? v : ""])
    )
  );

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??=
        key === "consentToContact" || key === "acknowledgedNotAnOffer"
          ? "You need to tick this to continue."
          : "Check this field.";
    }
    return { fieldErrors, error: "Some details are missing." };
  }

  // Freeze the state of the account into the lead so it stands alone later.
  const summary = await loadOrganizationSummary(organization.id);
  const questionnaire = await prisma.questionnaireResponse.findUnique({
    where: { organizationId: organization.id },
  });

  const sourceSummary = summary.sources.map((s) => ({
    provider: s.provider,
    accountLabel: s.accountLabel,
    status: s.status,
    isDemo: s.isDemo,
    totalBytes: s.metrics?.totalBytes ?? 0,
    totalRecords: s.metrics?.totalRecords ?? 0,
    confidence: s.metrics?.confidence ?? null,
    scopeLimited: s.metrics?.scopeLimited ?? false,
    eligibility: s.eligibility?.status ?? null,
  }));

  const lead = await prisma.offerRequest.create({
    data: {
      organizationId: organization.id,
      contactName: parsed.data.contactName,
      contactRole: parsed.data.contactRole,
      businessEmail: parsed.data.businessEmail,
      phone: parsed.data.phone || null,
      companyName: parsed.data.companyName,
      website: parsed.data.website || null,
      industry: parsed.data.industry,
      employeeRange: parsed.data.employeeRange,
      sourceSummary,
      eligibilitySummary: {
        status: summary.eligibility?.status ?? "REVIEW_REQUIRED",
        engineVersion: summary.eligibility?.engineVersion ?? null,
        reasons: summary.eligibility?.reasons ?? [],
      },
      questionnaireSnapshot: questionnaire
        ? JSON.parse(JSON.stringify(questionnaire, (_k, v) => (v instanceof Date ? v.toISOString() : v)))
        : {},
      consentToContact: true,
      acknowledgedNotAnOffer: true,
    },
  });

  const notified = await notifyLead({
    offerRequestId: lead.id,
    companyName: parsed.data.companyName,
    contactName: parsed.data.contactName,
    businessEmail: parsed.data.businessEmail,
    eligibilityStatus: summary.eligibility?.status ?? "REVIEW_REQUIRED",
    sourceCount: summary.sources.length,
  });

  await prisma.offerRequest.update({
    where: { id: lead.id },
    data: {
      notifiedAt: notified.sent ? new Date() : null,
      notifyError: notified.sent ? null : (notified.error ?? null),
    },
  });

  await prisma.auditEvent.create({
    data: {
      organizationId: organization.id,
      userId: user.id,
      action: "offer_request.created",
      detail: { offerRequestId: lead.id, notified: notified.sent },
    },
  });

  redirect(`/review/submitted?ref=${lead.id}`);
}
