import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/marketing/chrome";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Account deleted" };

export default function DeletedPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex flex-1 items-center justify-center px-5 py-20">
        <Card className="w-full max-w-lg">
          <CardContent className="py-12 text-center">
            <h1 className="text-xl font-semibold tracking-tight text-ink">Your account is deleted</h1>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-ink-muted">
              Your user record, organisation, provider connections, stored credentials, scan
              checkpoints, measurements, assessments and review requests have all been removed.
              Where a provider supported revocation, the credential was revoked there too.
            </p>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-ink-muted">
              You may also want to remove this application from your provider account settings
              directly, which is the only way to be certain on providers that do not offer a
              revocation endpoint.
            </p>
            <Button asChild className="mt-8" variant="outline">
              <Link href="/">Back to the homepage</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
      <SiteFooter />
    </>
  );
}
