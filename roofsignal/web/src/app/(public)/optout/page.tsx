import type { Metadata } from "next";

import { OptOutForm } from "./optout-form";

export const metadata: Metadata = { title: "Stop calls and texts · RoofSignal" };

export default function OptOutPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <h1 className="mb-2 text-xl font-semibold">Stop calls and texts</h1>
      <p className="mb-6 text-sm text-ink-muted">
        Enter your number and we will stop contacting you. This takes effect immediately for RoofSignal.
      </p>
      <OptOutForm />
    </main>
  );
}
