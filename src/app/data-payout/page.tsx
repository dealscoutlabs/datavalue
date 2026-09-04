import { SiteFooter, SiteHeader } from "@/components/marketing/chrome";
import { DataPayoutCalculator } from "./calculator";

export const metadata = {
  title: "Data payout estimator",
  description: "Estimate what a business data corpus of your size could be worth.",
};

export default function DataPayoutPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <div className="mx-auto max-w-5xl px-5 py-16">
          <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            What could your company data be worth?
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-muted">
            Answer three questions for an indicative annual range.
          </p>

          <div className="mt-10">
            <DataPayoutCalculator />
          </div>

          <div className="mt-14 max-w-2xl border-t border-line pt-8">
            <h2 className="text-lg font-semibold tracking-tight text-ink">
              Want the real number instead of an estimate?
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              This page estimates from company size. A data inventory measures what you actually
              hold — volume, record counts, category mix and date range, read from your own systems
              with metadata-only access — and screens whether it could plausibly be licensed at all.
              That is the part a number on its own cannot tell you.
            </p>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
