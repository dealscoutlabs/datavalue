import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The standard disclosure block. Used for every legal, framing and limitation
 * statement in the product so that none of them reads as fine print.
 */
export function Notice({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "caution" | "negative" | "neutral";
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const tones = {
    info: "border-info-line bg-info-soft text-info",
    caution: "border-caution-line bg-caution-soft text-caution",
    negative: "border-negative-line bg-negative-soft text-negative",
    neutral: "border-line bg-ground text-ink-muted",
  } as const;
  return (
    <div className={cn("rounded-md border px-4 py-3 text-sm leading-relaxed", tones[tone], className)}>
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      <div className="[&_p+p]:mt-2">{children}</div>
    </div>
  );
}
