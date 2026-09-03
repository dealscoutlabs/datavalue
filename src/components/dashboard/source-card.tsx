import Link from "next/link";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { ScanProgress } from "@/components/dashboard/scan-progress";
import { RateChain } from "@/components/dashboard/rate-chain";
import { CONFIDENCE_COPY, type SourceView } from "@/lib/summary";
import { ELIGIBILITY_LABELS } from "@/lib/eligibility/engine";
import { formatBytes, formatCount, formatDateRange, formatRelative } from "@/lib/utils";
import { rescanAction } from "@/app/dashboard/actions";
import { brand } from "@/config/brand";

const STATUS_COPY: Record<
  string,
  { label: string; tone: "neutral" | "positive" | "caution" | "negative" | "info" }
> = {
  PENDING: { label: "Authorization pending", tone: "neutral" },
  CONNECTED: { label: "Connected", tone: "info" },
  SCANNING: { label: "Scanning", tone: "info" },
  SCANNED: { label: "Scanned", tone: "positive" },
  PARTIAL: { label: "Partial scan", tone: "caution" },
  EXPIRED: { label: "Authorization expired", tone: "caution" },
  SCOPE_LIMITED: { label: "Scope limited", tone: "caution" },
  ERROR: { label: "Error", tone: "negative" },
  DISCONNECTED: { label: "Disconnected", tone: "neutral" },
};

export function SourceCard({ source }: { source: SourceView }) {
  const status = STATUS_COPY[source.status] ?? STATUS_COPY.PENDING;
  const m = source.metrics;
  const eligibility = source.eligibility ? ELIGIBILITY_LABELS[source.eligibility.status] : null;
  const scanning =
    source.status === "SCANNING" &&
    source.activeScan != null &&
    !["SUCCEEDED", "FAILED", "CANCELLED"].includes(source.activeScan.status);

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {/* The heading is the source name alone, so its accessible name
                  stays stable as badges come and go. */}
              <h3 className="text-base font-semibold text-ink">{source.label}</h3>
              {source.isDemo ? <Badge tone="caution">{brand.demo.badgeLabel}</Badge> : null}
            </div>
            <p className="mt-0.5 truncate text-sm text-ink-muted">
              {source.accountLabel ?? "Account not labelled"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            {eligibility ? (
              <Badge tone={eligibility.tone === "positive" ? "positive" : eligibility.tone === "negative" ? "negative" : "caution"}>
                {eligibility.label}
              </Badge>
            ) : null}
          </div>
        </div>

        {scanning && source.activeScan ? (
          <ScanProgress
            scanJobId={source.activeScan.id}
            initialPct={source.activeScan.progressPct}
            initialLabel={source.activeScan.progressLabel ?? "Starting scan…"}
          />
        ) : null}

        {source.status === "EXPIRED" ? (
          <Notice tone="caution" className="mt-4">
            The authorization for this source has expired or was revoked at the provider. Reconnect
            to measure it again. Nothing measured previously has been lost.
          </Notice>
        ) : null}

        {source.status === "ERROR" && source.lastError ? (
          <Notice tone="negative" className="mt-4">
            {source.lastError}
          </Notice>
        ) : null}

        {m ? (
          <>
            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
              <Stat
                label={m.unitType === "STRUCTURED_RECORDS" ? "Records" : "Measured volume"}
                value={
                  m.unitType === "STRUCTURED_RECORDS"
                    ? formatCount(m.totalRecords)
                    : formatBytes(m.totalBytes)
                }
              />
              <Stat
                label={m.unitType === "STRUCTURED_RECORDS" ? "Attached files" : "Files"}
                value={formatCount(m.totalFiles)}
              />
              <Stat
                label="Date range"
                value={formatDateRange(m.oldestItemAt, m.newestItemAt)}
                small
              />
              <Stat label="Measured" value={formatRelative(m.measuredAt)} small />
            </dl>

            {m.recordBreakdown.length > 0 ? (
              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[26rem] text-sm">
                  <caption className="sr-only">Record counts and field completeness by object type</caption>
                  <thead>
                    <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-subtle">
                      <th scope="col" className="py-2 font-medium">Object type</th>
                      <th scope="col" className="py-2 text-right font-medium">Records</th>
                      <th scope="col" className="py-2 text-right font-medium">Field completeness</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.recordBreakdown.map((r) => (
                      <tr key={r.objectType} className="border-b border-line last:border-0">
                        <td className="py-2 capitalize text-ink">{r.objectType}</td>
                        <td className="py-2 text-right tabular-nums text-ink">{formatCount(r.count)}</td>
                        <td className="py-2 text-right tabular-nums text-ink-muted">
                          {r.fieldCompletenessPct == null ? "Not measured" : `${r.fieldCompletenessPct}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="mt-5 rounded-md border border-line bg-ground px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                How this was measured
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{m.method}</p>
              <p className="mt-2 text-sm text-ink-muted">
                <span className="font-medium text-ink">Confidence: {CONFIDENCE_COPY[m.confidence].label}.</span>{" "}
                {CONFIDENCE_COPY[m.confidence].blurb}
              </p>
              {m.caveats.length > 0 ? (
                <ul className="mt-3 space-y-1.5 border-t border-line pt-3 text-xs leading-relaxed text-ink-muted">
                  {m.caveats.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              ) : null}
            </div>

            {/*
             * Rates render here and ONLY here, and only when this source's own
             * eligibility assessment unlocked them. A source in REVIEW_REQUIRED or
             * LIKELY_INELIGIBLE shows the suppression notice instead.
             */}
            {source.rate ? (
              <RateChain rate={source.rate} />
            ) : source.eligibility && !source.eligibility.ratesUnlocked ? (
              <Notice tone="caution" className="mt-5" title="Rights review required">
                No indicative rate is shown for this source. {eligibility?.blurb} See the{" "}
                <Link href="/report" className="underline">
                  eligibility report
                </Link>{" "}
                for the specific reasons.
              </Notice>
            ) : null}
          </>
        ) : !scanning ? (
          <p className="mt-5 text-sm text-ink-muted">
            No completed scan yet for this source.
          </p>
        ) : null}
      </CardContent>

      <CardFooter className="flex-wrap justify-end gap-2">
        {source.status === "EXPIRED" ? (
          <Button asChild size="sm" variant="outline">
            <Link href={`/sources/${source.provider.toLowerCase()}`}>Reconnect</Link>
          </Button>
        ) : null}
        {!scanning ? (
          <form action={rescanAction}>
            <input type="hidden" name="connectionId" value={source.connectionId} />
            <Button type="submit" size="sm" variant="outline">
              {m ? "Rescan" : "Run scan"}
            </Button>
          </form>
        ) : null}
        {/* Routed to a confirmation screen rather than a one-click destructive action. */}
        <Button asChild size="sm" variant="danger">
          <Link href={`/disconnect/${source.connectionId}`}>Disconnect</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className={small ? "mt-1 text-sm text-ink" : "mt-1 text-lg font-semibold tabular-nums text-ink"}>
        {value}
      </dd>
    </div>
  );
}
