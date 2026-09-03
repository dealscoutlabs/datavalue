import { brand } from "@/config/brand";
import { formatCount, formatUnitRate } from "@/lib/utils";
import type { SourceView } from "@/lib/summary";

type Step = { key: string; label: string; value: number; explanation: string };
type Snapshot = {
  baseRate?: number;
  baseRateNote?: string;
  steps?: Step[];
  measuredQuantity?: { value: number; unit: string };
  formulaVersion?: string;
};

/**
 * The ONLY place a dollar figure is rendered in the product.
 *
 * Three rules this component enforces:
 *  1. It renders a PER-UNIT rate range, never a total. There is no multiplication
 *     of the rate by the measured quantity anywhere in this file — the quantity is
 *     shown beside the rate as context, deliberately not multiplied out.
 *  2. Every multiplier in the chain is shown with its own label and the reason it
 *     landed where it did.
 *  3. The disclosure sits directly with the number, in the same visual block, at
 *     readable size — not in a footer, not in grey 10px type.
 */
export function RateChain({ rate }: { rate: NonNullable<SourceView["rate"]> }) {
  const snapshot = (rate.inputSnapshot ?? {}) as Snapshot;
  const steps = snapshot.steps ?? [];

  return (
    <section
      aria-labelledby={`rate-heading-${rate.unitLabel.replace(/\s+/g, "-")}`}
      className="mt-5 rounded-md border border-line bg-surface"
    >
      <div className="border-b border-line px-4 py-3">
        <h4
          id={`rate-heading-${rate.unitLabel.replace(/\s+/g, "-")}`}
          className="text-xs font-semibold uppercase tracking-wide text-ink-subtle"
        >
          Indicative reference rate
        </h4>
        <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">
          {formatUnitRate(rate.lowRate, rate.unitType)} – {formatUnitRate(rate.highRate, rate.unitType)}{" "}
          <span className="text-base font-normal text-ink-muted">{rate.unitLabel}</span>
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          Midpoint {formatUnitRate(rate.midRate, rate.unitType)} {rate.unitLabel}
          {snapshot.measuredQuantity ? (
            <>
              {" · "}
              applies to {formatCount(snapshot.measuredQuantity.value)}{" "}
              {snapshot.measuredQuantity.unit} measured in this source
            </>
          ) : null}
        </p>
      </div>

      <div className="px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          How the midpoint was calculated
        </p>
        <ol className="mt-3 space-y-2.5">
          <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pb-2.5">
            <span className="text-sm font-medium text-ink">Base rate</span>
            <span className="tabular-nums text-sm text-ink">
              {snapshot.baseRate != null ? formatUnitRate(snapshot.baseRate, rate.unitType) : "—"}
            </span>
            <span className="w-full text-xs leading-relaxed text-ink-subtle">
              {snapshot.baseRateNote}
            </span>
          </li>
          {steps.map((s) => (
            <li
              key={s.key}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pb-2.5 last:border-0"
            >
              <span className="text-sm font-medium text-ink">{s.label}</span>
              <span className="tabular-nums text-sm text-ink">× {s.value}</span>
              <span className="w-full text-xs leading-relaxed text-ink-subtle">{s.explanation}</span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-ink-subtle">
          Low and high are 0.6× and 1.6× the midpoint. Formula version{" "}
          {snapshot.formulaVersion ?? "—"}. This calculation is frozen: editing a reference rate
          later will not change the numbers above.
        </p>
      </div>

      <div className="border-t border-line bg-ground px-4 py-3">
        <p className="text-sm leading-relaxed text-ink-muted">{brand.legal.rateDisclosure}</p>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          No offer is being made. This figure is not summed with any other source, because a
          portfolio total would imply both a right to license and a buyer at that price, and neither
          has been established.
        </p>
      </div>
    </section>
  );
}
