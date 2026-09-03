import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

/** Byte formatter used for every volume figure in the product. */
export function formatBytes(bytes: number | bigint, dp = 1): string {
  const n = typeof bytes === "bigint" ? Number(bytes) : bytes;
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const value = n / 1024 ** i;
  return `${value.toFixed(i === 0 ? 0 : dp)} ${UNITS[i]}`;
}

export function formatCount(n: number | bigint): string {
  const v = typeof n === "bigint" ? Number(n) : n;
  if (!Number.isFinite(v)) return "0";
  return Math.round(v).toLocaleString("en-US");
}

/**
 * Currency formatter for PER-UNIT RATES ONLY.
 *
 * There is no portfolio-total formatter in this codebase, and there must not be.
 * Every call site of this function renders a rate with its unit label attached.
 */
export function formatUnitRate(value: number, unitType: "UNSTRUCTURED_BYTES" | "STRUCTURED_RECORDS"): string {
  const dp = unitType === "STRUCTURED_RECORDS" ? (value < 1 ? 3 : 2) : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  }).format(value);
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateRange(
  from: Date | string | null | undefined,
  to: Date | string | null | undefined
): string {
  if (!from && !to) return "Not measured";
  return `${formatDate(from)} – ${formatDate(to)}`;
}

export function formatRelative(d: Date | string | null | undefined): string {
  if (!d) return "never";
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return formatDate(date);
}
