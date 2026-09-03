/**
 * Authenticated encryption for OAuth credentials at rest.
 *
 * AES-256-GCM with a random 96-bit IV per record and a server-held key from
 * ENCRYPTION_KEY (32 bytes, base64). Ciphertext format:
 *   v1.<iv b64url>.<authTag b64url>.<ciphertext b64url>
 *
 * The key never leaves the server; decrypted tokens are never serialised into a
 * response body, a client component prop, or a log line.
 */
import crypto from "node:crypto";

const VERSION = "v1";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

let cachedKey: Buffer | null = null;

export function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32"
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}). Generate one with: openssl rand -base64 32`
    );
  }
  cachedKey = key;
  return key;
}

/** For tests only — clears the memoised key after mutating process.env. */
export function __resetEncryptionKeyCache() {
  cachedKey = null;
}

export function encryptSecret(plaintext: string): string {
  if (typeof plaintext !== "string") throw new Error("encryptSecret expects a string");
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, b64u(iv), b64u(tag), b64u(ct)].join(".");
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Malformed ciphertext");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGO, key, ub64(ivB64));
  decipher.setAuthTag(ub64(tagB64));
  return Buffer.concat([decipher.update(ub64(ctB64)), decipher.final()]).toString("utf8");
}

/** Encrypt when present; pass through null so optional tokens stay optional. */
export function encryptOptional(value: string | null | undefined): string | null {
  return value == null || value === "" ? null : encryptSecret(value);
}

export function decryptOptional(value: string | null | undefined): string | null {
  return value == null || value === "" ? null : decryptSecret(value);
}

function b64u(b: Buffer): string {
  return b.toString("base64url");
}
function ub64(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

/** Constant-time compare for OAuth state values. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** RFC 7636 PKCE pair. Verifier is 43-128 chars from the unreserved set. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(64).toString("base64url").slice(0, 96);
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
