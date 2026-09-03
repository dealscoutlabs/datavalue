/**
 * Shared provider HTTP client.
 *
 * Politeness is a correctness requirement here, not a nicety: every provider in
 * this app rate-limits, and a scan that gets throttled must checkpoint and come
 * back rather than hammer. Error bodies are never propagated verbatim, because
 * they routinely echo request parameters including tokens.
 */
import { ProviderError } from "@/lib/logging";

export type ProviderFetchOptions = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: BodyInit | null;
  /** Total attempts including the first. */
  maxAttempts?: number;
  timeoutMs?: number;
  /** Provider name used only in error codes. */
  provider: string;
};

const DEFAULT_ATTEMPTS = 4;
const DEFAULT_TIMEOUT_MS = 25_000;

export async function providerFetch(
  url: string,
  opts: ProviderFetchOptions
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_ATTEMPTS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        headers: opts.headers,
        body: opts.body,
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timer);

      if (res.status === 429 || res.status === 503) {
        const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
        if (attempt === maxAttempts) {
          throw new ProviderError(
            `${opts.provider}_RATE_LIMITED`,
            "The provider is rate limiting this scan. It will resume automatically.",
            res.status,
            retryAfterMs ?? backoffMs(attempt)
          );
        }
        await sleep(retryAfterMs ?? backoffMs(attempt));
        continue;
      }

      if (res.status === 401) {
        throw new ProviderError(
          `${opts.provider}_UNAUTHORIZED`,
          "The authorization for this source is no longer valid. Reconnect to continue.",
          401
        );
      }
      if (res.status === 403) {
        throw new ProviderError(
          `${opts.provider}_FORBIDDEN`,
          "The granted permissions do not allow this measurement.",
          403
        );
      }
      if (res.status >= 500) {
        if (attempt === maxAttempts) {
          throw new ProviderError(
            `${opts.provider}_SERVER_ERROR`,
            "The provider returned a server error.",
            res.status
          );
        }
        await sleep(backoffMs(attempt));
        continue;
      }
      if (!res.ok) {
        throw new ProviderError(
          `${opts.provider}_HTTP_${res.status}`,
          "The provider rejected the request.",
          res.status
        );
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      // Network/abort errors are retried; ProviderError is already final. The
      // original error is deliberately not propagated — provider error bodies
      // routinely echo request parameters including credentials.
      if (err instanceof ProviderError) throw err;
      if (attempt === maxAttempts) break;
      await sleep(backoffMs(attempt));
    }
  }

  throw new ProviderError(
    `${opts.provider}_NETWORK_ERROR`,
    "Could not reach the provider.",
    undefined,
    undefined
  );
}

export async function providerJson<T>(url: string, opts: ProviderFetchOptions): Promise<T> {
  const res = await providerFetch(url, opts);
  return (await res.json()) as T;
}

/** Exponential backoff with full jitter, capped at 30s. */
export function backoffMs(attempt: number): number {
  const base = Math.min(30_000, 500 * 2 ** (attempt - 1));
  return Math.round(base / 2 + Math.random() * (base / 2));
}

export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

export function formEncode(data: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) if (v != null) p.set(k, v);
  return p.toString();
}
