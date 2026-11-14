import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, Notice, ReasonChip, TierBadge } from "@/components/ui";
import { ApiError, apiJson, type PropertyDetail, type ReasonCodes } from "@/lib/api";
import { requireRole } from "@/lib/session";

type StormEvidence = {
  events?: { type: string; magnitude: number; date: string; source: string; source_id: string; location: string }[];
  non_qualifying_reports?: number;
};

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-1.5 text-sm last:border-0">
      <span className="text-ink-subtle">{k}</span>
      <span className="text-right">{v ?? "—"}</span>
    </div>
  );
}

export default async function PropertyPage(props: PageProps<"/admin/properties/[id]">) {
  await requireRole("admin", "supervisor");
  const { id } = await props.params;
  let d: PropertyDetail;
  try {
    d = await apiJson<PropertyDetail>(`/api/properties/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 422)) notFound();
    throw e;
  }
  const codes = await apiJson<ReasonCodes>("/api/reason-codes");
  const p = d.property;
  const storm = d.signals.find((s) => s.signal === "storm")?.evidence as StormEvidence | undefined;
  const str = (k: string) => (p[k] == null ? null : String(p[k]));

  return (
    <div className="space-y-4">
      <Link href={`/admin/counties/${p.county_key}`} className="text-sm text-accent">
        ← {p.county_key}
      </Link>
      <div className="flex items-center gap-3">
        {d.score && <TierBadge tier={d.score.tier} />}
        <h1 className="text-lg font-semibold">{p.site_address ?? p.parcel_id}</h1>
        {d.score && <span className="tabular-nums text-ink-muted">{d.score.score.toFixed(1)} / 100</span>}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Parcel">
          <Row k="Parcel ID" v={<span className="font-mono text-xs">{p.parcel_id}</span>} />
          <Row k="Town / village" v={`${str("town") ?? ""}${p.municipality && p.municipality !== p.town ? ` / ${p.municipality}` : ""}`} />
          <Row k="ZIP" v={str("zip")} />
          <Row k="Property class" v={str("property_class")} />
          <Row k="Year built" v={str("year_built")} />
          <Row k="Owner" v={str("owner_name")} />
          <Row k="Owner mailing" v={[str("owner_mail_address"), str("owner_mail_city"), str("owner_mail_state"), str("owner_mail_zip")].filter(Boolean).join(", ")} />
          <Row k="Owner-occupied (guess)" v={p.owner_occupied_guess == null ? "unknown" : p.owner_occupied_guess ? "yes" : "no"} />
          <Row k="Source" v={`${str("source")} ${str("source_version") ?? ""}`} />
        </Card>

        <Card title="How this score was computed" aside={<span className="text-xs text-ink-subtle">weights {d.run.config_hash} · as of {d.run.as_of}</span>}>
          {d.score ? (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-subtle">
                <tr>
                  <th className="py-1">Signal</th>
                  <th className="py-1 text-right">Weight</th>
                  <th className="py-1 text-right">Value</th>
                  <th className="py-1 text-right">Conf.</th>
                  <th className="py-1 text-right">Points</th>
                </tr>
              </thead>
              <tbody>
                {d.score.components.map((c) => (
                  <tr key={c.signal} className={`border-t border-line ${c.counted ? "" : "text-ink-subtle"}`}>
                    <td className="py-1.5">
                      {c.signal}
                      {c.is_mock && <span className="ml-1 text-xs">(mock, not counted)</span>}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{c.weight}</td>
                    <td className="py-1.5 text-right tabular-nums">{c.normalized.toFixed(2)}</td>
                    <td className="py-1.5 text-right tabular-nums">{c.confidence.toFixed(2)}</td>
                    <td className="py-1.5 text-right font-medium tabular-nums">{c.points.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Notice>Not scored in the latest run.</Notice>
          )}
          <div className="mt-3 space-y-1">
            {d.score?.reason_codes.map((c) => (
              <div key={c} className="flex items-start gap-2 text-sm">
                <ReasonChip code={c} internal={codes[c]?.agent_visible === false} />
                <span className="text-ink-muted">
                  {codes[c]?.label}
                  {codes[c]?.agent_visible === false && <em className="text-ink-subtle"> (internal; never shown to agents or homeowners)</em>}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Storm reports touching this parcel (qualifying, lookback window)">
        {storm?.events?.length ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-subtle">
              <tr>
                <th className="py-1">Date</th>
                <th className="py-1">Type</th>
                <th className="py-1">Magnitude</th>
                <th className="py-1">Location</th>
                <th className="py-1">Source</th>
              </tr>
            </thead>
            <tbody>
              {storm.events.map((e) => (
                <tr key={e.source_id} className="border-t border-line">
                  <td className="py-1.5">{e.date}</td>
                  <td className="py-1.5">{e.type}</td>
                  <td className="py-1.5 tabular-nums">{e.type === "hail" ? `${e.magnitude}"` : `${e.magnitude} mph`}</td>
                  <td className="py-1.5">{e.location}</td>
                  <td className="py-1.5 text-xs text-ink-subtle">{e.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-ink-subtle">
            None. {storm?.non_qualifying_reports ? `${storm.non_qualifying_reports} report(s) nearby were below the thresholds.` : ""}
          </p>
        )}
      </Card>

      <Card title="Building permits matched to this parcel">
        {d.permits.length ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-subtle">
              <tr>
                <th className="py-1">Issued</th>
                <th className="py-1">Permit</th>
                <th className="py-1">Category</th>
                <th className="py-1">Description</th>
                <th className="py-1">Match</th>
              </tr>
            </thead>
            <tbody>
              {d.permits.map((pm) => (
                <tr key={pm.permit_no} className="border-t border-line">
                  <td className="py-1.5">{pm.issued_on ?? "—"}</td>
                  <td className="py-1.5 font-mono text-xs">{pm.jurisdiction} {pm.permit_no}</td>
                  <td className="py-1.5">{pm.work_category}</td>
                  <td className="py-1.5">{pm.work_type_raw}</td>
                  <td className="py-1.5 text-xs text-ink-subtle">
                    {pm.match_method} ({pm.match_confidence})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-ink-subtle">No permits matched. Permit data for this county is pending FOIL responses.</p>
        )}
      </Card>
    </div>
  );
}
