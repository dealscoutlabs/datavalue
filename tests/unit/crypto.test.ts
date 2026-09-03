import { beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import {
  __resetEncryptionKeyCache,
  createPkcePair,
  decryptOptional,
  decryptSecret,
  encryptOptional,
  encryptSecret,
  randomToken,
  safeEqual,
} from "@/lib/crypto";

const KEY = crypto.randomBytes(32).toString("base64");

beforeEach(() => {
  process.env.ENCRYPTION_KEY = KEY;
  __resetEncryptionKeyCache();
});

describe("token encryption", () => {
  it("round-trips a token", () => {
    const token = "sl.B7abcdef-fake-token-value-0123456789";
    expect(decryptSecret(encryptSecret(token))).toBe(token);
  });

  it("never leaves the plaintext visible in the ciphertext", () => {
    const token = "super-secret-refresh-token";
    const ct = encryptSecret(token);
    expect(ct).not.toContain(token);
    expect(Buffer.from(ct).toString("utf8")).not.toContain(token);
    // No component of the versioned envelope decodes back to the plaintext.
    for (const part of ct.split(".").slice(1)) {
      expect(Buffer.from(part, "base64url").toString("utf8")).not.toContain(token);
    }
  });

  it("produces a different ciphertext each time (fresh IV per record)", () => {
    const a = encryptSecret("same-token");
    const b = encryptSecret("same-token");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it("detects tampering via the GCM authentication tag", () => {
    const ct = encryptSecret("token");
    const parts = ct.split(".");
    const body = Buffer.from(parts[3], "base64url");
    body[0] ^= 0xff;
    parts[3] = body.toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("rejects a malformed or wrong-version envelope", () => {
    expect(() => decryptSecret("not-ciphertext")).toThrow(/Malformed/);
    expect(() => decryptSecret("v2.a.b.c")).toThrow(/Malformed/);
  });

  it("fails loudly on a wrong key rather than returning garbage", () => {
    const ct = encryptSecret("token");
    process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    __resetEncryptionKeyCache();
    expect(() => decryptSecret(ct)).toThrow();
  });

  it("refuses a key that is not exactly 32 bytes", () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(16).toString("base64");
    __resetEncryptionKeyCache();
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
  });

  it("refuses to run with no key configured", () => {
    delete process.env.ENCRYPTION_KEY;
    __resetEncryptionKeyCache();
    expect(() => encryptSecret("x")).toThrow(/ENCRYPTION_KEY/);
  });

  it("passes null through so optional credentials stay optional", () => {
    expect(encryptOptional(null)).toBeNull();
    expect(encryptOptional("")).toBeNull();
    expect(decryptOptional(null)).toBeNull();
    expect(decryptOptional(encryptOptional("abc"))).toBe("abc");
  });
});

describe("oauth primitives", () => {
  it("compares states in constant time and rejects mismatches", () => {
    const a = randomToken(32);
    expect(safeEqual(a, a)).toBe(true);
    expect(safeEqual(a, randomToken(32))).toBe(false);
    expect(safeEqual(a, a.slice(0, -1))).toBe(false);
  });

  it("produces a valid RFC 7636 PKCE pair", () => {
    const { verifier, challenge } = createPkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
    expect(challenge).toBe(crypto.createHash("sha256").update(verifier).digest("base64url"));
  });

  it("does not repeat state values", () => {
    const seen = new Set(Array.from({ length: 200 }, () => randomToken(32)));
    expect(seen.size).toBe(200);
  });
});
