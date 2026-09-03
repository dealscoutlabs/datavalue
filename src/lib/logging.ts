/**
 * Redaction-first logging. Provider payloads and OAuth credentials must never
 * reach stdout, an error reporter, or the AuditEvent table.
 */

const SECRET_KEYS = [
  "access_token", "refresh_token", "accesstoken", "refreshtoken", "id_token",
  "client_secret", "clientsecret", "code", "code_verifier", "codeverifier",
  "authorization", "password", "passwordhash", "accesstokenenc", "refreshtokenenc",
  "cookie", "set-cookie", "state", "api_key", "apikey", "secret", "token",
];

const MAX_DEPTH = 6;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[truncated]";
  if (value == null) return value;
  if (typeof value === "string") return value.length > 512 ? `${value.slice(0, 512)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.includes(k.toLowerCase()) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return "[unserialisable]";
}

/**
 * Turn any thrown value into a message safe to persist and show. Provider error
 * bodies frequently echo request parameters, so only the status and a short,
 * redacted reason survive.
 */
export function safeErrorMessage(err: unknown): string {
  if (err instanceof ProviderError) return `${err.code}: ${err.publicMessage}`;
  if (err instanceof Error) {
    const msg = err.message.replace(/[A-Za-z0-9_\-]{40,}/g, "[redacted]");
    return msg.slice(0, 300);
  }
  return "Unknown error";
}

export class ProviderError extends Error {
  constructor(
    public code: string,
    public publicMessage: string,
    public status?: number,
    public retryAfterMs?: number
  ) {
    super(`${code}: ${publicMessage}`);
    this.name = "ProviderError";
  }
}

export function log(event: string, detail?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "test") return;
  console.log(JSON.stringify({ event, ...(detail ? { detail: redact(detail) } : {}) }));
}
