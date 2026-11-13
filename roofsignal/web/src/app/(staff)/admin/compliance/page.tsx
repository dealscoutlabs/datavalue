import { Card } from "@/components/ui";
import { apiJson, type DecisionRow } from "@/lib/api";
import { requireRole } from "@/lib/session";

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function ComplianceLog(props: PageProps<"/admin/compliance">) {
  await requireRole("admin", "supervisor");
  const sp = await props.searchParams;
  const phone = one(sp.phone);
  const outcome = one(sp.outcome);
  const rows = await apiJson<DecisionRow[]>("/api/compliance/decisions", {
    e164: phone,
    allowed: outcome === "allowed" ? "true" : outcome === "blocked" ? "false" : undefined,
    limit: "200",
  });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Compliance decision log</h1>
      <p className="text-sm text-ink-muted">
        Every queue insert and every dial is evaluated by the compliance gate and logged here with each check&apos;s
        result. This log cannot be edited or deleted.
      </p>
      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-subtle">Phone</span>
            <input name="phone" defaultValue={phone ?? ""} className="w-44 rounded border border-line px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-subtle">Outcome</span>
            <select name="outcome" defaultValue={outcome ?? ""} className="rounded border border-line px-2 py-1">
              <option value="">Any</option>
              <option value="allowed">Allowed</option>
              <option value="blocked">Blocked</option>
            </select>
          </label>
          <button className="rounded bg-accent px-3 py-1.5 text-white hover:bg-accent-hover">Filter</button>
        </form>
      </Card>
      <div className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-ink-subtle">No decisions match.</p>}
        {rows.map((d) => (
          <details key={d.id} className="rounded-lg border border-line bg-surface p-3 text-sm">
            <summary className="flex cursor-pointer flex-wrap items-center gap-3">
              <span
                className={`rounded px-2 py-0.5 text-xs font-semibold ${
                  d.allowed ? "bg-tier-a-soft text-tier-a" : "bg-caution-soft text-caution"
                }`}
              >
                {d.allowed ? "ALLOW" : "BLOCK"}
              </span>
              <span className="font-mono text-xs">{d.e164}</span>
              <span className="text-ink-muted">
                {d.purpose} · {d.call_kind}
              </span>
              <span className="text-xs text-ink-subtle">{new Date(d.evaluated_at).toLocaleString()}</span>
              {d.block_reasons.length > 0 && (
                <span className="font-mono text-xs text-caution">{d.block_reasons.join(", ")}</span>
              )}
              {d.allow_mock_data && <span className="text-xs text-ink-subtle">(mock data allowed: telephony mocked)</span>}
            </summary>
            <table className="mt-3 w-full text-xs">
              <tbody>
                {d.checks.map((c) => (
                  <tr key={c.check} className="border-t border-line">
                    <td className="py-1 pr-2">{c.check}</td>
                    <td className="py-1 pr-2 uppercase">{c.status}</td>
                    <td className="py-1 pr-2 font-mono">{c.reason_code}</td>
                    <td className="py-1 text-ink-subtle">{c.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-ink-subtle">
              rules {d.ruleset_version} · zones {d.recipient_timezones.join(", ")} · actor {d.actor}
            </p>
          </details>
        ))}
      </div>
    </div>
  );
}
