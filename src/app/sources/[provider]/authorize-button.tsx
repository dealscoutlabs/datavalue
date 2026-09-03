"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

/**
 * Starting an authorization is a POST, not a link. A GET would be CSRF-able and
 * would let a third-party page kick a signed-in user into a consent flow.
 */
export function AuthorizeButton({ provider, label }: { provider: string; label: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/connect/${provider}/start`, { method: "POST" });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        setError(body.error ?? "Could not start the authorization.");
        setPending(false);
        return;
      }
      window.location.href = body.url;
    } catch {
      setError("Could not reach the server. Try again.");
      setPending(false);
    }
  }

  return (
    <div className="w-full">
      <Button onClick={start} disabled={pending} aria-busy={pending}>
        {pending ? "Redirecting…" : `Authorize ${label}`}
      </Button>
      {error ? (
        <Notice tone="negative" className="mt-3">
          {error}
        </Notice>
      ) : null}
    </div>
  );
}
