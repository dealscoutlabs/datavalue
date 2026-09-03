import { describe, expect, it } from "vitest";
import { ProviderError, redact, safeErrorMessage } from "@/lib/logging";

describe("redaction", () => {
  it("removes every credential-shaped key", () => {
    const out = redact({
      access_token: "sl.B7-secret",
      refresh_token: "rt-secret",
      code: "auth-code",
      code_verifier: "verifier",
      state: "state-value",
      client_secret: "cs",
      authorization: "Bearer abc",
      password: "hunter2",
      accessTokenEnc: "v1.a.b.c",
      provider: "DROPBOX",
    }) as Record<string, unknown>;

    for (const key of [
      "access_token", "refresh_token", "code", "code_verifier", "state",
      "client_secret", "authorization", "password", "accessTokenEnc",
    ]) {
      expect(out[key]).toBe("[redacted]");
    }
    expect(out.provider).toBe("DROPBOX");
  });

  it("redacts nested credentials inside provider payloads", () => {
    const out = redact({ response: { body: { access_token: "secret" } } }) as {
      response: { body: { access_token: string } };
    };
    expect(out.response.body.access_token).toBe("[redacted]");
  });

  it("truncates long strings and large arrays rather than dumping a payload", () => {
    const long = "x".repeat(5000);
    expect(String(redact(long)).length).toBeLessThan(600);
    expect((redact(Array.from({ length: 500 }, (_, i) => i)) as unknown[]).length).toBe(50);
  });

  it("stops at a bounded depth instead of recursing forever", () => {
    const deep: Record<string, unknown> = {};
    let node = deep;
    for (let i = 0; i < 40; i++) {
      node.next = {};
      node = node.next as Record<string, unknown>;
    }
    expect(() => JSON.stringify(redact(deep))).not.toThrow();
    expect(JSON.stringify(redact(deep))).toContain("[truncated]");
  });
});

describe("error messages", () => {
  it("keeps a provider error's public message and code", () => {
    const err = new ProviderError("DROPBOX_RATE_LIMITED", "The provider is rate limiting this scan.", 429);
    expect(safeErrorMessage(err)).toBe(
      "DROPBOX_RATE_LIMITED: The provider is rate limiting this scan."
    );
  });

  it("strips token-shaped substrings out of arbitrary error text", () => {
    const err = new Error("failed with token sl.B7abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ");
    const msg = safeErrorMessage(err);
    expect(msg).toContain("[redacted]");
    expect(msg).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
  });

  it("does not leak an unknown thrown value", () => {
    expect(safeErrorMessage({ access_token: "secret" })).toBe("Unknown error");
  });
});
