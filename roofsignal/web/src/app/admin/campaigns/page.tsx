import { Card, fmt } from "@/components/ui";
import { apiJson, type CampaignRow } from "@/lib/api";

export default async function Campaigns() {
  const rows = await apiJson<CampaignRow[]>("/api/campaigns");
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Campaigns</h1>
      <Card>
        {rows.length === 0 ? (
          <p className="text-sm text-ink-subtle">
            No campaigns yet. Create one with <code>roofsignal mail create &lt;county&gt; --name ...</code>
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-subtle">
              <tr>
                <th className="py-1">Name</th>
                <th className="py-1">County</th>
                <th className="py-1">Channel</th>
                <th className="py-1">Tiers</th>
                <th className="py-1">Tracking phone</th>
                <th className="py-1 text-right">Pieces</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="py-1.5 font-medium">{c.name}</td>
                  <td className="py-1.5">{c.county_key}</td>
                  <td className="py-1.5">{c.channel}</td>
                  <td className="py-1.5">{c.tier_filter.join(", ")}</td>
                  <td className="py-1.5 font-mono text-xs">
                    {c.tracking_phone}
                    {c.tracking_phone_is_mock && <span className="ml-1 font-sans text-caution">(mock)</span>}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{fmt.format(c.pieces)}</td>
                  <td className="py-1.5 text-right">
                    <a href={`/admin/campaigns/${c.id}/export`} className="text-accent hover:underline">
                      Print CSV
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
