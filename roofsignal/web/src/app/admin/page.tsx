import Link from "next/link";

import { Card, Notice, Stat, TierBadge, fmt } from "@/components/ui";
import { apiJson, type CountySummary } from "@/lib/api";

export default async function AdminHome() {
  const counties = await apiJson<CountySummary[]>("/api/counties");

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Counties</h1>
      {counties.map((c) => {
        const run = c.latest_run;
        return (
          <Card
            key={c.key}
            title={`${c.name}, ${c.state}`}
            aside={<span className="text-xs text-ink-subtle">parcels via {c.parcel_adapter}</span>}
          >
            {c.properties === 0 ? (
              <Notice>
                No parcels loaded.{" "}
                {c.parcel_adapter === "csv_import"
                  ? "This county has no free parcel feed; load a FOIL or licensed export with `roofsignal parcels load`."
                  : "Run `roofsignal parcels load` to ingest."}
              </Notice>
            ) : !run ? (
              <Notice>{fmt.format(c.properties)} parcels loaded, not scored yet. Run `roofsignal score`.</Notice>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Stat label="Residential parcels" value={fmt.format(c.properties)} />
                  <Stat label="Touched by a storm report" value={fmt.format(run.stats.properties_with_storm_hits)} />
                  <Stat label="With a matched roof permit" value={fmt.format(run.stats.properties_with_roof_permit)} />
                  <Stat label="Scored as of" value={run.as_of} hint={`weights ${run.config_hash}`} />
                </div>
                <div className="flex flex-wrap gap-3">
                  {["A", "B", "C", "D"].map((t) => (
                    <Link
                      key={t}
                      href={`/admin/counties/${c.key}?tier=${t}`}
                      className="flex items-center gap-2 rounded border border-line px-3 py-2 text-sm hover:border-line-strong"
                    >
                      <TierBadge tier={t} />
                      <span className="tabular-nums">{fmt.format(run.stats.tiers[t] ?? 0)}</span>
                    </Link>
                  ))}
                  <Link href={`/admin/counties/${c.key}`} className="self-center text-sm text-accent hover:underline">
                    All properties →
                  </Link>
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
