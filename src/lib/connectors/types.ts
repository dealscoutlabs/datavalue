/**
 * The connector contract.
 *
 * Every provider returns the SAME normalized shape so that no provider-specific
 * logic leaks into the dashboard, the eligibility engine, or the rate engine.
 * A connector may only ever return counts, byte sizes, category buckets,
 * timestamps and aggregate statistics — never file names, message bodies,
 * subjects, headers, contact records, or any other customer content.
 */
import { z } from "zod";
import type { ConfidenceTier, DataUnitType, ProviderKey } from "@/generated/prisma";

/** Broad, content-free buckets. Derived from extension/MIME only. */
export const CATEGORY_KEYS = [
  "documents",
  "spreadsheets",
  "presentations",
  "images",
  "audio",
  "video",
  "code",
  "archives",
  "email",
  "chat",
  "records",
  "other",
] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  documents: "Documents",
  spreadsheets: "Spreadsheets",
  presentations: "Presentations",
  images: "Images",
  audio: "Audio",
  video: "Video",
  code: "Code",
  archives: "Archives",
  email: "Email",
  chat: "Chat",
  records: "Structured records",
  other: "Other",
};

export const categoryBucketSchema = z.object({
  bytes: z.number().nonnegative(),
  count: z.number().nonnegative(),
});
export type CategoryBucket = z.infer<typeof categoryBucketSchema>;

export const recordBreakdownEntrySchema = z.object({
  objectType: z.string(),
  count: z.number().nonnegative(),
  /** 0-100. Share of sampled records with the core fields populated. */
  fieldCompletenessPct: z.number().min(0).max(100).nullable(),
});

/** The one shape the whole application consumes. */
export const normalizedMetricsSchema = z.object({
  unitType: z.enum(["UNSTRUCTURED_BYTES", "STRUCTURED_RECORDS"]),
  totalBytes: z.number().nonnegative(),
  totalRecords: z.number().nonnegative(),
  totalFiles: z.number().nonnegative(),
  categoryMix: z.record(z.string(), categoryBucketSchema),
  recordBreakdown: z.array(recordBreakdownEntrySchema).default([]),
  oldestItemAt: z.string().datetime().nullable(),
  newestItemAt: z.string().datetime().nullable(),
  confidence: z.enum(["EXACT", "DERIVED", "SAMPLED", "SCOPE_LIMITED"]),
  /** Plain-language description of how the figure was obtained. Shown in the UI. */
  method: z.string().min(1),
  /** Honest caveats rendered verbatim next to the figure. */
  caveats: z.array(z.string()).default([]),
  scopeLimited: z.boolean().default(false),
});
export type NormalizedMetrics = z.infer<typeof normalizedMetricsSchema>;

export function emptyMetrics(
  unitType: DataUnitType,
  method: string,
  confidence: ConfidenceTier = "DERIVED"
): NormalizedMetrics {
  return {
    unitType,
    totalBytes: 0,
    totalRecords: 0,
    totalFiles: 0,
    categoryMix: {},
    recordBreakdown: [],
    oldestItemAt: null,
    newestItemAt: null,
    confidence,
    method,
    caveats: [],
    scopeLimited: false,
  };
}

// ---------------------------------------------------------------- adapter

export type OAuthTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string | null;
  accountLabel: string | null;
  accountDomain: string | null;
  externalId: string | null;
  /** Which scan path the granted scopes permit (e.g. "admin" | "delegated"). */
  scanPath?: string | null;
};

/** Opaque, provider-owned pagination state. Persisted in ScanCheckpoint. */
export type ScanCursorState = Record<
  string,
  { cursor: string | null; completed: boolean; pageCount: number; sampling?: Record<string, unknown> }
>;

export type ScanPageInput = {
  accessToken: string;
  /** Cursor state as loaded from ScanCheckpoint rows. */
  state: ScanCursorState;
  /** Accumulated partial totals from previous pages. */
  partial: NormalizedMetrics;
  scanPath?: string | null;
};

export type ScanPageResult = {
  state: ScanCursorState;
  partial: NormalizedMetrics;
  /** False when every stream is complete. */
  hasMore: boolean;
  itemsSeen: number;
  progressPct: number;
  progressLabel: string;
  /** Set when the provider asked us to wait (429 / Retry-After). */
  retryAfterMs?: number;
};

