import { Card, ReasonChip } from "@/components/ui";
import { apiJson, type QueueSummary } from "@/lib/api";
import { requireRole } from "@/lib/session";

import { claimNext, release } from "./actions";
import { CallPanel } from "./call-panel";

type Codes = { codes: string[]; roof_concerns: string[]; timelines: string[]; insurance: string[] };

export default async function AgentPage() {
  await requireRole("agent", "supervisor", "admin");
  const [q, codes] = await Promise.all([
    apiJson<QueueSummary>("/api/agent/queue"),
    apiJson<Codes>("/api/agent/dispositions"),
  ]);
  const item = q.claimed;
  const order = ["QUALIFIED", "CALLBACK", "NO_ANSWER", "VOICEMAIL_NO_MESSAGE", "NOT_INTERESTED", "NOT_HOMEOWNER",
    "ALREADY_HAS_CONTRACTOR", "LANGUAGE_BARRIER", "WRONG_NUMBER", "DNC_REQUESTED", "HOSTILE"];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Call queue</h1>
        {q.queues.map((x) => (
          <span key={x.queue} className="rounded border border-line bg-surface px-2 py-1 text-xs">
            {x.queue.replace("_", " ")}: <b>{x.ready_now}</b> ready, {x.scheduled} scheduled
          </span>
        ))}
      </div>

      {!item ? (
        <Card>
          <p className="mb-3 text-sm text-ink-muted">
            Only numbers that passed the compliance gate are in this queue. Each dial is checked again.
          </p>
          <form action={claimNext}>
            <button className="rounded bg-accent px-4 py-2 text-white hover:bg-accent-hover">Get next call</button>
          </form>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-5">
          <div className="space-y-4 md:col-span-2">
            <Card title="Homeowner">
              <div className="space-y-1 text-sm">
                <div className="text-base font-medium">
                  {[item.first_name, item.last_name].filter(Boolean).join(" ") || "Homeowner"}
                </div>
                <div className="font-mono">{item.phone_masked}</div>
                <div>{item.site_address ?? item.address}</div>
                <div className="text-ink-subtle">
                  {item.town} {item.zip} · {item.recipient_timezone ?? item.recipient_state}
                </div>
                <div className="text-xs text-ink-subtle">
                  {item.queue.replace("_", " ")} · {item.call_kind.replace("_", " ")}
                </div>
                {item.script.reason_codes.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {item.script.reason_codes.map((c) => <ReasonChip key={c} code={c} />)}
                  </div>
                )}
              </div>
            </Card>
            <Card title="Call">
              <CallPanel itemId={item.id} codes={order.filter((c) => codes.codes.includes(c))}
                concerns={codes.roof_concerns} timelines={codes.timelines} insurance={codes.insurance} />
              <form action={release} className="mt-4">
                <input type="hidden" name="item_id" value={item.id} />
                <button className="text-xs text-ink-subtle hover:underline">Put back in queue</button>
              </form>
            </Card>
          </div>
          <div className="md:col-span-3">
            <Card title="Script">
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{item.script.script}</pre>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
