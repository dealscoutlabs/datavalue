import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { googleAdminAdapter, resolveReportDate, ADMIN_REPORTS_SCOPE } from "@/lib/connectors/google-admin";
import { googleAdapter } from "@/lib/connectors/google";
import { emptyMetrics, normalizedMetricsSchema } from "@/lib/connectors/types";
import { assessSource } from "@/lib/eligibility/engine";

const MB = 1024 * 1024;

/**
 * The date-probe requests exactly one parameter; the real page requests all
 * five. Matching on maxResults would be wrong — "maxResults=1000" contains
 * "maxResults=1".
 */
const isProbe = (url: string) =>
  url.includes("parameters=accounts%3Aused_quota_in_mb&") ||
  url.includes("parameters=accounts:used_quota_in_mb&");

function mockRoutes(routes: Record<string, (url: string) => { body: unknown; status?: number }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      const key = Object.keys(routes)
        .sort((a, b) => b.length - a.length)
        .find((k) => url.includes(k));
      if (!key) throw new Error(`Unmocked: ${url}`);
      const { body, status = 200 } = routes[key](url);
      return new Response(JSON.stringify(body), { status });
    })
  );
}

function usageRow(profileId: string, driveMb: number, gmailMb: number, photosMb = 0, totalMb = 30720) {
  return {
    date: "2026-09-01",
    entity: { profileId },
    parameters: [
      { name: "accounts:drive_used_quota_in_mb", intValue: String(driveMb) },
      { name: "accounts:gmail_used_quota_in_mb", intValue: String(gmailMb) },
      { name: "accounts:gplus_photos_used_quota_in_mb", intValue: String(photosMb) },
      { name: "accounts:total_quota_in_mb", intValue: String(totalMb) },
    ],
  };
}

beforeEach(() => {
  process.env.GOOGLE_ADMIN_CLIENT_ID = "id";
  process.env.GOOGLE_ADMIN_CLIENT_SECRET = "secret";
});
afterEach(() => vi.unstubAllGlobals());

describe("scope posture", () => {
  it("requests the usage-reports scope and no restricted Drive or Gmail scope", () => {
    const url = googleAdminAdapter.getAuthorizationUrl({
      state: "s",
      codeChallenge: "c",
      redirectUri: "http://x/cb",
    });
    expect(url).toContain(encodeURIComponent(ADMIN_REPORTS_SCOPE));
    // The restricted scopes that make the per-user connector unlaunchable.
    expect(url).not.toContain("drive.metadata.readonly");
    expect(url).not.toContain("gmail.metadata");
    expect(url).not.toContain("drive.readonly");
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain("access_type=offline");
  });

  it("is the launchable Google path, unlike the per-user connector", () => {
    expect(googleAdminAdapter.liveCapable).toBe(true);
    expect(googleAdapter.liveCapable).toBe(false);
  });

  it("promises in its explainer that it reads no file or message content", () => {
    const notRead = googleAdminAdapter.permissionExplainer.willNotRead.join(" ").toLowerCase();
    expect(notRead).toMatch(/contents of any drive file/);
    expect(notRead).toMatch(/body, subject, sender or recipient/);
  });
});

