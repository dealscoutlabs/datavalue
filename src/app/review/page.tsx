import Link from "next/link";
import { requireOrganization, requireUser } from "@/lib/org";
import { loadOrganizationSummary } from "@/lib/summary";
import { ELIGIBILITY_LABELS } from "@/lib/eligibility/engine";
import { AppShell } from "@/components/dashboard/shell";
import { Notice } from "@/components/ui/notice";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ReviewForm } from "./form";
import { formatBytes, formatCount } from "@/lib/utils";

export const metadata = { title: "Request a verified review" };
export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const user = await requireUser();
  const { organization } = await requireOrganization(user.id);
  const summary = await loadOrganizationSummary(organization.id);
  const overall = summary.eligibility ? ELIGIBILITY_LABELS[summary.eligibility.status] : null;

  return (
    <AppShell
      current="/report"
      organizationName={organization.name}
      isDemo={organization.isDemo}
      isPlatformAdmin={user.isPlatformAdmin}
    >
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Request a verified review
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          A person reviews your rights position properly. This is a request, not an agreement, and
          it commits you to nothing.
        </p>

        {summary.totals.scannedSourceCount === 0 ? (
          <Notice tone="caution" className="mt-6" title="Nothing measured yet">
            <p>Connect and scan at least one source before requesting a review.</p>
            <p>
              <Button asChild size="sm" className="mt-3">
                <Link href="/sources">Add a source</Link>
              </Button>
            </p>
          </Notice>
        ) : (
          <>
            <Card className="mt-6">
              <CardContent className="pt-6">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  What will be attached
                </h2>
                <dl className="mt-3 grid gap-4 sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-ink-subtle">Sources</dt>
                    <dd className="mt-1 text-sm font-medium text-ink">
                      {formatCount(summary.sources.length)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-subtle">Measured volume</dt>
                    <dd className="mt-1 text-sm font-medium text-ink">
                      {formatBytes(summary.totals.measuredBytes)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-subtle">Eligibility</dt>
                    <dd className="mt-1">
                      {overall ? (
                        <Badge
                          tone={
                            overall.tone === "positive"
                              ? "positive"
                              : overall.tone === "negative"
                                ? "negative"
                                : "caution"
                          }
                        >
                          {overall.label}
                        </Badge>
                      ) : (
                        <Badge tone="caution">Not assessed</Badge>
                      )}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            <ReviewForm
              defaults={{
                contactName: user.name ?? undefined,
                businessEmail: user.email,
                companyName: organization.name,
                website: organization.website ?? undefined,
                industry: organization.industry ?? undefined,
                employeeRange: organization.employeeRange ?? undefined,
              }}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}
