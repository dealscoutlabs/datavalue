import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, requireOrganization, requireConnection } from "@/lib/org";
import { AppShell } from "@/components/dashboard/shell";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { disconnectAction } from "@/app/dashboard/actions";
import { providerLabel } from "@/lib/summary";

export const metadata = { title: "Disconnect a source" };

export default async function DisconnectPage({
  params,
}: {
  params: Promise<{ connectionId: string }>;
}) {
  const { connectionId } = await params;
  const user = await requireUser();
  const { organization } = await requireOrganization(user.id);

  const connection = await requireConnection(user.id, connectionId).catch(() => null);
  if (!connection || connection.status === "DISCONNECTED") notFound();

  return (
    <AppShell
      current="/sources"
      organizationName={organization.name}
      isDemo={organization.isDemo}
      isPlatformAdmin={user.isPlatformAdmin}
    >
      <div className="mx-auto max-w-lg">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Disconnect {providerLabel(connection.provider)}?
        </h1>
        <p className="mt-2 text-sm text-ink-muted">{connection.accountLabel}</p>

        <Card className="mt-6">
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-ink">This will:</p>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-muted">
              <li>Revoke the access credential at the provider, where the provider supports it.</li>
              <li>Delete the stored access and refresh tokens.</li>
              <li>Delete every scan checkpoint and provider cursor for this source.</li>
              <li>Delete the measured inventory and any indicative rate for this source.</li>
              <li>Recompute your organisation-wide eligibility without it.</li>
            </ul>
            <Notice tone="caution" className="mt-5">
              This cannot be undone. Reconnecting later starts a fresh scan from zero.
            </Notice>
          </CardContent>
          <CardFooter className="justify-end">
            <Button asChild variant="outline">
              <Link href="/dashboard">Cancel</Link>
            </Button>
            <form action={disconnectAction}>
              <input type="hidden" name="connectionId" value={connection.id} />
              <SubmitButton variant="danger" pendingLabel="Disconnecting…">
                Disconnect and delete
              </SubmitButton>
            </form>
          </CardFooter>
        </Card>
      </div>
    </AppShell>
  );
}
