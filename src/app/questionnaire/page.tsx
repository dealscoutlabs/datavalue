import { requireOrganization, requireUser } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/dashboard/shell";
import { Notice } from "@/components/ui/notice";
import { QuestionnaireForm, type Defaults } from "./form";
import { brand } from "@/config/brand";

export const metadata = { title: "Rights & sensitivity questionnaire" };
export const dynamic = "force-dynamic";

export default async function QuestionnairePage() {
  const user = await requireUser();
  const { organization } = await requireOrganization(user.id);
  const existing = await prisma.questionnaireResponse.findUnique({
    where: { organizationId: organization.id },
  });

  const defaults: Defaults = existing
    ? (Object.fromEntries(
        Object.entries(existing).filter(([, v]) => typeof v === "string")
      ) as Defaults)
    : { industry: organization.industry ?? undefined };

  return (
    <AppShell
      current="/questionnaire"
      organizationName={organization.name}
      isDemo={organization.isDemo}
      isPlatformAdmin={user.isPlatformAdmin}
    >
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Rights &amp; sensitivity questionnaire
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          About three minutes. Your answers drive the eligibility assessment, which decides whether
          any indicative rate is shown at all.
        </p>

        <Notice tone="info" className="mt-5">
          {brand.legal.eligibilityDisclosure} Answer honestly — a conservative answer costs you
          nothing here, and an optimistic one produces an assessment you cannot rely on.
        </Notice>

        <QuestionnaireForm defaults={defaults} />
      </div>
    </AppShell>
  );
}
