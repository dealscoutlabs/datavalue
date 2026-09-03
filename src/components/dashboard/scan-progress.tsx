"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Progress } from "@/components/ui/progress";
import { Notice } from "@/components/ui/notice";

type Advance = {
  status: string;
  progressPct: number;
  progressLabel: string;
  done: boolean;
  error?: string;
  retryAfterMs?: number;
};

/**
 * Drives a database-backed scan job by issuing bounded continuation requests.
 * Each request does a small amount of provider work and checkpoints, so closing
 * the tab pauses the scan rather than losing it — reopening the dashboard picks
 * up from the last checkpoint.
 */
export function ScanProgress({
  scanJobId,
  initialPct,
  initialLabel,
}: {
  scanJobId: string;
  initialPct: number;
  initialLabel: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<Advance>({
    status: "RUNNING",
    progressPct: initialPct,
    progressLabel: initialLabel,
    done: false,
  });
  const cancelled = useRef(false);

  const advance = useCallback(async (): Promise<Advance | null> => {
    const res = await fetch(`/api/scans/${scanJobId}/advance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      return {
        status: "FAILED",
        progressPct: 0,
        progressLabel: "Scan stopped",
        done: true,
        error: "The scan could not be continued. Try again from the source card.",
      };
    }
    return (await res.json()) as Advance;
  }, [scanJobId]);

  useEffect(() => {
    cancelled.current = false;

    (async () => {
      // Hard cap on continuations so a misbehaving provider cannot spin forever.
      for (let i = 0; i < 400 && !cancelled.current; i++) {
        const next = await advance();
        if (!next || cancelled.current) return;
        setState(next);
        if (next.done) {
          router.refresh();
          return;
        }
        await new Promise((r) => setTimeout(r, next.retryAfterMs ?? 700));
      }
    })();

    return () => {
      cancelled.current = true;
    };
  }, [advance, router]);

  return (
    <div className="mt-4">
      <Progress value={state.progressPct} label={state.progressLabel} />
      {state.status === "RATE_LIMITED" ? (
        <Notice tone="caution" className="mt-3">
          The provider is rate limiting this scan. It will continue automatically — nothing measured
          so far has been lost.
        </Notice>
      ) : null}
      {state.error ? (
        <Notice tone="negative" className="mt-3">
          {state.error}
        </Notice>
      ) : null}
    </div>
  );
}
