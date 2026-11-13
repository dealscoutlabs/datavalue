"use client";

import { useActionState } from "react";

import { submitEstimate, type EstimateState } from "./estimate-actions";

type Props = {
  disclosure: { version: string; text: string; sha256: string };
  trackingCode: string | null;
  trackingPhone: string | null;
  pageUrl: string;
};

const field = "mt-1 w-full rounded border border-line-strong px-3 py-2";

export function EstimateForm({ disclosure, trackingCode, trackingPhone, pageUrl }: Props) {
  const [state, action, pending] = useActionState<EstimateState, FormData>(submitEstimate, {});

  if (state.done) {
    return (
      <div className="rounded-lg border border-line bg-surface p-6" role="status">
        <h2 className="text-lg font-semibold">Thank you, we got your request.</h2>
        <p className="mt-2 text-ink-muted">
          {state.willCall
            ? "A RoofSignal specialist will call you to confirm a few details and connect you with a licensed local contractor."
            : `We received your request.${trackingPhone ? ` To talk with us now, call ${formatPhone(trackingPhone)}.` : ""}`}
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-lg border border-line bg-surface p-5">
      <input type="hidden" name="disclosure_version" value={disclosure.version} />
      <input type="hidden" name="disclosure_sha256" value={disclosure.sha256} />
      <input type="hidden" name="tracking_code" value={trackingCode ?? ""} />
      <input type="hidden" name="page_url" value={pageUrl} />
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">First name<input name="first_name" required autoComplete="given-name" className={field} /></label>
        <label className="text-sm">Last name<input name="last_name" required autoComplete="family-name" className={field} /></label>
      </div>
      <label className="block text-sm">Mobile or home phone
        <input name="phone" type="tel" required autoComplete="tel" inputMode="tel" className={field} />
      </label>
      <label className="block text-sm">Email (optional)<input name="email" type="email" autoComplete="email" className={field} /></label>
      <label className="block text-sm">Street address<input name="address" required autoComplete="street-address" className={field} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">ZIP<input name="zip" required pattern="\d{5}" inputMode="numeric" autoComplete="postal-code" className={field} /></label>
        <label className="text-sm">State<input name="state" required maxLength={2} autoComplete="address-level1" placeholder="NY" className={field} /></label>
      </div>
      <label className="flex items-start gap-3 rounded border border-line bg-ground p-3 text-xs leading-relaxed text-ink-muted">
        <input type="checkbox" name="consent" className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{disclosure.text}</span>
      </label>
      {state.error && <p className="text-sm text-caution" role="alert">{state.error}</p>}
      <button disabled={pending} className="w-full rounded bg-accent px-4 py-3 font-medium text-white hover:bg-accent-hover disabled:opacity-60">
        {pending ? "Sending…" : "Get my free estimate"}
      </button>
      <p className="text-center text-xs text-ink-subtle">
        Checking the box is optional and not required to buy anything.{trackingPhone ? ` You can also call ${formatPhone(trackingPhone)}.` : ""}
      </p>
    </form>
  );
}

function formatPhone(e164: string) {
  const d = e164.replace(/^\+1/, "");
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