describe("domain-wide measurement", () => {
  it("sums storage across accounts and keeps Drive and Gmail separate", async () => {
    mockRoutes({
      "/usage/users/all/dates/": (url) => {
        if (isProbe(url)) return { body: { usageReports: [usageRow("probe", 1, 1)] } };
        return {
          body: {
            usageReports: [
              usageRow("u1", 10_240, 5_120, 1_024),
              usageRow("u2", 20_480, 2_048, 0),
            ],
          },
        };
      },
    });

    const result = await googleAdminAdapter.scanPage({
      accessToken: "t",
      state: {},
      partial: emptyMetrics("UNSTRUCTURED_BYTES", "pending"),
    });
    const m = googleAdminAdapter.normalizeMetrics(result.partial);
    expect(() => normalizedMetricsSchema.parse(m)).not.toThrow();

    expect(m.categoryMix.documents.bytes).toBe(30_720 * MB);
    expect(m.categoryMix.email.bytes).toBe(7_168 * MB);
    expect(m.categoryMix.images.bytes).toBe(1_024 * MB);
    expect(m.totalBytes).toBe((30_720 + 7_168 + 1_024) * MB);
    expect(m.confidence).toBe("EXACT");
    expect(result.hasMore).toBe(false);
  });

  it("reports no file count, because the API exposes storage but not items held", async () => {
    mockRoutes({
      "/usage/users/all/dates/": () => ({ body: { usageReports: [usageRow("u1", 100, 50)] } }),
    });
    const r = await googleAdminAdapter.scanPage({
      accessToken: "t",
      state: {},
      partial: emptyMetrics("UNSTRUCTURED_BYTES", "pending"),
    });
    const m = googleAdminAdapter.normalizeMetrics(r.partial);
    expect(m.totalFiles).toBe(0);
    expect(m.totalRecords).toBe(0);
    expect(m.caveats.join(" ")).toMatch(/not a count of items held/i);
    expect(m.caveats.join(" ")).toMatch(/count activity during the report window/i);
  });

  it("does not double-count when a page is retried", async () => {
    let call = 0;
    mockRoutes({
      "/usage/users/all/dates/": (url) => {
        if (isProbe(url)) return { body: { usageReports: [usageRow("p", 1, 1)] } };
        call += 1;
        return {
          body: {
            usageReports: [usageRow("u1", 1_000, 500)],
            ...(call === 1 ? { nextPageToken: "page2" } : {}),
          },
        };
      },
    });

    let state = {};
    let partial = emptyMetrics("UNSTRUCTURED_BYTES", "pending");
    for (let i = 0; i < 4; i++) {
      const r = await googleAdminAdapter.scanPage({ accessToken: "t", state, partial });
      state = r.state;
      partial = r.partial;
      if (!r.hasMore) break;
    }
    // Two pages of the same row, summed once each: 2000 MB Drive, 1000 MB Gmail.
    expect(partial.categoryMix.documents.bytes).toBe(2_000 * MB);
    expect(partial.categoryMix.email.bytes).toBe(1_000 * MB);
  });
});

describe("report date resolution", () => {
  it("walks back until a date returns rows", async () => {
    const tried: string[] = [];
    mockRoutes({
      "/usage/users/all/dates/": (url) => {
        const date = url.split("/dates/")[1].split("?")[0];
        tried.push(date);
        // Only the fourth day back has data.
        const target = new Date(Date.UTC(2026, 8, 1) - 0);
        return date === target.toISOString().slice(0, 10)
          ? { body: { usageReports: [usageRow("u1", 1, 1)] } }
          : { body: { usageReports: [] } };
      },
    });
    const resolved = await resolveReportDate("t", new Date(Date.UTC(2026, 8, 5)));
    expect(resolved).toBe("2026-09-01");
    // Started at the documented lag rather than today.
    expect(tried[0]).toBe("2026-09-03");
  });

  it("reports SCOPE_LIMITED rather than an empty domain when no report exists", async () => {
    mockRoutes({ "/usage/users/all/dates/": () => ({ body: { usageReports: [] } }) });
    const r = await googleAdminAdapter.scanPage({
      accessToken: "t",
      state: {},
      partial: emptyMetrics("UNSTRUCTURED_BYTES", "pending"),
    });
    expect(r.partial.scopeLimited).toBe(true);
    expect(r.partial.confidence).toBe("SCOPE_LIMITED");
    expect(r.partial.caveats.join(" ")).toMatch(/No usage report was available/i);
    expect(r.hasMore).toBe(false);
  });

  it("keeps walking past a 400 but surfaces a real failure", async () => {
    mockRoutes({
      "/usage/users/all/dates/": () => ({ body: { error: "boom" }, status: 500 }),
    });
    await expect(resolveReportDate("t", new Date(Date.UTC(2026, 8, 5)))).rejects.toThrow();
  });
});

describe("eligibility treatment", () => {
  it("is a communications corpus, so it needs a rights review regardless of answers", () => {
    const r = assessSource(
      {
        connectionId: "c1",
        provider: "GOOGLE_ADMIN",
        categoryKeys: ["documents", "email"],
        scopeLimited: false,
        hasMetrics: true,
      },
      null
    );
    expect(r.status).toBe("REVIEW_REQUIRED");
    expect(r.ratesUnlocked).toBe(false);
  });
});
