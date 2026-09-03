import * as React from "react";
import { cn } from "@/lib/utils";

export function Fieldset({
  legend,
  hint,
  error,
  children,
  className,
}: {
  legend: string;
  hint?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cn("border-t border-line pt-5 first:border-0 first:pt-0", className)}>
      <legend className="sr-only">{legend}</legend>
      <p className="text-sm font-medium text-ink">{legend}</p>
      {hint ? <p className="mt-1 text-xs leading-relaxed text-ink-subtle">{hint}</p> : null}
      <div className="mt-3">{children}</div>
      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-negative">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

export function RadioRow({
  name,
  options,
  defaultValue,
}: {
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <label
          key={o.value}
          className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink hover:bg-ground has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent"
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            defaultChecked={defaultValue === o.value}
            className="size-4 accent-[#0f766e]"
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

export const TRI_OPTIONS = [
  { value: "YES", label: "Yes" },
  { value: "NO", label: "No" },
  { value: "UNSURE", label: "Not sure" },
];
