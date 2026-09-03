import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/marketing/chrome";
import { Card, CardContent } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { enterDemoAction } from "./actions";
import { demoModeEnabled } from "@/config/demo";
import { brand } from "@/config/brand";

export const metadata = { title: "View the demo" };

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const enabled = demoModeEnabled();

  return (
    <>
      <SiteHeader />
      <main id="main" className="flex flex-1 items-center justify-center px-5 py-16">
        <div className="w-full max-w-lg">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            View the {brand.name} demo
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            A fixed sample organisation with five sources already measured, so you can see the whole
            flow without connecting anything.
          </p>

          <Card className="mt-6">
            <CardContent className="pt-6">
              <h2 className="text-sm font-semibold text-ink">What you will see</h2>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-muted">
                <li>A measured inventory across Dropbox, HubSpot, Microsoft 365, Slack and Google Workspace.</li>
                <li>
                  A source that comes back <strong className="text-ink">scope limited</strong>, because
                  Slack&rsquo;s rate limits make message volume impossible to measure.
                </li>
                <li>
                  Sources that come back <strong className="text-ink">rights review required</strong>,
                  because communications corpora always do.
                </li>
                <li>The questionnaire, the eligibility report, and where a rate does and does not appear.</li>
              </ul>

              <Notice tone="caution" className="mt-5" title="This is demo data">
                Every figure is from a fixed sample dataset. No provider account is connected and no
                OAuth authorization takes place. This application never simulates a successful
                connection to a real service.
              </Notice>

              {error === "not_seeded" ? (
                <Notice tone="negative" className="mt-4">
                  The demo organisation has not been seeded on this deployment. Run{" "}
                  <code className="font-mono">npm run db:seed</code> and try again.
                </Notice>
              ) : null}

              {enabled ? (
                <form action={enterDemoAction} className="mt-6">
                  <SubmitButton className="w-full" size="lg" pendingLabel="Loading the demo…">
                    Enter the demo
                  </SubmitButton>
                </form>
              ) : (
                <Notice tone="neutral" className="mt-6">
                  Demo mode is disabled on this deployment.
                </Notice>
              )}
            </CardContent>
          </Card>

          <p className="mt-6 text-center text-sm text-ink-muted">
            Want your own inventory?{" "}
            <Link href="/signup" className="font-medium text-accent hover:underline">
              Create an account
            </Link>
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
