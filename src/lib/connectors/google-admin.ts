/**
 * Google Workspace (Admin) connector — domain-wide, and unlike the per-user
 * Google connector this one is not blocked by Google's restricted-scope regime.
 *
 * WHY THIS EXISTS SEPARATELY FROM src/lib/connectors/google.ts:
 *
 *   google.ts uses drive.metadata.readonly and gmail.metadata. Both are
 *   RESTRICTED scopes, which means OAuth verification PLUS an annual third-party
 *   security assessment (CASA) before any public launch, with a real risk of
 *   prohibited-use-case rejection. That connector is demo-only for policy
 *   reasons, not technical ones.
 *
 *   This connector uses admin.reports.usage.readonly, which is a SENSITIVE
 *   scope, not a restricted one. Sensitive scopes require verification and a
 *   justification, but not CASA. That is the difference between "cannot ship"
 *   and "can ship after review", so the two are separate cards with separate
 *   honesty labels rather than two paths behind one.
 *
 * WHAT IT MEASURES, AND WHAT IT DELIBERATELY DOES NOT:
 *
 *   Storage is a STOCK metric and is exact. accounts:drive_used_quota_in_mb and
 *   accounts:gmail_used_quota_in_mb report Drive and Gmail separately, which
 *   removes the biggest caveat in the per-user connector — there, Drive's
 *   storageQuota.usage spans Drive + Gmail + Photos and cannot be split.
 *
 *   The drive:num_* parameters are FLOW metrics: items created or added during
 *   the report window, not the number of items the domain holds. Summing them
 *   into a file count would invent a total, so this connector does not report a
 *   file count at all and says why in its caveats.
 *
 * Endpoint (read-only):
 *   GET https://admin.googleapis.com/admin/reports/v1/usage/users/all/dates/{date}
 */
import { z } from "zod";
import { providerJson, formEncode } from "./http";
import {
  addToCategory,
  boundedProgress,
  emptyMetrics,
  type ConnectorAdapter,
  type NormalizedMetrics,
  type ScanPageResult,
} from "./types";
import { ProviderError } from "@/lib/logging";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const REPORTS = "https://admin.googleapis.com/admin/reports/v1";
const USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";

export const ADMIN_REPORTS_SCOPE =
  "https://www.googleapis.com/auth/admin.reports.usage.readonly";

const PAGE_SIZE = 1000;
const MAX_PAGES_PER_INVOCATION = 3;

/**
 * Report data lags behind real time. Rather than guess a fixed offset, walk back
 * from a couple of days ago until a date actually returns rows.
 */
const REPORT_LAG_DAYS = 2;
const MAX_LOOKBACK_DAYS = 10;

const MB = 1024 * 1024;

const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
  scope: z.string().optional(),
});

const userinfoSchema = z.object({
  email: z.string().nullish(),
  hd: z.string().nullish(),
  sub: z.string().nullish(),
});

const usageSchema = z.object({
  warnings: z
    .array(z.object({ code: z.string().nullish(), message: z.string().nullish() }).passthrough())
    .nullish(),
  usageReports: z
    .array(
      z.object({
        date: z.string().nullish(),
        entity: z.object({ profileId: z.string().nullish() }).passthrough().nullish(),
        parameters: z
          .array(
            z.object({
              name: z.string(),
              intValue: z.union([z.string(), z.number()]).nullish(),
              stringValue: z.string().nullish(),
              boolValue: z.boolean().nullish(),
            })
          )
          .nullish(),
      })
    )
    .nullish(),
  nextPageToken: z.string().nullish(),
});

/** Exact storage totals. Everything here is a stock metric. */
const QUOTA_PARAMETERS = [
  "accounts:used_quota_in_mb",
  "accounts:drive_used_quota_in_mb",
  "accounts:gmail_used_quota_in_mb",
  "accounts:gplus_photos_used_quota_in_mb",
  "accounts:total_quota_in_mb",
] as const;

function clientId() {
  return process.env.GOOGLE_ADMIN_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID ?? "";
}
function clientSecret() {
  return process.env.GOOGLE_ADMIN_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? "";
}

const SCOPES = ["openid", "email", ADMIN_REPORTS_SCOPE];

