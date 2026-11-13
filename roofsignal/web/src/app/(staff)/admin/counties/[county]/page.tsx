import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, ReasonChip, TierBadge, fmt } from "@/components/ui";
import { ApiError, apiJson, type PropertyList, type ReasonCodes } from "@/lib/api";
import { requireRole } from "@/lib/session";

const PAGE = 50;

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function CountyProperties(props: PageProps<"/admin/counties/[county]">) {
  await requireRole("admin", "supervisor");
  const { county } = await props.params;
  const sp = await props.searchParams;
  const tier = one(sp.tier);
  const reason = one(sp.reason);
  const town = one(sp.town);
  const zip = one(sp.zip);
  const page = Math.max(1, Number(one(sp.page) ?? 1) || 1);

  let data: PropertyList;
  try {
    data = await apiJson<PropertyList>(`/api/counties/${encodeURIComponent(county)}/properties`, {
      tier,
      reason,
      town,
      zip,
      limit: String(PAGE),
      offset: String((page - 1) * PAGE),
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const codes = await apiJson<ReasonCodes>("/api/reason-codes");
  const pages = Math.max(1, Math.ceil(data.total / PAGE));
  const qs = (p: number) => {
    const q = new URLSearchParams();
    if (tier) q.set("tier", tier);
    if (reason) q.set("reason", reason);
    if (town) q.set("town", town);
    if (zip) q.set("zip", zip);
    q.set("page", String(p));
    return `?${q}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Scored properties · {county}</h1>
        <span className="text-xs text-ink-subtle">
          run {data.run.as_of} · weights {data.run.config_hash}
        </span>
      </div>

      <Card>
        <form className="flex flex-wrap items-end gap-3 text-sm" method="get">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-subtle">Tier</span>
            <select name="tier" defaultValue={tier ?? ""} className="rounded border border-line px-2 py-1">
              <option value="">Any</option>
              {["A", "B", "C", "D"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-subtle">Reason code</span>
            <select name="reason" defaultValue={reason ?? ""} className="rounded border border-line px-2 py-1">
              <option value="">Any</option>
              {Object.keys(codes).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-subtle">Town / village</span>
            <input name="town" defaultValue={town ?? ""} className="w-36 rounded border border-line px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-subtle">ZIP</span>
            <input name="zip" defaultValue={zip ?? ""} className="w-24 rounded border border-line px-2 py-1" />
          </label>
          <button className="rounded bg-accent px-3 py-1.5 text-white hover:bg-accent-hover">Filter</button>
          <span className="ml-auto text-ink-subtle">{fmt.format(data.total)} properties</span>
        </form>
      </Card>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs text-ink-subtle">
            <tr>
              <th className="px-3 py-2">Tier</th>
              <th className="px-3 py-2">Score</th>
              <th className="px-3 py-2">Address</th>
              <th className="px-3 py-2">Town</th>
              <th className="px-3 py-2">Built</th>
              <th className="px-3 py-2">Reasons</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((p) => (
              <tr key={p.id} className="border-b border-line last:border-0 hover:bg-ground">
                <td className="px-3 py-2">
                  <TierBadge tier={p.tier} />
                </td>
                <td className="px-3 py-2 tabular-nums">{p.score.toFixed(1)}</td>
                <td className="px-3 py-2">
                  <Link href={`/admin/properties/${p.id}`} className="text-accent hover:underline">
                    {p.site_address ?? p.parcel_id}
                  </Link>
                  <div className="text-xs text-ink-subtle">{p.zip}</div>
                </td>
                <td className="px-3 py-2">{p.municipality ?? p.town}</td>
                <td className="px-3 py-2 tabular-nums">{p.year_built ?? "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {p.reason_codes.map((c) => (
                      <ReasonChip key={c} code={c} label={codes[c]?.label} internal={codes[c]?.agent_visible === false} />
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-ink-subtle">
                  No properties match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm">
        {page > 1 ? <Link href={qs(page - 1)} className="text-accent">← Previous</Link> : <span />}
        <span className="text-ink-subtle">
          Page {page} of {fmt.format(pages)}
        </span>
        {page < pages ? <Link href={qs(page + 1)} className="text-accent">Next →</Link> : <span />}
      </div>
    </div>
  );
}
