import Link from "next/link";
import { requireOrganization, requireUser } from "@/lib/org";
import { loadOrganizationSummary, CONFIDENCE_COPY } from "@/lib/summary";
import { ELIGIBILITY_LABELS } from "@/lib/eligibility/engine";
import { AppShell } from "@/components/dashboard/shell";
import { SourceCard } from "@/components/dashboard/source-card";
import { CategoryChart } from "@/components/dashboard/category-chart";
import { DevControls } from "@/components/dashboard/dev-controls";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { catalog } from "@/lib/connectors/registry";
import { brand } from "@/config/brand";
import { formatBytes, formatCount, formatDateRange, formatRelative } from "@/lib/utils";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

/*
 * FRAMING NOTE — read before editing this page.
 *
 * The hero summary shows measured volume, record counts, category mix, date
 * range and eligibility status. It does NOT show a portfolio dollar total, and
 * no such total exists anywhere in this codebase to render. Rates appear only
 * inside a per-source card, only after the questionnaire, and only for a source
 * whose eligibility status is LIKELY_ELIGIBLE.
 */

export default async function DashboardPage() {
  const user = await requireUser();
  const { organization } = await requireOrganization(user.id);
  const summary = await loadOrganizationSummary(organization.id);

  const { totals, sources, eligibility } = summary;
  const hasScan = totals.scannedSourceCount > 0;
  const eligibilityCopy = eligibility ? ELIGIBILITY_LABELS[eligibility.status] : null;
  const available = catalog().filter(
    (c) => !sources.some((s) => s.provider === c.provider && s.status !== "DISCONNECTED")
  );

  return (
    <AppShell
      current="/dashboard"
      organizationName={organization.name}
      isDemo={organization.isDemo}
      isPlatformAdmin={user.isPlatformAdmin}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Data inventory</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {hasScan
              ? `Measured across ${totals.scannedSourceCount} source${totals.scannedSourceCount === 1 ? "" : "s"} · updated ${formatRelative(totals.lastUpdatedAt)}`
              : "Connect a source to start measuring."}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/sources">Add a source</Link>
        </Button>
      </div>

      {!hasScan ? (
        <EmptyState />
      ) : (
        <>
          {/* Summary — measurement and eligibility only. No currency figure. */}
          <Card className="mt-6">
            <CardContent className="pt-6">
              <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Total measured volume" value={formatBytes(totals.measuredBytes)} />
                <Metric
                  label="Records &amp; messages"
                  value={formatCount(totals.totalRecords)}
                  sub={`${formatCount(totals.totalFiles)} files`}
                />
                <Metric
                  label="Date range"
                  value={formatDateRange(totals.oldestItemAt, totals.newestItemAt)}
                  small
                />
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-subtle">
                    Eligibility status
                  </dt>
                  <dd className="mt-1.5">
                    {eligibilityCopy ? (
                      <Badge
                        tone={
                          eligibilityCopy.tone === "positive"
                            ? "positive"
                            : eligibilityCopy.tone === "negative"
                              ? "negative"
                              : "caution"
                        }
                      >
                        {eligibilityCopy.label}
                      </Badge>
                    ) : (
                      <Badge tone="caution">Not yet assessed</Badge>
                    )}
                    <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                      {eligibilityCopy?.blurb ?? "Complete the questionnaire to get an assessment."}
                    </p>
                  </dd>
                </div>
              </dl>

              {totals.categoryMix.length > 0 ? (
                <div className="mt-8 border-t border-line pt-6">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                    Category mix by measured volume
                  </h2>
                  <div className="mt-4">
                    <CategoryChart data={totals.categoryMix} />
                  </div>
                </div>
              ) : null}

              {totals.lowestConfidence ? (
                <p className="mt-6 border-t border-line pt-4 text-xs leading-relaxed text-ink-subtle">
                  Lowest confidence tier across your sources is{" "}
                  <strong className="text-ink-muted">
                    {CONFIDENCE_COPY[totals.lowestConfidence].label}
                  </strong>
                  . {CONFIDENCE_COPY[totals.lowestConfidence].blurb} Per-source method and confidence
                  are shown on each card below.
                </p>
              ) : null}
            </CardContent>
          </Card>

          {/* Next-step CTAs */}
          {!summary.questionnaireSubmittedAt ? (
            <Notice tone="info" className="mt-6" title="Next: the rights questionnaire">
              <p>
                Your inventory is measured. The rights and sensitivity questionnaire takes about
                three minutes and produces your eligibility assessment. No dollar figure is shown
                anywhere in this product until it is complete.
              </p>
              <p>
                <Button asChild size="sm" className="mt-3">
                  <Link href="/questionnaire">Start the questionnaire</Link>
                </Button>
              </p>
            </Notice>
          ) : (
            <Notice tone="info" className="mt-6" title="Next: request a verified review">
              <p>
                Your Data Inventory &amp; Eligibility Report is ready. A verified review puts a
                person on the rights position. Requesting one commits you to nothing and is not an
                offer from us.
              </p>
              <p className="mt-3 flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link href="/report">View the report</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/review">Request a verified review</Link>
                </Button>
              </p>
            </Notice>
          )}
        </>
      )}

      {/* Per-source cards */}
      {sources.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-base font-semibold tracking-tight text-ink">Connected sources</h2>
          <div className="mt-4 space-y-5">
            {sources.map((s) => (
              <SourceCard key={s.connectionId} source={s} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Add another source */}
      {available.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-base font-semibold tracking-tight text-ink">Add another source</h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {available.map((c) => (
              <li key={c.provider}>
                <Card className="h-full">
                  <CardContent className="flex h-full flex-col pt-6">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold text-ink">{c.label}</h3>
                      {!c.liveCapable ? <Badge tone="caution">Demo only</Badge> : null}
                    </div>
                    <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-muted">
                      {c.description}
                    </p>
                    <Button asChild size="sm" variant="outline" className="mt-4 self-start">
                      <Link href={`/sources/${c.provider.toLowerCase()}`}>Review permissions</Link>
                    </Button>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <DevControls sources={sources} />

      <p className="mt-10 text-xs leading-relaxed text-ink-subtle">
        {brand.legal.connectionDisclosure}
      </p>
    </AppShell>
  );
}

function Metric({
  label,
  value,
  sub,
  small,
}: {
  label: string;
  value: string;
  sub?: string;
  small?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd
        className={
          small
            ? "mt-1.5 text-sm font-medium text-ink"
            : "mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-ink"
        }
      >
        {value}
      </dd>
      {sub ? <p className="mt-1 text-xs text-ink-subtle">{sub}</p> : null}
    </div>
  );
}

function EmptyState() {
  return (
    <Card className="mt-6">
      <CardContent className="py-14 text-center">
        <h2 className="text-lg font-semibold text-ink">Nothing measured yet</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
          Connect a source and we will measure its volume, counts, category mix and date range using
          metadata only. You will see exactly what each permission allows before you authorize
          anything.
        </p>
        <Button asChild className="mt-6">
          <Link href="/sources">Choose a source</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