export interface ConnectorAdapter {
  key: ProviderKey;
  label: string;
  /** Marketing blurb for the catalog card. */
  description: string;
  unitType: DataUnitType;
  /** Exact scopes requested, each with a plain-English reason shown pre-OAuth. */
  scopes: { scope: string; why: string }[];
  /** What the scan reads and, explicitly, what it does not. */
  permissionExplainer: { willRead: string[]; willNotRead: string[] };
  /** True when the connector can be used against a live provider in this build. */
  liveCapable: boolean;
  /** Non-empty when the connector ships with a structural limitation. */
  limitationNotice?: string;
  isConfigured(): boolean;

  getAuthorizationUrl(args: {
    state: string;
    codeChallenge?: string;
    redirectUri: string;
  }): string;

  exchangeCode(args: {
    code: string;
    codeVerifier?: string;
    redirectUri: string;
  }): Promise<OAuthTokens>;

  refreshToken(args: { refreshToken: string }): Promise<OAuthTokens>;

  scanPage(input: ScanPageInput): Promise<ScanPageResult>;

  /** Normalisation + final caveats. Runs once when all streams complete. */
  normalizeMetrics(partial: NormalizedMetrics): NormalizedMetrics;

  /** Revoke at the provider where supported. Must not throw on best-effort failure. */
  disconnect(args: { accessToken: string | null }): Promise<void>;
}

// ---------------------------------------------------------------- helpers

const EXTENSION_CATEGORIES: Record<string, CategoryKey> = {};
function reg(cat: CategoryKey, exts: string[]) {
  for (const e of exts) EXTENSION_CATEGORIES[e] = cat;
}
reg("documents", ["pdf", "doc", "docx", "odt", "rtf", "txt", "md", "pages", "tex", "epub"]);
reg("spreadsheets", ["xls", "xlsx", "csv", "tsv", "ods", "numbers", "parquet"]);
reg("presentations", ["ppt", "pptx", "odp", "key"]);
reg("images", ["jpg", "jpeg", "png", "gif", "bmp", "tiff", "tif", "svg", "webp", "heic", "raw", "psd", "ai"]);
reg("audio", ["mp3", "wav", "aac", "flac", "m4a", "ogg", "aiff"]);
reg("video", ["mp4", "mov", "avi", "mkv", "wmv", "webm", "m4v", "mpg", "mpeg"]);
reg("code", ["js", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java", "c", "h", "cpp", "cs", "php", "sql", "json", "xml", "yml", "yaml", "sh", "html", "css"]);
reg("archives", ["zip", "rar", "7z", "tar", "gz", "bz2", "dmg", "iso"]);
reg("email", ["eml", "msg", "pst", "mbox"]);

/**
 * Bucket a file by extension. Takes only the extension, never the file name —
 * callers must not pass full paths into persisted metrics.
 */
export function categoryForExtension(ext: string | null | undefined): CategoryKey {
  if (!ext) return "other";
  return EXTENSION_CATEGORIES[ext.toLowerCase().replace(/^\./, "")] ?? "other";
}

export function extensionOf(name: string): string | null {
  const idx = name.lastIndexOf(".");
  if (idx <= 0 || idx === name.length - 1) return null;
  const ext = name.slice(idx + 1);
  return /^[A-Za-z0-9]{1,10}$/.test(ext) ? ext.toLowerCase() : null;
}

export function addToCategory(
  mix: Record<string, CategoryBucket>,
  key: CategoryKey,
  bytes: number,
  count = 1
) {
  const cur = mix[key] ?? { bytes: 0, count: 0 };
  mix[key] = { bytes: cur.bytes + Math.max(0, bytes), count: cur.count + count };
}

/** Widen an accumulating [oldest, newest] window with an ISO timestamp. */
export function widenDateRange(
  partial: NormalizedMetrics,
  iso: string | null | undefined
) {
  if (!iso) return;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return;
  const d = new Date(t).toISOString();
  if (!partial.oldestItemAt || d < partial.oldestItemAt) partial.oldestItemAt = d;
  if (!partial.newestItemAt || d > partial.newestItemAt) partial.newestItemAt = d;
}

/**
 * Bounded progress for providers that cannot report a total. Never reaches 100
 * until the stream actually completes, and never fabricates a denominator.
 */
export function boundedProgress(pagesDone: number, done: boolean): number {
  if (done) return 100;
  return Math.min(95, Math.round(100 * (1 - Math.exp(-pagesDone / 6))));
}
