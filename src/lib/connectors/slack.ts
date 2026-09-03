/**
 * Slack connector — FILES ONLY. Message volume is not achievable and this file
 * contains no code path that attempts it.
 *
 * Why: as of 29 May 2025, for apps commercially distributed outside the Slack
 * Marketplace, conversations.history and conversations.replies are limited to
 * ONE request per minute with the `limit` parameter capped at 15 objects.
 * Existing installations of such apps were brought under the same limits on
 * 3 March 2026. At 15 messages per minute, measuring even a small workspace's
 * message volume would take months, so it is not attempted. Adding a
 * channels:history scope here would request a permission the product cannot use.
 *
 * Endpoints used (all read-only):
 *   GET https://slack.com/api/files.list
 *   GET https://slack.com/api/conversations.list   (channel count only)
 *   GET https://slack.com/api/users.list           (member count only)
 */
import { z } from "zod";
import { providerJson, formEncode } from "./http";
import {
  addToCategory,
  boundedProgress,
  categoryForExtension,
  widenDateRange,
  type ConnectorAdapter,
  type NormalizedMetrics,
  type ScanPageResult,
} from "./types";
import { ProviderError } from "@/lib/logging";

const AUTH_URL = "https://slack.com/oauth/v2/authorize";
const TOKEN_URL = "https://slack.com/api/oauth.v2.access";
const API = "https://slack.com/api";
const MAX_PAGES_PER_INVOCATION = 3;

const oauthSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  access_token: z.string().optional(),
  scope: z.string().optional(),
  team: z.object({ id: z.string().optional(), name: z.string().optional() }).optional(),
  authed_user: z.object({ id: z.string().optional(), access_token: z.string().optional() }).optional(),
});

const filesSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  files: z
    .array(
      z.object({
        id: z.string(),
        size: z.number().nullish(),
        filetype: z.string().nullish(),
        mimetype: z.string().nullish(),
        created: z.number().nullish(),
      })
    )
    .nullish(),
  paging: z.object({ page: z.number(), pages: z.number(), total: z.number() }).nullish(),
});

const conversationsSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  channels: z.array(z.object({ id: z.string() })).nullish(),
  response_metadata: z.object({ next_cursor: z.string().nullish() }).nullish(),
});

const usersSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  members: z.array(z.object({ id: z.string(), is_bot: z.boolean().nullish(), deleted: z.boolean().nullish() })).nullish(),
  response_metadata: z.object({ next_cursor: z.string().nullish() }).nullish(),
});

function clientId() {
  return process.env.SLACK_CLIENT_ID ?? "";
}
function clientSecret() {
  return process.env.SLACK_CLIENT_SECRET ?? "";
}

