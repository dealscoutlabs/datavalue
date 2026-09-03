import Link from "next/link";
import { requireOrganization, requireUser } from "@/lib/org";
import { loadOrganizationSummary, CONFIDENCE_COPY } from "@/lib/summary";
import { ELIGIBILITY_LABELS } from "@/lib/eligibility/engine";
import { AppShell } from "@/components/dashboard/shell";
import { RateChain } from "@/components/dashboard/rate-chain";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { brand } from "@/config/brand";
import { formatBytes, formatCount, formatDate, formatDateRange } from "@/lib/utils";

export const metadata = { title: "Data Inventory & Eligibility Report" };
export const dynamic = "force-dynamic";

export default async function ReportPage() {
  const user = await requireUser();
  const { organization } = await requireOrganization(user.id);
  const summary = await loadOrganizationSummary(organization.id);
  const { totals, sources, eligibility } = summary;

  const hasScan = totals.scannedSourceCount > 0;
  const questionnaireDone = Boolean(summary.questionnaireSubmittedAt);
  const overall = eligibility ? ELIGIBILITY_LABELS[eligibility.status] : null;
  const ratedSources = sources.filter((s) => s.rate != null);

  return (
    <AppShell
      current="/report"
      organizationName={organization.name}
      isDemo={organization.isDemo}
      isPlatformAdmin={user.isPlatformAdmin}
    >
      <div className="mx-auto max-w-3xl">
        <header>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            {brand.name} report
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
            Data Inventory &amp; Eligibility Report
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            {organization.name}
            {organization.industry ? ` · ${organization.industry}` : ""} · Generated{" "}
            {formatDate(new Date())}
          </p>
        </header>

        {!hasScan ? (
          <Notice tone="caution" className="mt-6" title="Nothing measured yet">
            <p>
              This report has no inventory to describe. Connect and scan at least one source first.
            </p>
            <p>
              <Button asChild size="sm" className="mt-3">
                <Link href="/sources">Add a source</Link>
              </Button>
            </p>
          </Notice>
        ) : (
          <>
            {/* 1. Inventory */}
            <section className="mt-8">
              <h2 className="text-lg font-semibold tracking-tight text-ink">1. What was measured</h2>
              <Card className="mt-4">
                <CardContent className="pt-6">
                  <dl className="grid gap-6 sm:grid-cols-3">
                    <Metric label="Total measured volume" value={formatBytes(totals.measuredBytes)} />
                    <Metric label="Records &amp; messages" value={formatCount(totals.totalRecords)} />
                    <Metric label="Files" value={formatCount(totals.totalFiles)} />
                  </dl>
                  <p className="mt-6 border-t border-line pt-4 text-sm text-ink-muted">
                    <span className="font-medium text-ink">Date range:</span>{" "}
                    {formatDateRange(totals.oldestItemAt, totals.newestItemAt)}
                  </p>

                  {totals.categoryMix.length > 0 ? (
                    <div className="mt-5 overflow-x-auto">
                      <table className="w-full min-w-[24rem] text-sm">
                        <caption className="sr-only">Category mix across all measured sources</caption>
                        <thead>
                          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-subtle">
                            <th scope="col" className="py-2 font-medium">Category</th>
                            <th scope="col" className="py-2 text-right font-medium">Volume</th>
                            <th scope="col" className="py-2 text-right font-medium">Items</th>
                          </tr>
                        </thead>
                        <tbody>
                          {totals.categoryMix.map((c) => (
                            <tr key={c.key} className="border-b border-line last:border-0">
                              <td className="py-2 text-ink">{c.label}</td>
                              <td className="py-2 text-right tabular-nums text-ink-muted">
                                {c.bytes > 0 ? formatBytes(c.bytes) : "—"}
                              </td>
                              <td className="py-2 text-right tabular-nums text-ink-muted">
                                {formatCount(c.count)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <div className="mt-4 space-y-3">
                {sources
                  .filter((s) => s.metrics)
                  .map((s) => (
                    <Card key={s.connectionId}>
                      <CardContent className="pt-5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold text-ink">{s.label}</h3>
                            {s.isDemo ? (
                              <Badge tone="caution">{brand.demo.badgeLabel}</Badge>
                            ) : null}
                          </div>
                          <Badge tone={s.metrics!.scopeLimited ? "caution" : "neutral"}>
                            {CONFIDENCE_COPY[s.metrics!.confidence].label}
                          </Badge>
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                          {s.metrics!.method}
                        </p>
                        {s.metrics!.caveats.length > 0 ? (
                          <ul className="mt-3 space-y-1.5 border-t border-line pt-3 text-xs leading-relaxed text-ink-subtle">
                            {s.metrics!.caveats.map((c) => (
                              <li key={c}>{c}</li>
                            ))}
                          </ul>
                        ) : null}
                      </CardContent>
                    </Card>
                  ))}
              </div>
            </section>

            {/* 2. Eligibility */}
            <section className="mt-10">
              <h2 className="text-lg font-semibold tracking-tight text-ink">
                2. Eligibility assessment
              </h2>

              {!questionnaireDone ? (
                <Notice tone="caution" className="mt-4" title="Questionnaire not completed">
                  <p>
                    Without your answers, eligibility defaults to the most conservative outcome and
                    no indicative rate is shown for any source. This is the intended behaviour.
                  </p>
                  <p>
                    <Button asChild size="sm" className="mt-3">
                      <Link href="/questionnaire">Complete the questionnaire</Link>
                    </Button>
                  </p>
                </Notice>
              ) : null}

              <Card className="mt-4">
                <CardContent className="pt-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm font-medium text-ink">Overall:</span>
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
                      <Badge tone="caution">Not yet assessed</Badge>
                    )}
                    {eligibility ? (
                      <span className="text-xs text-ink-subtle">
                        Engine version {eligibility.engineVersion}
                      </span>
                    ) : null}
                  </div>

                  {eligibility && eligibility.reasons.length > 0 ? (
                    <ul className="mt-4 space-y-3 border-t border-line pt-4">
                      {eligibility.reasons.map((r) => (
                        <li key={r.code} className="flex gap-3">
                          <Badge
                            tone={
                              r.severity === "BLOCKING"
                                ? "negative"
                                : r.severity === "REVIEW"
                                  ? "caution"
                                  : "neutral"
                            }
                            className="mt-0.5 shrink-0"
                          >
                            {r.severity === "BLOCKING"
                              ? "Blocking"
                              : r.severity === "REVIEW"
                                ? "Review"
                                : "Note"}
                          </Badge>
                          <p className="text-sm leading-relaxed text-ink-muted">{r.text}</p>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <p className="mt-5 border-t border-line pt-4 text-xs leading-relaxed text-ink-subtle">
                    {brand.legal.eligibilityDisclosure}
                  </p>
                </CardContent>
              </Card>

              <h3 className="mt-6 text-sm font-semibold text-ink">By source</h3>
              <div className="mt-3 space-y-3">
                {sources.map((s) => {
                  const v = s.eligibility ? ELIGIBILITY_LABELS[s.eligibility.status] : null;
                  const detail = eligibility?.perSource[s.connectionId];
                  return (
                    <Card key={s.connectionId}>
                      <CardContent className="pt-5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h4 className="text-sm font-semibold text-ink">{s.label}</h4>
                          {v ? (
                            <Badge
                              tone={
                                v.tone === "positive"
                                  ? "positive"
                                  : v.tone === "negative"
                                    ? "negative"
                                    : "caution"
                              }
                            >
                              {v.label}
                            </Badge>
                          ) : (
                            <Badge tone="caution">Not assessed</Badge>
                          )}
                        </div>
                        {detail ? (
                          <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-ink-muted">
                            {detail.reasons.map((r) => (
                              <li key={r.code}>{r.text}</li>
                            ))}
                          </ul>
                        ) : null}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>

            {/* 3. Rates — conditional on eligibility */}
            <section className="mt-10">
              <h2 className="text-lg font-semibold tracking-tight text-ink">
                3. Indicative reference rates
              </h2>

              {!questionnaireDone ? (
                <Notice tone="neutral" className="mt-4">
                  No rate is shown because the questionnaire has not been completed. This product
                  does not show a dollar figure of any kind before the eligibility assessment has
                  run.
                </Notice>
              ) : ratedSources.length === 0 ? (
                <Notice tone="caution" className="mt-4" title="Rights review required">
                  <p>
                    No indicative rate is shown, because no connected source passed the eligibility
                    screening. A rate would imply that a licensing conversation could proceed on the
                    current facts, and the assessment above says it cannot.
                  </p>
                  <p>
                    A verified review is the next step. A person looks at the rights position
                    properly, which is the only thing that can change this result.
                  </p>
                </Notice>
              ) : (
                <>
                  <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                    Shown per source and per unit. These are not added together: a portfolio total
                    would imply both a right to license and a buyer at that price, and neither has
                    been established here.
                  </p>
                  <div className="mt-4 space-y-4">
                    {ratedSources.map((s) => (
                      <Card key={s.connectionId}>
                        <CardContent className="pt-5">
                          <h3 className="text-sm font-semibold text-ink">{s.label}</h3>
                          <RateChain rate={s.rate!} />
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {sources.some((s) => s.metrics && !s.rate) ? (
                    <Notice tone="caution" className="mt-4" title="Suppressed for other sources">
                      {sources
                        .filter((s) => s.metrics && !s.rate)
                        .map((s) => s.label)
                        .join(", ")}{" "}
                      did not pass the screening, so no rate is shown for{" "}
                      {sources.filter((s) => s.metrics && !s.rate).length === 1 ? "it" : "them"}.
                    </Notice>
                  ) : null}
                </>
              )}
            </section>

            <div className="mt-10 flex flex-wrap gap-3 border-t border-line pt-6">
              <Button asChild>
                <Link href="/review">Request a verified review</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/questionnaire">Update my answers</Link>
              </Button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-ink">{value}</dd>
    </div>
  );
}
