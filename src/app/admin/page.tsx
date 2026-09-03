import { requireOrganization, requirePlatformAdmin } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/dashboard/shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { Input, Label, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { updateLeadStatusAction, updateRateAction } from "./actions";
import { FORMULA_DESCRIPTION } from "@/lib/valuation/seed-rates";
import { providerLabel } from "@/lib/summary";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // Redirects non-admins. The check is server side and does not rely on the nav.
  const user = await requirePlatformAdmin();
  const { organization } = await requireOrganization(user.id);

  const [formula, rates, leads] = await Promise.all([
    prisma.valuationFormulaVersion.findFirst({ where: { isActive: true } }),
    prisma.valuationRate.findMany({ orderBy: [{ unitType: "asc" }, { provider: "asc" }] }),
    prisma.offerRequest.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  return (
    <AppShell
      current="/admin"
      organizationName={organization.name}
      isDemo={organization.isDemo}
      isPlatformAdmin
    >
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Admin</h1>

      <section className="mt-8">
        <h2 className="text-lg font-semibold tracking-tight text-ink">Reference rates</h2>
        <Notice tone="caution" className="mt-3" title="These are illustrative reference points">
          <p>
            Every value below is a reference point, not a market quote and not an offer. Each one
            carries a note explaining where it came from, and that note is what makes the number
            defensible if a customer asks. Do not set a value you could not explain.
          </p>
          <p>
            Editing a rate here changes future calculations only. Results a customer has already
            seen are frozen with the inputs that produced them and are never rewritten.
          </p>
        </Notice>
        <p className="mt-3 text-sm text-ink-muted">
          Active formula: <span className="font-medium text-ink">{formula?.version ?? "none"}</span>{" "}
          — {FORMULA_DESCRIPTION}
        </p>

        <div className="mt-4 space-y-4">
          {rates.map((r) => (
            <Card key={r.id}>
              <CardContent className="pt-5">
                <form action={updateRateAction} className="space-y-3">
                  <input type="hidden" name="rateId" value={r.id} />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-ink">{providerLabel(r.provider)}</h3>
                    <Badge tone="neutral">
                      {r.unitType === "STRUCTURED_RECORDS" ? "per usable record" : "per GB"}
                    </Badge>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[10rem_1fr] sm:items-start">
                    <div>
                      <Label htmlFor={`rate-${r.id}`}>Base rate (USD)</Label>
                      <Input
                        id={`rate-${r.id}`}
                        name="baseRate"
                        type="number"
                        step="0.001"
                        min="0"
                        defaultValue={r.baseRate}
                        className="mt-1.5"
                      />
                    </div>
                    <div>
                      <Label htmlFor={`note-${r.id}`}>Where this number came from</Label>
                      <textarea
                        id={`note-${r.id}`}
                        name="sourceNote"
                        rows={4}
                        defaultValue={r.sourceNote}
                        className="mt-1.5 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm leading-relaxed text-ink"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">
                      Save
                    </SubmitButton>
                  </div>
                </form>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold tracking-tight text-ink">
          Verified-review requests ({leads.length})
        </h2>
        {leads.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">No requests yet.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {leads.map((l) => {
              const eligibility = l.eligibilitySummary as { status?: string } | null;
              return (
                <Card key={l.id}>
                  <CardContent className="pt-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-ink">{l.companyName}</h3>
                        <p className="mt-0.5 text-sm text-ink-muted">
                          {l.contactName} · {l.contactRole} · {l.businessEmail}
                          {l.phone ? ` · ${l.phone}` : ""}
                        </p>
                        <p className="mt-1 text-xs text-ink-subtle">
                          {l.industry} · {l.employeeRange} employees · {formatDate(l.createdAt)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={eligibility?.status === "LIKELY_ELIGIBLE" ? "positive" : "caution"}>
                          {eligibility?.status ?? "UNKNOWN"}
                        </Badge>
                        <Badge tone={l.notifiedAt ? "positive" : "caution"}>
                          {l.notifiedAt ? "Notified" : "Not emailed"}
                        </Badge>
                      </div>
                    </div>

                    {!l.notifiedAt && l.notifyError ? (
                      <p className="mt-3 rounded-md border border-caution-line bg-caution-soft px-3 py-2 text-xs text-caution">
                        Email was not sent: {l.notifyError} The lead is safe here regardless.
                      </p>
                    ) : null}

                    <form action={updateLeadStatusAction} className="mt-4 flex items-end gap-2">
                      <input type="hidden" name="leadId" value={l.id} />
                      <div className="w-40">
                        <Label htmlFor={`status-${l.id}`}>Status</Label>
                        <Select id={`status-${l.id}`} name="status" defaultValue={l.status} className="mt-1.5">
                          <option value="NEW">New</option>
                          <option value="CONTACTED">Contacted</option>
                          <option value="CLOSED">Closed</option>
                        </Select>
                      </div>
                      <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">
                        Update
                      </SubmitButton>
                    </form>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </AppShell>
  );
}
