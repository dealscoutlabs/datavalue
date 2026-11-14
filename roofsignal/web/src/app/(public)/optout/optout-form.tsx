"use client";

import { useActionState } from "react";

import { submitOptOut, type OptOutState } from "../estimate-actions";

export function OptOutForm() {
  const [state, action, pending] = useActionState<OptOutState, FormData>(submitOptOut, {});
  if (state.done) {
    return <p role="status" className="rounded border border-line bg-surface p-4">Done. RoofSignal will not call or text this number again.</p>;
  }
  return (
    <form action={action} className="space-y-3">
      <label className="block text-sm">Phone number
        <input name="phone" type="tel" required className="mt-1 w-full rounded border border-line-strong px-3 py-2" />
      </label>
      {state.error && <p className="text-sm text-caution" role="alert">{state.error}</p>}
      <button disabled={pending} className="rounded bg-accent px-4 py-2 text-white hover:bg-accent-hover disabled:opacity-60">
        {pending ? "Saving…" : "Stop calls and texts"}
      </button>
    </form>
  );
}
