import Link from "next/link";
import { requireOrganization, requireUser } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { catalog, COMING_SOON } from "@/lib/connectors/registry";
import { AppShell } from "@/components/dashboard/shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { addDemoSourceAction } from "./actions";
import { brand } from "@/config/brand";

export const metadata = { title: "Data sources" };
export const dynamic = "force-dynamic";

const ERROR_COPY: Record<string, string> = {
  denied:
    "You declined the authorization at the provider, so nothing was connected and no data was read.",
  invalid_state:
    "That authorization link could not be verified, so it was rejected. This usually means the link was reused, expired, or was started in a different browser session. Start again from this page.",
  signed_out:
    "Your session ended before the authorization finished. Sign in and start again — nothing was connected.",
  missing_code: "The provider did not return an authorization code. Nothing was connected.",
  exchange_failed:
    "The provider rejected the authorization exchange. Nothing was connected and no data was read.",
  provider_error: "The provider reported an error during authorization. Nothing was connected.",
  unknown_provider: "That source is not supported.",
};

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; provider?: string }>;
}) {
  const params = await searchParams;
  const user = await requireUser();
  const { organization } = await requireOrganization(user.id);
  const entries = catalog();

  const connections = await prisma.providerConnection.findMany({
    where: { organizationId: organization.id, status: { not: "DISCONNECTED" } },
    select: { provider: true },
  });
  const connected = new Set(connections.map((c) => c.provider));

  return (
    <AppShell
      current="/sources"
      organizationName={organization.name}
      isDemo={organization.isDemo}
      isPlatformAdmin={user.isPlatformAdmin}
    >
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Data sources</h1>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
        Every source below is read-only and metadata-only. You will see exactly which permissions are
        requested, and what each one does and does not allow, before you authorize anything.
      </p>

      {params.error ? (
        <Notice tone={params.error === "denied" ? "caution" : "negative"} className="mt-6">
          {ERROR_COPY[params.error] ?? "Something went wrong. Nothing was connected."}
        </Notice>
      ) : null}

      {organization.isDemo ? (
        <Notice tone="caution" className="mt-6" title="Demo organisation">
          This organisation uses fixed sample data. Adding a source here loads a demo fixture — it
          does not open a provider authorization screen and does not connect a real account. This
          application never simulates a successful OAuth connection.
        </Notice>
      ) : null}

      <ul className="mt-6 grid gap-4 md:grid-cols-2">
        {entries.map((c) => {
          const isConnected = connected.has(c.provider);
          return (
            <li key={c.provider}>
              <Card className="h-full">
                <CardContent className="flex h-full flex-col pt-6">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-base font-semibold text-ink">{c.label}</h2>
                    <div className="flex flex-wrap justify-end gap-2">
                      {isConnected ? <Badge tone="positive">Connected</Badge> : null}
                      {!c.liveCapable ? <Badge tone="caution">Demo only</Badge> : null}
                      {c.liveCapable && !c.configured && !organization.isDemo ? (
                        <Badge tone="neutral">Not configured</Badge>
                      ) : null}
                    </div>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-ink-muted">{c.description}</p>

                  {c.limitationNotice ? (
                    <p className="mt-3 rounded-md border border-caution-line bg-caution-soft px-3 py-2 text-xs leading-relaxed text-caution">
                      {c.limitationNotice}
                    </p>
                  ) : null}

                  <div className="mt-auto flex flex-wrap gap-2 pt-5">
                    {organization.isDemo ? (
                      <form action={addDemoSourceAction}>
                        <input type="hidden" name="provider" value={c.provider} />
                        <SubmitButton size="sm" pendingLabel="Adding…">
                          {isConnected ? "Reload demo data" : "Add demo source"}
                        </SubmitButton>
                      </form>
                    ) : (
                      <Button asChild size="sm" variant={isConnected ? "outline" : "default"}>
                        <Link href={`/sources/${c.provider.toLowerCase()}`}>
                          {isConnected ? "Review permissions" : "Connect"}
                        </Link>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      <section className="mt-10">
        <h2 className="text-base font-semibold tracking-tight text-ink">Coming soon</h2>
        <p className="mt-1 text-sm text-ink-muted">
          These are not built yet. They are listed so you know what is planned, and they are disabled
          rather than dressed up as working.
        </p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {COMING_SOON.map((c) => (
            <li key={c.key}>
              <button
                type="button"
                disabled
                aria-disabled="true"
                className="cursor-not-allowed rounded-md border border-dashed border-line bg-ground px-3 py-2 text-xs text-ink-subtle"
              >
                {c.label}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-10 text-xs leading-relaxed text-ink-subtle">
        {brand.legal.connectionDisclosure}
      </p>
    </AppShell>
  );
}
