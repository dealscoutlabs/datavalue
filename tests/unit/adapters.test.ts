/**
 * Adapter normalisation against mocked provider responses.
 *
 * The fixtures below use the exact field names each provider's documented API
 * returns, so a shape change upstream shows up here rather than in production.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dropboxAdapter } from "@/lib/connectors/dropbox";
import { hubspotAdapter } from "@/lib/connectors/hubspot";
import { slackAdapter } from "@/lib/connectors/slack";
import { microsoftAdapter, detectScanPath } from "@/lib/connectors/microsoft";
import { emptyMetrics, normalizedMetricsSchema, categoryForExtension, extensionOf, boundedProgress } from "@/lib/connectors/types";

type Route = (url: string, init?: RequestInit) => unknown;

function mockFetch(routes: Record<string, Route>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      // Longest match wins, so "/me/drive/root/delta" is not shadowed by "/me/drive".
      const key = Object.keys(routes)
        .sort((a, b) => b.length - a.length)
        .find((k) => url.includes(k));
      if (!key) throw new Error(`Unmocked request: ${url}`);
      const body = routes[key](url, init);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    })
  );
}

beforeEach(() => {
  process.env.DROPBOX_CLIENT_ID = "id";
  process.env.DROPBOX_CLIENT_SECRET = "secret";
  process.env.HUBSPOT_CLIENT_ID = "id";
  process.env.HUBSPOT_CLIENT_SECRET = "secret";
  process.env.SLACK_CLIENT_ID = "id";
  process.env.SLACK_CLIENT_SECRET = "secret";
  process.env.MICROSOFT_CLIENT_ID = "id";
  process.env.MICROSOFT_CLIENT_SECRET = "secret";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("category bucketing", () => {
  it("derives an extension without keeping the file name", () => {
    expect(extensionOf("Q3 board pack.PDF")).toBe("pdf");
    expect(extensionOf("archive.tar.gz")).toBe("gz");
    expect(extensionOf("no-extension")).toBeNull();
    expect(extensionOf(".hidden")).toBeNull();
  });

  it("maps extensions to broad, content-free categories", () => {
    expect(categoryForExtension("docx")).toBe("documents");
    expect(categoryForExtension("xlsx")).toBe("spreadsheets");
    expect(categoryForExtension("mp4")).toBe("video");
    expect(categoryForExtension("zzz")).toBe("other");
    expect(categoryForExtension(null)).toBe("other");
  });

  it("never reports 100% progress until the stream actually completes", () => {
    expect(boundedProgress(0, false)).toBeLessThan(100);
    expect(boundedProgress(500, false)).toBeLessThanOrEqual(95);
    expect(boundedProgress(1, true)).toBe(100);
  });
});

describe("dropbox adapter", () => {
  it("builds an authorization URL with offline access, PKCE and only the two read scopes", () => {
    const url = new URL(
      dropboxAdapter.getAuthorizationUrl({
        state: "st",
        codeChallenge: "ch",
        redirectUri: "http://localhost:3000/cb",
      })
    );
    expect(url.origin + url.pathname).toBe("https://www.dropbox.com/oauth2/authorize");
    expect(url.searchParams.get("token_access_type")).toBe("offline");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("account_info.read files.metadata.read");
    expect(url.searchParams.get("state")).toBe("st");
  });

  it("requests no write, delete or content scope", () => {
    const scopes = dropboxAdapter.scopes.map((s) => s.scope).join(" ");
    expect(scopes).not.toMatch(/write|delete|content|sharing/i);
  });

  it("normalises space usage and file metadata into the shared shape", async () => {
    mockFetch({
      "/2/users/get_space_usage": () => ({
        used: 442_800_000_000,
        allocation: { ".tag": "individual", allocated: 2_199_023_255_552 },
      }),
      "/2/files/list_folder/continue": () => ({
        entries: [
          { ".tag": "file", name: "deck.pptx", size: 4_000_000, server_modified: "2026-08-01T10:00:00Z" },
        ],
        cursor: "c2",
        has_more: false,
      }),
      "/2/files/list_folder": () => ({
        entries: [
          { ".tag": "folder", name: "Clients" },
          { ".tag": "file", name: "contract.pdf", size: 2_000_000, client_modified: "2019-02-03T09:00:00Z" },
          { ".tag": "file", name: "budget.xlsx", size: 1_000_000, server_modified: "2026-08-20T12:00:00Z" },
          { ".tag": "file", name: "site.mov", size: 900_000_000, server_modified: "2024-05-05T08:00:00Z" },
        ],
        cursor: "c1",
        has_more: true,
      }),
    });

    const first = await dropboxAdapter.scanPage({
      accessToken: "t",
      state: {},
      partial: emptyMetrics("UNSTRUCTURED_BYTES", "pending"),
    });

    const metrics = dropboxAdapter.normalizeMetrics(first.partial);
    expect(() => normalizedMetricsSchema.parse(metrics)).not.toThrow();

    // Headline volume is the provider's exact figure, not the enumerated sum.
    expect(metrics.totalBytes).toBe(442_800_000_000);
    expect(metrics.confidence).toBe("EXACT");
    expect(metrics.totalFiles).toBe(4);
    expect(metrics.categoryMix.documents.count).toBe(1);
    expect(metrics.categoryMix.spreadsheets.count).toBe(1);
    expect(metrics.categoryMix.video.bytes).toBe(900_000_000);
    // Folders are not counted as files.
    expect(metrics.categoryMix.other).toBeUndefined();
    expect(metrics.oldestItemAt).toBe("2019-02-03T09:00:00.000Z");
    expect(metrics.newestItemAt).toBe("2026-08-20T12:00:00.000Z");
    expect(first.hasMore).toBe(false);
    // The discrepancy between enumerated bytes and reported usage is disclosed.
    expect(metrics.caveats.join(" ")).toMatch(/version history|deleted-file retention/i);
  });

  it("exchanges the code as a confidential client when Dropbox accepts it", async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/oauth2/token")) {
          bodies.push(String(init?.body ?? ""));
          return new Response(
            JSON.stringify({ access_token: "tok", refresh_token: "ref", expires_in: 14400 }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ account_id: "a1", email: "x@y.com" }), { status: 200 });
      })
    );

    const tokens = await dropboxAdapter.exchangeCode({
      code: "c",
      codeVerifier: "v",
      redirectUri: "http://localhost:3000/cb",
    });
    expect(tokens.accessToken).toBe("tok");
    expect(tokens.refreshToken).toBe("ref");
    // One attempt only: the first form was accepted.
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("client_secret=");
    expect(bodies[0]).toContain("code_verifier=v");
  });

  it("falls back to the public-client PKCE form if Dropbox rejects the secret", async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/oauth2/token")) {
          const body = String(init?.body ?? "");
          bodies.push(body);
          if (body.includes("client_secret=")) {
            return new Response(JSON.stringify({ error: "invalid_request" }), { status: 400 });
          }
          return new Response(
            JSON.stringify({ access_token: "tok2", refresh_token: "ref2", expires_in: 14400 }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ account_id: "a1", email: "x@y.com" }), { status: 200 });
      })
    );

    const tokens = await dropboxAdapter.exchangeCode({
      code: "c",
      codeVerifier: "v",
      redirectUri: "http://localhost:3000/cb",
    });
    expect(tokens.accessToken).toBe("tok2");
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).not.toContain("client_secret=");
    expect(bodies[1]).toContain("code_verifier=v");
  });

  it("does not retry a non-400 failure", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return new Response(JSON.stringify({ error: "server_error" }), { status: 500 });
      })
    );
    await expect(
      dropboxAdapter.exchangeCode({ code: "c", codeVerifier: "v", redirectUri: "http://x/cb" })
    ).rejects.toThrow();
    // maxAttempts is 1 on the exchange, and a 5xx must not trigger the PKCE fallback.
    expect(calls).toBe(1);
  });

  it("never calls a content or download endpoint", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        calls.push(url);
        const body = url.includes("get_space_usage")
          ? { used: 1, allocation: { ".tag": "individual", allocated: 2 } }
          : { entries: [], cursor: "c", has_more: false };
        return new Response(JSON.stringify(body), { status: 200 });
      })
    );

    await dropboxAdapter.scanPage({
      accessToken: "t",
      state: {},
      partial: emptyMetrics("UNSTRUCTURED_BYTES", "pending"),
    });
    for (const url of calls) {
      expect(url).not.toMatch(/download|get_thumbnail|content\.dropboxapi/i);
    }
  });
});

describe("hubspot adapter", () => {
  it("values records separately from bytes and reports exact counts", async () => {
    mockFetch({
      "/crm/v3/objects/contacts/search": () => ({ total: 24318 }),
      "/crm/v3/objects/companies/search": () => ({ total: 3902 }),
      "/crm/v3/objects/deals/search": () => ({ total: 1147 }),
      "/crm/v3/objects/contacts?": () => ({
        results: [
          {
            id: "1",
            createdAt: "2018-01-09T00:00:00Z",
            updatedAt: "2026-08-31T11:05:00Z",
            properties: { email: "a@b.com", firstname: "A", lastname: "B", company: "C" },
          },
          { id: "2", createdAt: "2020-01-09T00:00:00Z", properties: { email: "c@d.com" } },
        ],
      }),
      "/crm/v3/objects/companies?": () => ({ results: [{ id: "1", properties: { name: "X" } }] }),
      "/crm/v3/objects/deals?": () => ({ results: [{ id: "1", properties: { dealname: "D" } }] }),
      "/files/v3/files": () => ({
        results: [{ id: "f1", size: 3_000_000, extension: "pdf", createdAt: "2025-01-01T00:00:00Z" }],
      }),
    });

    let state = {};
    let partial = emptyMetrics("STRUCTURED_RECORDS", "pending");
    for (let i = 0; i < 5; i++) {
      const page = await hubspotAdapter.scanPage({ accessToken: "t", state, partial });
      state = page.state;
      partial = page.partial;
      if (!page.hasMore) break;
    }

    const metrics = hubspotAdapter.normalizeMetrics(partial);
    expect(() => normalizedMetricsSchema.parse(metrics)).not.toThrow();
    expect(metrics.unitType).toBe("STRUCTURED_RECORDS");
    expect(metrics.totalRecords).toBe(24318 + 3902 + 1147);
    expect(metrics.confidence).toBe("EXACT");

    const contacts = metrics.recordBreakdown.find((r) => r.objectType === "contacts");
    expect(contacts?.count).toBe(24318);
    // One of two sampled contacts had all four core fields; the other had one.
    expect(contacts?.fieldCompletenessPct).toBeCloseTo(62.5, 1);
    expect(metrics.caveats.join(" ")).toMatch(/field completeness is from a/i);
    expect(metrics.totalBytes).toBe(3_000_000);
  });

  it("requests only read scopes", () => {
    const scopes = hubspotAdapter.scopes.map((s) => s.scope).join(" ");
    expect(scopes).not.toMatch(/\.write|delete/i);
    expect(scopes).toContain("crm.objects.contacts.read");
  });
});

describe("slack adapter", () => {
  it("does not request message history under any name", () => {
    const url = slackAdapter.getAuthorizationUrl({ state: "s", redirectUri: "http://x/cb" });
    expect(url).not.toMatch(/history/);
    const scopes = slackAdapter.scopes.map((s) => s.scope).join(",");
    expect(scopes).toBe("files:read,channels:read,users:read");
  });

  it("always reports SCOPE_LIMITED and says why", async () => {
    mockFetch({
      "/api/files.list": () => ({
        ok: true,
        files: [
          { id: "f1", size: 5_000_000, filetype: "png", created: 1_700_000_000 },
          { id: "f2", size: 1_000_000, filetype: "pdf", created: 1_600_000_000 },
        ],
        paging: { page: 1, pages: 1, total: 2 },
      }),
      "/api/conversations.list": () => ({ ok: true, channels: [{ id: "c1" }, { id: "c2" }] }),
      "/api/users.list": () => ({
        ok: true,
        members: [{ id: "u1" }, { id: "u2", is_bot: true }, { id: "u3", deleted: true }],
      }),
    });

    let state = {};
    let partial = emptyMetrics("UNSTRUCTURED_BYTES", "pending");
    for (let i = 0; i < 4; i++) {
      const page = await slackAdapter.scanPage({ accessToken: "t", state, partial });
      state = page.state;
      partial = page.partial;
      if (!page.hasMore) break;
    }

    const metrics = slackAdapter.normalizeMetrics(partial);
    expect(metrics.confidence).toBe("SCOPE_LIMITED");
    expect(metrics.scopeLimited).toBe(true);
    expect(metrics.totalBytes).toBe(6_000_000);
    expect(metrics.totalFiles).toBe(2);
    expect(metrics.caveats.join(" ")).toMatch(/File volume only/);
    expect(metrics.caveats.join(" ")).toMatch(/1 history request per minute/);
  });

  it("refuses to refresh, because Slack bot tokens do not expire", async () => {
    await expect(slackAdapter.refreshToken({ refreshToken: "x" })).rejects.toThrow(/SLACK_NO_REFRESH/);
  });
});

describe("microsoft adapter", () => {
  it("detects the admin path only when Reports.Read.All was actually granted", () => {
    expect(detectScanPath("User.Read Files.Read.All Mail.Read")).toBe("delegated");
    expect(detectScanPath(null)).toBe("delegated");
    expect(detectScanPath("User.Read Reports.Read.All")).toBe("admin");
    expect(detectScanPath("user.read reports.read.all")).toBe("admin");
  });

  it("does not request the admin-only scope in the default consent request", () => {
    const url = microsoftAdapter.getAuthorizationUrl({
      state: "s",
      codeChallenge: "c",
      redirectUri: "http://x/cb",
    });
    expect(url).not.toMatch(/Reports\.Read\.All/);
    expect(url).toMatch(/Files\.Read\.All/);
    expect(url).toMatch(/code_challenge_method=S256/);
  });

  it("produces a complete delegated result with exact mailbox counts and sizes", async () => {
    mockFetch({
      "/me/drive": () => ({ quota: { total: 1_099_511_627_776, used: 94_600_000_000 } }),
      "/me/drive/root/delta": () => ({
        value: [
          { id: "1", name: "spec.docx", size: 500_000, lastModifiedDateTime: "2026-08-01T00:00:00Z", file: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } },
          { id: "2", name: "Folder", folder: {} },
        ],
      }),
      "/me/mailFolders/delta": () => ({
        value: [
          { id: "inbox", totalItemCount: 180_000, sizeInBytes: 40_000_000_000 },
          { id: "sent", totalItemCount: 33_540, sizeInBytes: 4_500_000_000 },
        ],
      }),
    });

    let state = {};
    let partial = emptyMetrics("UNSTRUCTURED_BYTES", "pending");
    for (let i = 0; i < 5; i++) {
      const page = await microsoftAdapter.scanPage({
        accessToken: "t",
        state,
        partial,
        scanPath: "delegated",
      });
      state = page.state;
      partial = page.partial;
      if (!page.hasMore) break;
    }

    const metrics = microsoftAdapter.normalizeMetrics(partial);
    expect(() => normalizedMetricsSchema.parse(metrics)).not.toThrow();
    expect(metrics.totalRecords).toBe(213_540);
    expect(metrics.totalBytes).toBe(94_600_000_000 + 44_500_000_000);
    expect(metrics.confidence).toBe("EXACT");
    // The delegated path's real limitation is stated, not glossed over.
    expect(metrics.caveats.join(" ")).toMatch(/only the signed-in user/i);
    expect(metrics.caveats.join(" ")).toMatch(/Reports\.Read\.All/);
  });
});