export const googleAdminAdapter: ConnectorAdapter = {
  key: "GOOGLE_ADMIN",
  label: "Google Workspace (Admin)",
  description:
    "Domain-wide storage across every account, with Drive and Gmail reported separately.",
  unitType: "UNSTRUCTURED_BYTES",
  liveCapable: true,
  limitationNotice:
    "Requires a Google Workspace super administrator to authorize. Reports exact storage volume domain-wide; the Reports API does not expose a total item count, so file counts are not reported.",
  scopes: [
    {
      scope: ADMIN_REPORTS_SCOPE,
      why: "Read your Workspace usage reports: how much storage each account uses in Drive and in Gmail. This is a reporting permission — it grants no access to any file or message.",
    },
    { scope: "openid email", why: "Read the administrator's email and domain so we can label the connection." },
  ],
  permissionExplainer: {
    willRead: [
      "Total storage used across your Workspace domain, in bytes",
      "How that storage splits between Drive and Gmail",
      "How many licensed accounts are in the domain",
      "The administrator's email address and domain",
    ],
    willNotRead: [
      "The contents of any Drive file, in any account",
      "The body, subject, sender or recipient of any email",
      "Any individual's activity, documents, or messages",
      "Nothing is downloaded, copied, modified or deleted",
    ],
  },

  isConfigured() {
    return Boolean(clientId() && clientSecret());
  },

  getAuthorizationUrl({ state, codeChallenge, redirectUri }) {
    const params = new URLSearchParams({
      client_id: clientId(),
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    if (codeChallenge) {
      params.set("code_challenge", codeChallenge);
      params.set("code_challenge_method", "S256");
    }
    return `${AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode({ code, codeVerifier, redirectUri }) {
    const raw = await providerJson(TOKEN_URL, {
      provider: "GOOGLE_ADMIN",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formEncode({
        code,
        client_id: clientId(),
        client_secret: clientSecret(),
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      }),
    });
    const parsed = tokenResponseSchema.parse(raw);
    const who = await getUserinfo(parsed.access_token);
    const email = who?.email ?? null;
    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token ?? null,
      expiresAt: parsed.expires_in ? new Date(Date.now() + parsed.expires_in * 1000) : null,
      scopes: parsed.scope ?? null,
      accountLabel: who?.hd ? `${who.hd} (admin: ${email ?? "unknown"})` : (email ?? "Google Workspace"),
      accountDomain: who?.hd ?? email?.split("@")[1] ?? null,
      externalId: who?.sub ?? email,
      scanPath: "admin",
    };
  },

  async refreshToken({ refreshToken }) {
    const raw = await providerJson(TOKEN_URL, {
      provider: "GOOGLE_ADMIN",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formEncode({
        refresh_token: refreshToken,
        client_id: clientId(),
        client_secret: clientSecret(),
        grant_type: "refresh_token",
      }),
    });
    const parsed = tokenResponseSchema.parse(raw);
    return {
      accessToken: parsed.access_token,
      // Google does not reissue the refresh token on refresh.
      refreshToken: parsed.refresh_token ?? refreshToken,
      expiresAt: parsed.expires_in ? new Date(Date.now() + parsed.expires_in * 1000) : null,
      scopes: parsed.scope ?? null,
      accountLabel: null,
      accountDomain: null,
      externalId: null,
      scanPath: "admin",
    };
  },

  async scanPage({ accessToken, state, partial }) {
    const metrics: NormalizedMetrics = { ...partial, categoryMix: { ...partial.categoryMix } };
    const next = { ...state };
    const auth = { Authorization: `Bearer ${accessToken}` };
    let itemsSeen = 0;

    const stream = next["gadmin:usage"] ?? { cursor: null, completed: false, pageCount: 0 };

    // Resolve which report date actually has data, once, and remember it so
    // later pages of the same scan read a consistent snapshot.
    let reportDate = (stream.sampling?.reportDate as string | undefined) ?? null;
    if (!reportDate) {
      reportDate = await resolveReportDate(accessToken);
      if (!reportDate) {
        metrics.scopeLimited = true;
        metrics.confidence = "SCOPE_LIMITED";
        metrics.method = "Google Workspace admin usage reports.";
        metrics.caveats.push(
          `No usage report was available for any date in the last ${MAX_LOOKBACK_DAYS} days. Google publishes these with a delay, and a very new tenant may have none yet.`
        );
        next["gadmin:usage"] = { cursor: null, completed: true, pageCount: 0 };
        return {
          state: next,
          partial: metrics,
          hasMore: false,
          itemsSeen: 0,
          progressPct: 100,
          progressLabel: "No usage report available",
        };
      }
      stream.sampling = { ...(stream.sampling ?? {}), reportDate };
    }

    let pages = 0;
    let accounts = (stream.sampling?.accounts as number | undefined) ?? 0;
    let driveMb = (stream.sampling?.driveMb as number | undefined) ?? 0;
    let gmailMb = (stream.sampling?.gmailMb as number | undefined) ?? 0;
    let photosMb = (stream.sampling?.photosMb as number | undefined) ?? 0;
    let allocatedMb = (stream.sampling?.allocatedMb as number | undefined) ?? 0;

    while (!stream.completed && pages < MAX_PAGES_PER_INVOCATION) {
      const params = new URLSearchParams({
        parameters: QUOTA_PARAMETERS.join(","),
        maxResults: String(PAGE_SIZE),
      });
      if (stream.cursor) params.set("pageToken", stream.cursor);

      const page = usageSchema.parse(
        await providerJson(
          `${REPORTS}/usage/users/all/dates/${reportDate}?${params.toString()}`,
          { provider: "GOOGLE_ADMIN", headers: auth }
        )
      );

      for (const row of page.usageReports ?? []) {
        accounts += 1;
        itemsSeen += 1;
        for (const p of row.parameters ?? []) {
          const mb = intOf(p.intValue);
          switch (p.name) {
            case "accounts:drive_used_quota_in_mb":
              driveMb += mb;
              break;
            case "accounts:gmail_used_quota_in_mb":
              gmailMb += mb;
              break;
            case "accounts:gplus_photos_used_quota_in_mb":
              photosMb += mb;
              break;
            case "accounts:total_quota_in_mb":
              allocatedMb += mb;
              break;
            default:
              break;
          }
        }
      }

      stream.cursor = page.nextPageToken ?? null;
      stream.pageCount += 1;
      stream.completed = !stream.cursor;
      pages += 1;
    }

    stream.sampling = { reportDate, accounts, driveMb, gmailMb, photosMb, allocatedMb };
    next["gadmin:usage"] = stream;

    // Rebuild the totals from the running sums rather than incrementing, so a
    // retried page cannot double-count.
    const driveBytes = driveMb * MB;
    const gmailBytes = gmailMb * MB;
    const photosBytes = photosMb * MB;

    metrics.totalBytes = driveBytes + gmailBytes + photosBytes;
    metrics.totalFiles = 0;
    metrics.categoryMix = {};
    addToCategory(metrics.categoryMix, "documents", driveBytes, 0);
    addToCategory(metrics.categoryMix, "email", gmailBytes, 0);
    if (photosBytes > 0) addToCategory(metrics.categoryMix, "images", photosBytes, 0);

    metrics.confidence = "EXACT";
    metrics.method =
      "Domain-wide storage from the Google Workspace Admin SDK usage reports, summed across every account, with Drive and Gmail reported separately by Google rather than derived.";

    if (stream.completed) {
      metrics.caveats = dedupe([
        ...metrics.caveats,
        `Measured across ${accounts.toLocaleString()} Workspace accounts from the usage report dated ${reportDate}.`,
        `Drive holds ${gb(driveBytes)} GB and Gmail holds ${gb(gmailBytes)} GB. Google reports these separately, so neither figure is derived by subtraction.`,
        "The Admin SDK usage reports expose storage totals but not a count of items held, so no file or message count is reported for this source. The item figures Google does publish count activity during the report window, not the size of the corpus.",
        `Usage reports are published with a delay, so this reflects the domain as of ${reportDate} rather than this moment.`,
      ]);
      if (allocatedMb > 0) {
        metrics.caveats.push(
          `Domain storage allocation totals ${gb(allocatedMb * MB)} GB across all accounts.`
        );
      }
    }

    return {
      state: next,
      partial: metrics,
      hasMore: !stream.completed,
      itemsSeen,
      progressPct: boundedProgress(stream.pageCount, stream.completed),
      progressLabel: stream.completed
        ? "Scan complete"
        : `Reading domain usage reports — ${accounts.toLocaleString()} accounts so far`,
    } satisfies ScanPageResult;
  },

  normalizeMetrics(partial) {
    return { ...partial, caveats: dedupe(partial.caveats) };
  },

  async disconnect({ accessToken }) {
    if (!accessToken) return;
    try {
      await providerJson(REVOKE_URL, {
        provider: "GOOGLE_ADMIN",
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formEncode({ token: accessToken }),
        maxAttempts: 1,
      });
    } catch {
      /* already revoked or unreachable */
    }
  },
};

/**
 * Finds the most recent date that actually returns rows. Google publishes usage
 * reports with a lag, and asking for a date it has not processed yet returns an
 * empty report rather than an error — which would otherwise look like a domain
 * with no data at all.
 */
export async function resolveReportDate(
  accessToken: string,
  now: Date = new Date()
): Promise<string | null> {
  for (let back = REPORT_LAG_DAYS; back <= MAX_LOOKBACK_DAYS; back++) {
    const d = new Date(now.getTime() - back * 24 * 60 * 60 * 1000);
    const iso = d.toISOString().slice(0, 10);
    try {
      const page = usageSchema.parse(
        await providerJson(
          `${REPORTS}/usage/users/all/dates/${iso}?parameters=accounts:used_quota_in_mb&maxResults=1`,
          { provider: "GOOGLE_ADMIN", headers: { Authorization: `Bearer ${accessToken}` } }
        )
      );
      if ((page.usageReports?.length ?? 0) > 0) return iso;
    } catch (err) {
      // 400 means the date is outside the retention or not yet processed; keep
      // walking back. Anything else is a real failure worth surfacing.
      if (err instanceof ProviderError && (err.status === 400 || err.status === 404)) continue;
      throw err;
    }
  }
  return null;
}

async function getUserinfo(accessToken: string) {
  try {
    const raw = await providerJson(USERINFO, {
      provider: "GOOGLE_ADMIN",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return userinfoSchema.parse(raw);
  } catch {
    return null;
  }
}

function intOf(v: string | number | null | undefined): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function gb(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

function dedupe(a: string[]): string[] {
  return Array.from(new Set(a));
}

export function googleAdminEmptyMetrics(): NormalizedMetrics {
  return emptyMetrics("UNSTRUCTURED_BYTES", "Google Workspace admin usage reports.", "EXACT");
}
