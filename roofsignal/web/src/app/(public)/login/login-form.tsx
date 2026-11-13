"use client";

import { useActionState } from "react";

import { login, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="space-y-3">
      <label className="block text-sm">
        <span className="text-ink-muted">Email</span>
        <input name="email" type="email" required autoComplete="username"
          className="mt-1 w-full rounded border border-line px-3 py-2" />
      </label>
      <label className="block text-sm">
        <span className="text-ink-muted">Password</span>
        <input name="password" type="password" required autoComplete="current-password"
          className="mt-1 w-full rounded border border-line px-3 py-2" />
      </label>
      {state.error && <p className="text-sm text-caution" role="alert">{state.error}</p>}
      <button disabled={pending} className="w-full rounded bg-accent px-3 py-2 text-white hover:bg-accent-hover disabled:opacity-60">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
