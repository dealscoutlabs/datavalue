import Link from "next/link";
import { requireOrganization, requireUser } from "@/lib/org";
import { AppShell } from "@/components/dashboard/shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { brand } from "@/config/brand";

export const metadata = { title: "Request received" };

export default async function ReviewSubmittedPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;
  const user = await requireUser();
  const { organization } = await requireOrganization(user.id);

  return (
    <AppShell
      current="/report"
      organizationName={organization.name}
      isDemo={organization.isDemo}
      isPlatformAdmin={user.isPlatformAdmin}
    >
      <div className="mx-auto max-w-xl">
        <Card>
          <CardContent className="py-12 text-center">
            <span
              aria-hidden
              className="mx-auto grid size-11 place-items-center rounded-full border border-accent-line bg-accent-soft text-lg text-accent"
            >
              ✓
            </span>
            <h1 className="mt-5 text-xl font-semibold tracking-tight text-ink">
              Your request has been received
            </h1>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-muted">
              Your inventory summary, eligibility assessment and questionnaire answers were recorded
              and sent to our internal review address. No file, email or customer record was
              included, because none was ever read.
            </p>
            {ref ? (
              <p className="mt-4 font-mono text-xs text-ink-subtle">Reference: {ref}</p>
            ) : null}

            <div className="mx-auto mt-8 max-w-md rounded-md border border-line bg-ground px-4 py-4 text-left">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                What happens next
              </h2>
              <ol className="mt-3 space-y-2 text-sm leading-relaxed text-ink-muted">
                <li>1. A reviewer reads your report and the reasons behind your eligibility result.</li>
                <li>2. They come back to you with what a rights review would actually involve.</li>
                <li>
                  3. Nothing is sold, shared or licensed unless you negotiate and sign a separate
                  agreement.
                </li>
              </ol>
            </div>

            <p className="mx-auto mt-6 max-w-md text-xs leading-relaxed text-ink-subtle">
              {brand.legal.rateDisclosure}
            </p>

            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button asChild variant="outline">
                <Link href="/dashboard">Back to dashboard</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/report">View the report</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
