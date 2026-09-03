import { requireOrganization, requireUser } from "@/lib/org";
import { AppShell } from "@/components/dashboard/shell";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { deleteAccountAction } from "@/app/dashboard/actions";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const { organization } = await requireOrganization(user.id);

  return (
    <AppShell
      current="/settings"
      organizationName={organization.name}
      isDemo={organization.isDemo}
      isPlatformAdmin={user.isPlatformAdmin}
    >
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Settings</h1>

        <Card className="mt-6">
          <CardContent className="pt-6">
            <h2 className="text-sm font-semibold text-ink">Account</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-subtle">Email</dt>
                <dd className="text-ink">{user.email}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-subtle">Organisation</dt>
                <dd className="text-ink">{organization.name}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card className="mt-6 border-negative-line">
          <CardContent className="pt-6">
            <h2 className="text-sm font-semibold text-negative">Delete everything</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              Deletes your account, your organisation, every provider connection and stored
              credential, every scan checkpoint and measurement, every eligibility assessment and any
              review request you submitted. Credentials are revoked at each provider where the
              provider supports revocation.
            </p>
            <Notice tone="negative" className="mt-4">
              This cannot be undone.
            </Notice>
          </CardContent>
          <CardFooter className="justify-end">
            <form action={deleteAccountAction}>
              <SubmitButton variant="danger" pendingLabel="Deleting…">
                Delete my account and all data
              </SubmitButton>
            </form>
          </CardFooter>
        </Card>
      </div>
    </AppShell>
  );
}
