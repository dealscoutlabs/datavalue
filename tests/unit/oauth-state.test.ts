/**
 * OAuth state handling: the CSRF and account-linking defence.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  states: new Map<string, Record<string, unknown>>(),
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    oAuthState: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        db.states.set(data.state as string, { id: `id-${data.state}`, ...data });
        return db.states.get(data.state as string);
      }),
      findUnique: vi.fn(async ({ where }: { where: { state: string } }) => {
        return db.states.get(where.state) ?? null;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        for (const [k, v] of db.states) if (v.id === where.id) db.states.delete(k);
        return {};
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  },
}));

import {
  consumeState,
  mintState,
  OAuthStateError,
  parseProviderParam,
  redirectUriFor,
} from "@/lib/connectors/oauth";

beforeEach(() => {
  db.states.clear();
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
});

describe("oauth state", () => {
  it("mints PKCE for providers that support it and omits it for those that do not", async () => {
    const dropbox = await mintState({ provider: "DROPBOX", userId: "u1", organizationId: "o1" });
    expect(dropbox.codeChallenge).toBeTruthy();

    const hubspot = await mintState({ provider: "HUBSPOT", userId: "u1", organizationId: "o1" });
    expect(hubspot.codeChallenge).toBeUndefined();
  });

  it("accepts a state it minted for the right user and provider", async () => {
    const { state } = await mintState({ provider: "DROPBOX", userId: "u1", organizationId: "o1" });
    const row = await consumeState({ state, provider: "DROPBOX", userId: "u1" });
    expect(row.organizationId).toBe("o1");
  });

  it("rejects a missing state", async () => {
    await expect(consumeState({ state: null, provider: "DROPBOX", userId: "u1" })).rejects.toBeInstanceOf(
      OAuthStateError
    );
  });

  it("rejects a state it never minted", async () => {
    await expect(
      consumeState({ state: "forged-state", provider: "DROPBOX", userId: "u1" })
    ).rejects.toThrow(/Unrecognised state/);
  });

  it("rejects a replayed state, so a captured callback URL is useless twice", async () => {
    const { state } = await mintState({ provider: "DROPBOX", userId: "u1", organizationId: "o1" });
    await consumeState({ state, provider: "DROPBOX", userId: "u1" });
    await expect(consumeState({ state, provider: "DROPBOX", userId: "u1" })).rejects.toThrow(
      /Unrecognised state/
    );
  });

  it("rejects a state belonging to a different signed-in user (account linking)", async () => {
    const { state } = await mintState({ provider: "DROPBOX", userId: "victim", organizationId: "o1" });
    await expect(
      consumeState({ state, provider: "DROPBOX", userId: "attacker" })
    ).rejects.toThrow(/another session/);
  });

  it("rejects a state minted for a different provider", async () => {
    const { state } = await mintState({ provider: "DROPBOX", userId: "u1", organizationId: "o1" });
    await expect(consumeState({ state, provider: "SLACK", userId: "u1" })).rejects.toThrow(
      /Provider mismatch/
    );
  });

  it("rejects an expired state", async () => {
    const { state } = await mintState({ provider: "DROPBOX", userId: "u1", organizationId: "o1" });
    const row = db.states.get(state)!;
    row.expiresAt = new Date(Date.now() - 1000);
    await expect(consumeState({ state, provider: "DROPBOX", userId: "u1" })).rejects.toThrow(
      /State expired/
    );
  });

  it("consumes the state even when a later check fails, so a rejected state cannot be retried", async () => {
    const { state } = await mintState({ provider: "DROPBOX", userId: "u1", organizationId: "o1" });
    await expect(consumeState({ state, provider: "SLACK", userId: "u1" })).rejects.toThrow();
    expect(db.states.has(state)).toBe(false);
  });
});

describe("provider parameter", () => {
  it("accepts only the known providers and never DEMO", () => {
    expect(parseProviderParam("dropbox")).toBe("DROPBOX");
    expect(parseProviderParam("MICROSOFT")).toBe("MICROSOFT");
    expect(parseProviderParam("demo")).toBeNull();
    expect(parseProviderParam("../../etc/passwd")).toBeNull();
    expect(parseProviderParam("")).toBeNull();
  });

  it("builds the redirect URI from configured app origin", () => {
    expect(redirectUriFor("DROPBOX")).toBe(
      "https://app.example.com/api/connect/dropbox/callback"
    );
  });
});
