import type { ReactNode } from "react";

const TIER_STYLES: Record<string, string> = {
  A: "bg-tier-a-soft text-tier-a",
  B: "bg-tier-b-soft text-tier-b",
  C: "bg-tier-c-soft text-tier-c",
  D: "bg-tier-d-soft text-tier-d",
};

export function TierBadge({ tier }: { tier: string }) {
  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded text-xs font-semibold ${TIER_STYLES[tier] ?? TIER_STYLES.D}`}
      aria-label={`Tier ${tier}`}
    >
      {tier}
    </span>
  );
}

export function ReasonChip({ code, label, internal }: { code: string; label?: string; internal?: boolean }) {
  return (
    <span
      title={label ?? code}
      className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[11px] ${
        internal ? "border-dashed border-line-strong text-ink-subtle" : "border-line bg-ground text-ink-muted"
      }`}
    >
      {code}
    </span>
  );
}

export function Card({ title, children, aside }: { title?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      {(title || aside) && (
        <div className="mb-3 flex items-baseline justify-between gap-4">
          {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div>
      <div className="text-xs text-ink-subtle">{label}</div>
      <div className="text-xl font-semibold tabular-nums text-ink">{value}</div>
      {hint && <div className="text-xs text-ink-subtle">{hint}</div>}
    </div>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-caution-line bg-caution-soft p-3 text-sm text-caution">{children}</div>
  );
}

export const fmt = new Intl.NumberFormat("en-US");
