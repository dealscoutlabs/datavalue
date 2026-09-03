import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrganization, requireUser } from "@/lib/org";
import { getAdapter } from "@/lib/connectors/registry";
import { parseProviderParam, redirectUriFor } from "@/lib/connectors/oauth";
import { AppShell } from "@/components/dashboard/shell";
import { Card, CardContent } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Button } from "@/components/ui/button";
import { AuthorizeButton } from "./authorize-button";
import { brand } from "@/config/brand";

export const dynamic = "force-dynamic";

/**
 * The permission-explanation screen. Mandatory: there is no route from anywhere
 * in the product to a provider consent page that skips this.
 */
export default async function ProviderPermissionPage({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const { provider: raw } = await params;
  const provider = parseProviderParam(raw);
  if (!provider) notFound();

  const user = await requireUser();
  const { organization } = await requireOrganization(user.id);
  const adapter = getAdapter(provider);

  return (
    <AppShell
      current="/sources"
      organizationName={organization.name}
      isDemo={organization.isDemo}
      isPlatformAdmin={user.isPlatformAdmin}
    >
      <div className="mx-auto max-w-2xl">
        <Link href="/sources" className="text-sm text-ink-muted hover:text-ink">
          ← All sources
        </Link>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink">
          Connect {adapter.label}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          Read this before you authorize. It describes exactly what the scan will and will not
          inspect.
        </p>

        {adapter.limitationNotice ? (
          <Notice tone="caution" className="mt-6" title="Known limitation">
            {adapter.limitationNotice}
          </Notice>
        ) : null}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Card>
            <CardContent className="pt-6">
              <h2 className="text-sm font-semibold text-ink">What we will read</h2>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-muted">
                {adapter.permissionExplainer.willRead.map((w) => (
                  <li key={w} className="flex gap-2">
                    <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <h2 className="text-sm font-semibold text-ink">What we will not read</h2>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-muted">
                {adapter.permissionExplainer.willNotRead.map((w) => (
                  <li key={w} className="flex gap-2">
                    <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-line-strong" />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <Card className="mt-4">
          <CardContent className="pt-6">
            <h2 className="text-sm font-semibold text-ink">
              Exact permissions requested, and why
            </h2>
            <dl className="mt-3 divide-y divide-line">
              {adapter.scopes.map((s) => (
                <div key={s.scope} className="py-3 first:pt-0 last:pb-0">
                  <dt className="font-mono text-xs text-ink">{s.scope}</dt>
                  <dd className="mt-1 text-sm leading-relaxed text-ink-muted">{s.why}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 border-t border-line pt-3 text-xs text-ink-subtle">
              Redirect URI for this deployment:{" "}
              <code className="break-all font-mono">{redirectUriFor(provider)}</code>
            </p>
          </CardContent>
        </Card>

        <Notice tone="neutral" className="mt-6">
          {brand.legal.connectionDisclosure}
        </Notice>

        {organization.isDemo ? (
          <Notice tone="caution" className="mt-4">
            This is a demo organisation, so it cannot authorize a real provider account. Add a demo
            source from the sources page instead.
          </Notice>
        ) : !adapter.isConfigured() ? (
          <Notice tone="caution" className="mt-4" title="Not configured on this deployment">
            No OAuth client credentials are set for {adapter.label}. See the README for the exact
            provider-console steps and the environment variables to fill in. Until then this source
            cannot be connected — and we are not going to show you a consent screen that would fail.
          </Notice>
        ) : (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <AuthorizeButton provider={provider.toLowerCase()} label={adapter.label} />
            <Button asChild variant="outline">
              <Link href="/sources">Cancel</Link>
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