export const slackAdapter: ConnectorAdapter = {
  key: "SLACK",
  label: "Slack",
  description: "Shared file volume, channel and member counts. Message content is not measured.",
  unitType: "UNSTRUCTURED_BYTES",
  liveCapable: true,
  limitationNotice:
    "File volume only. Slack's rate limits for non-Marketplace apps make message-volume measurement impossible, so it is not attempted.",
  scopes: [
    { scope: "files:read", why: "Read the size, type and date of files shared in your workspace. File contents are never downloaded." },
    { scope: "channels:read", why: "Count public channels. This does not grant access to any message." },
    { scope: "users:read", why: "Count workspace members. This does not read profiles or messages." },
  ],
  permissionExplainer: {
    willRead: [
      "The total size, count and type of files shared in your workspace",
      "How many public channels exist",
      "How many members are in the workspace",
    ],
    willNotRead: [
      "Any message, in any channel or DM — we do not request the history permission at all",
      "The contents of any shared file",
      "Nothing is posted, modified or deleted",
    ],
  },

  isConfigured() {
    return Boolean(clientId() && clientSecret());
  },

  getAuthorizationUrl({ state, redirectUri }) {
    const params = new URLSearchParams({
      client_id: clientId(),
      // Bot-token scopes. channels:history and groups:history are deliberately absent.
      scope: "files:read,channels:read,users:read",
      redirect_uri: redirectUri,
      state,
    });
    return `${AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode({ code, redirectUri }) {
    const raw = await providerJson(TOKEN_URL, {
      provider: "SLACK",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formEncode({
        code,
        client_id: clientId(),
        client_secret: clientSecret(),
        redirect_uri: redirectUri,
      }),
    });
    const parsed = oauthSchema.parse(raw);
    // Slack signals failure with ok:false and HTTP 200.
    if (!parsed.ok || !parsed.access_token) {
      throw new ProviderError(
        "SLACK_OAUTH_FAILED",
        "Slack did not complete the authorization.",
        200
      );
    }
    return {
      accessToken: parsed.access_token,
      // Slack bot tokens do not expire unless token rotation is enabled on the app.
      refreshToken: null,
      expiresAt: null,
      scopes: parsed.scope ?? null,
      accountLabel: parsed.team?.name ?? "Slack workspace",
      accountDomain: null,
      externalId: parsed.team?.id ?? null,
    };
  },

  async refreshToken() {
    throw new ProviderError(
      "SLACK_NO_REFRESH",
      "Slack bot tokens do not expire; reconnect the workspace if authorization was revoked."
    );
  },

  async scanPage({ accessToken, state, partial }) {
    const metrics: NormalizedMetrics = { ...partial, categoryMix: { ...partial.categoryMix } };
    const next = { ...state };
    const auth = { Authorization: `Bearer ${accessToken}` };
    let itemsSeen = 0;

    metrics.method =
      "Aggregate file volume from the Slack files API, plus channel and member counts. Message volume is not measured.";
    // A Slack corpus can never be measured completely by this app, so the tier is
    // SCOPE_LIMITED regardless of how successful the file scan is.
    metrics.confidence = "SCOPE_LIMITED";
    metrics.scopeLimited = true;
    metrics.caveats = dedupe([
      ...metrics.caveats,
      "File volume only — message content is not measured. Slack limits non-Marketplace apps to 1 history request per minute with a maximum of 15 messages per request, which makes message-volume measurement impractical, so this app does not request the history permission at all.",
    ]);

    // --- files.list ----------------------------------------------------------
    const files = next["slack:files"] ?? { cursor: null, completed: false, pageCount: 0 };
    let pages = 0;
    while (!files.completed && pages < MAX_PAGES_PER_INVOCATION) {
      const page = Number(files.cursor ?? "1");
      const params = new URLSearchParams({ count: "200", page: String(page) });
      const res = filesSchema.parse(
        await providerJson(`${API}/files.list?${params.toString()}`, { provider: "SLACK", headers: auth })
      );
      if (!res.ok) {
        if (res.error === "missing_scope") {
          metrics.caveats.push("Files were not measured because the files:read permission was not granted.");
          files.completed = true;
          break;
        }
        throw new ProviderError("SLACK_API_ERROR", "Slack rejected the files request.", 200);
      }
      for (const f of res.files ?? []) {
        itemsSeen += 1;
        metrics.totalFiles += 1;
        metrics.totalBytes += f.size ?? 0;
        addToCategory(metrics.categoryMix, categoryForExtension(f.filetype ?? null), f.size ?? 0);
        if (f.created) widenDateRange(metrics, new Date(f.created * 1000).toISOString());
      }
      files.pageCount += 1;
      const paging = res.paging;
      if (!paging || paging.page >= paging.pages) {
        files.completed = true;
        if (paging) {
          metrics.caveats.push(`${paging.total.toLocaleString()} files are shared in this workspace.`);
        }
      } else {
        files.cursor = String(paging.page + 1);
      }
      pages += 1;
    }
    next["slack:files"] = files;

    // --- channel and member counts (context only, no bytes) ------------------
    if (files.completed && !next["slack:context"]?.completed) {
      const channels = await countPaged(
        `${API}/conversations.list?limit=200&exclude_archived=true&types=public_channel`,
        auth,
        (raw) => {
          const p = conversationsSchema.parse(raw);
          if (!p.ok) throw new ProviderError("SLACK_API_ERROR", "Slack rejected the channels request.", 200);
          return { count: p.channels?.length ?? 0, cursor: p.response_metadata?.next_cursor ?? null };
        }
      );
      const members = await countPaged(`${API}/users.list?limit=200`, auth, (raw) => {
        const p = usersSchema.parse(raw);
        if (!p.ok) throw new ProviderError("SLACK_API_ERROR", "Slack rejected the users request.", 200);
        const real = (p.members ?? []).filter((m) => !m.is_bot && !m.deleted).length;
        return { count: real, cursor: p.response_metadata?.next_cursor ?? null };
      });
      if (channels != null || members != null) {
        metrics.caveats.push(
          `Workspace context: ${channels?.toLocaleString() ?? "unknown"} public channels, ${members?.toLocaleString() ?? "unknown"} active members. These are counts only and contribute no measured volume.`
        );
      }
      next["slack:context"] = { cursor: null, completed: true, pageCount: 1 };
    }

    const done = files.completed && next["slack:context"]?.completed === true;
    return {
      state: next,
      partial: metrics,
      hasMore: !done,
      itemsSeen,
      progressPct: boundedProgress(files.pageCount, done),
      progressLabel: done ? "Scan complete" : `Reading shared file metadata — ${metrics.totalFiles.toLocaleString()} files so far`,
    } satisfies ScanPageResult;
  },

  normalizeMetrics(partial) {
    return {
      ...partial,
      confidence: "SCOPE_LIMITED",
      scopeLimited: true,
      caveats: dedupe(partial.caveats),
    };
  },

  async disconnect({ accessToken }) {
    if (!accessToken) return;
    try {
      await providerJson(`${API}/auth.revoke`, {
        provider: "SLACK",
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        maxAttempts: 1,
      });
    } catch {
      /* best effort */
    }
  },
};

async function countPaged(
  url: string,
  auth: Record<string, string>,
  parse: (raw: unknown) => { count: number; cursor: string | null }
): Promise<number | null> {
  try {
    let total = 0;
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const u = cursor ? `${url}&cursor=${encodeURIComponent(cursor)}` : url;
      const parsed = parse(await providerJson(u, { provider: "SLACK", headers: auth }));
      total += parsed.count;
      cursor = parsed.cursor && parsed.cursor.length > 0 ? parsed.cursor : null;
      if (!cursor) break;
    }
    return total;
  } catch {
    return null;
  }
}

function dedupe(a: string[]): string[] {
  return Array.from(new Set(a));
}
