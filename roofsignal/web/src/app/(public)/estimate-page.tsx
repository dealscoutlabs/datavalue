import { headers } from "next/headers";

import { apiFetch, type Landing } from "@/lib/api";

import { EstimateForm } from "./estimate-form";

export async function EstimatePage({ code }: { code?: string }) {
  // Read request headers first: this page is per-request (it logs the visit and needs the visitor's IP).
  const h = await headers();
  const landing = (await (await apiFetch("/public/landing", { auth: false, params: { code } })).json()) as Landing;
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const pageUrl = `${proto}://${host}${landing.code ? `/r/${landing.code}` : "/get-estimate"}`;
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Free roof estimate from a licensed local contractor</h1>
      {landing.trigger_text && <p className="mt-3 text-ink-muted">{landing.trigger_text}</p>}
      <p className="mt-3 text-ink-muted">
        Tell us how to reach you. We&apos;ll confirm a few details and connect you with one licensed, insured contractor
        in your area. There&apos;s no cost to you for the estimate.
      </p>
      <div className="mt-6">
        <EstimateForm disclosure={landing.disclosure} trackingCode={landing.code} trackingPhone={landing.tracking_phone}
          pageUrl={pageUrl} />
      </div>
    </main>
  );
}
