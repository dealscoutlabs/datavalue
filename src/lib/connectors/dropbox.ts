/**
 * Dropbox connector — fully shippable.
 *
 * Endpoints used (all read-only, all metadata):
 *   POST https://api.dropboxapi.com/2/users/get_current_account   (account label)
 *   POST https://api.dropboxapi.com/2/users/get_space_usage       (EXACT bytes)
 *   POST https://api.dropboxapi.com/2/files/list_folder           (recursive)
 *   POST https://api.dropboxapi.com/2/files/list_folder/continue
 *
 * No content endpoint is ever called. /2/files/download and every sharing,
 * write and delete endpoint are outside the requested scopes by design.
 */
import { z } from "zod";
import { providerJson } from "./http";
import { formEncode } from "./http";
import {
  addToCategory,
  boundedProgress,
  categoryForExtension,
  emptyMetrics,
  extensionOf,
  widenDateRange,
  type ConnectorAdapter,
  type NormalizedMetrics,
  type OAuthTokens,
  type ScanPageResult,
} from "./types";
import { ProviderError } from "@/lib/logging";

const AUTH_URL = "https://www.dropbox.com/oauth2/authorize";
const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const API = "https://api.dropboxapi.com/2";

const FILES_STREAM = "dropbox:files";
const PAGE_LIMIT = 2000;
/** Bound how much we do inside one continuation request so a serverless invocation finishes. */
const MAX_PAGES_PER_INVOCATION = 4;

const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
  scope: z.string().optional(),
  account_id: z.string().optional(),
  token_type: z.string().optional(),
});

const accountSchema = z.object({
  account_id: z.string(),
  email: z.string().optional(),
  name: z.object({ display_name: z.string().optional() }).optional(),
});

const spaceUsageSchema = z.object({
  used: z.number(),
  allocation: z
    .object({
      ".tag": z.string(),
      allocated: z.number().optional(),
    })
    .passthrough()
    .optional(),
});

const listFolderSchema = z.object({
  entries: z.array(
    z
      .object({
        ".tag": z.string(),
        name: z.string(),
        size: z.number().optional(),
        server_modified: z.string().optional(),
        client_modified: z.string().optional(),
      })
      .passthrough()
  ),
  cursor: z.string(),
  has_more: z.boolean(),
});

function clientId() {
  return process.env.DROPBOX_CLIENT_ID ?? "";
}
function clientSecret() {
  return process.env.DROPBOX_CLIENT_SECRET ?? "";
}

export const dropboxAdapter: ConnectorAdapter = {
  key: "DROPBOX",
  label: "Dropbox",
  description: "File storage. Exact account volume plus file counts, types and date range.",
  unitType: "UNSTRUCTURED_BYTES",
  liveCapable: true,
  scopes: [
    { scope: "account_info.read", why: "Read the account name and email so we can label the connection." },
    { scope: "files.metadata.read", why: "List file names, sizes and modification dates. This scope cannot download file contents." },
  ],
  permissionExplainer: {
    willRead: [
      "Your total used and allocated storage, in bytes",
      "The number of files and folders in your account",
      "File extensions, sizes and modification dates",
    ],
    willNotRead: [
      "The contents of any file",
      "Anything you have shared with others, or their contents",
      "Nothing is downloaded, copied, modified or deleted",
    ],
  },

  isConfigured() {
    return Boolean(clientId() && clientSecret());
  },

  getAuthorizationUrl({ state, codeChallenge, redirectUri }) {
    const params = new URLSearchParams({
      client_id: clientId(),
      response_type: "code",
      redirect_uri: redirectUri,
      state,
      // Required to receive a refresh token; without it access tokens are short-lived
      // and the connection silently dies after four hours.
      token_access_type: "offline",
      scope: this.scopes.map((s) => s.scope).join(" "),
    });
    if (codeChallenge) {
      params.set("code_challenge", codeChallenge);
      params.set("code_challenge_method", "S256");
    }
    return `${AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode({ code, codeVerifier, redirectUri }) {
    // Dropbox's OAuth guide says to send the code_verifier "instead of" the
    // client_secret, but does not say whether a confidential client that sends
    // both is rejected. Rather than guess, try the standard confidential-client
    // exchange first and fall back once to the public-client PKCE form. A first
    // run that failed here would surface as an opaque "authorization failed",
    // which is the worst possible time to discover the ambiguity.
    const attempts: Record<string, string | undefined>[] = [
      {
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        client_id: clientId(),
        client_secret: clientSecret(),
        code_verifier: codeVerifier,
      },
    ];
    if (codeVerifier) {
      attempts.push({
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        client_id: clientId(),
        code_verifier: codeVerifier,
      });
    }

    let lastError: unknown;
    for (const body of attempts) {
      try {
        const raw = await providerJson(TOKEN_URL, {
          provider: "DROPBOX",
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: formEncode(body),
          maxAttempts: 1,
        });
        const parsed = tokenResponseSchema.parse(raw);
        const account = await getAccount(parsed.access_token);
        return toTokens(parsed, account);
      } catch (err) {
        // Only a rejection of the credential shape is worth retrying; anything
        // else (network, 5xx, an already-used code) would fail identically.
        lastError = err;
        const status = err instanceof ProviderError ? err.status : undefined;
        if (status !== 400) throw err;
      }
    }
    throw lastError;
  },

  async refreshToken({ refreshToken }) {
    const raw = await providerJson(TOKEN_URL, {
      provider: "DROPBOX",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formEncode({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId(),
        client_secret: clientSecret(),
      }),
    });
    const parsed = tokenResponseSchema.parse(raw);
    return {
      accessToken: parsed.access_token,
      // Dropbox does not reissue the refresh token on refresh; keep the old one.
      refreshToken: parsed.refresh_token ?? null,
      expiresAt: parsed.expires_in ? new Date(Date.now() + parsed.expires_in * 1000) : null,
      scopes: parsed.scope ?? null,
      accountLabel: null,
      accountDomain: null,
      externalId: parsed.account_id ?? null,
    };
  },

  async scanPage({ accessToken, state, partial }) {
    const metrics: NormalizedMetrics = { ...partial, categoryMix: { ...partial.categoryMix } };
    const next = { ...state };

    // Space usage is exact and cheap. Fetch it once, on the first page.
    if (!next["dropbox:space"]?.completed) {
      const usage = spaceUsageSchema.parse(
        await providerJson(`${API}/users/get_space_usage`, {
          provider: "DROPBOX",
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
        })
      );
      metrics.totalBytes = usage.used;
      metrics.confidence = "EXACT";
      metrics.method =
        "Exact account storage from the Dropbox space-usage API, with file counts and types enumerated from folder metadata.";
      const allocated = usage.allocation?.allocated;
      if (typeof allocated === "number" && allocated > 0) {
        metrics.caveats = dedupe([
          ...metrics.caveats,
          `Account allocation is ${formatGb(allocated)} GB; ${formatGb(usage.used)} GB is in use.`,
        ]);
      }
      next["dropbox:space"] = { cursor: null, completed: true, pageCount: 1 };
    }

    const fileState = next[FILES_STREAM] ?? { cursor: null, completed: false, pageCount: 0 };
    let pages = 0;
    let itemsSeen = 0;

    while (!fileState.completed && pages < MAX_PAGES_PER_INVOCATION) {
      const body = fileState.cursor
        ? JSON.stringify({ cursor: fileState.cursor })
        : JSON.stringify({
            path: "",
            recursive: true,
            include_deleted: false,
            include_media_info: false,
            include_has_explicit_shared_members: false,
            include_mounted_folders: true,
            include_non_downloadable_files: true,
            limit: PAGE_LIMIT,
          });
      const url = fileState.cursor ? `${API}/files/list_folder/continue` : `${API}/files/list_folder`;

      const page = listFolderSchema.parse(
        await providerJson(url, {
          provider: "DROPBOX",
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body,
        })
      );

      for (const entry of page.entries) {
        if (entry[".tag"] !== "file") continue;
        itemsSeen += 1;
        metrics.totalFiles += 1;
        // Only the extension is derived from the name; the name itself is discarded here.
        const category = categoryForExtension(extensionOf(entry.name));
        addToCategory(metrics.categoryMix, category, entry.size ?? 0);
        widenDateRange(metrics, entry.client_modified ?? entry.server_modified);
      }

      fileState.cursor = page.cursor;
      fileState.pageCount += 1;
      fileState.completed = !page.has_more;
      pages += 1;
    }

    next[FILES_STREAM] = fileState;
    const done = fileState.completed && next["dropbox:space"]?.completed === true;

    return {
      state: next,
      partial: metrics,
      hasMore: !done,
      itemsSeen,
      progressPct: boundedProgress(fileState.pageCount, done),
      progressLabel: done
        ? "Scan complete"
        : `Enumerating file metadata — ${metrics.totalFiles.toLocaleString()} files so far`,
    } satisfies ScanPageResult;
  },

  normalizeMetrics(partial) {
    const enumeratedBytes = Object.values(partial.categoryMix).reduce((a, b) => a + b.bytes, 0);
    const caveats = [...partial.caveats];
    // Enumerated file bytes and account space usage rarely match exactly: space
    // usage includes deleted-file retention, shared-folder accounting and version
    // history. Say so rather than quietly picking whichever number looks better.
    if (partial.totalBytes > 0 && enumeratedBytes > 0) {
      const delta = Math.abs(partial.totalBytes - enumeratedBytes) / partial.totalBytes;
      if (delta > 0.05) {
        caveats.push(
          `Enumerated files total ${formatGb(enumeratedBytes)} GB against ${formatGb(partial.totalBytes)} GB of reported account usage. The difference is normally version history, deleted-file retention and shared-folder accounting. The reported account usage is used as the headline figure.`
        );
      }
    }
    return { ...partial, caveats: dedupe(caveats) };
  },

  async disconnect({ accessToken }) {
    if (!accessToken) return;
    // Best effort: revocation failure must not block local teardown.
    try {
      await providerJson(`${API}/auth/token/revoke`, {
        provider: "DROPBOX",
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        maxAttempts: 1,
      });
    } catch {
      /* token already invalid or provider unreachable */
    }
  },
};

async function getAccount(accessToken: string) {
  try {
    const raw = await providerJson(`${API}/users/get_current_account`, {
      provider: "DROPBOX",
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return accountSchema.parse(raw);
  } catch (err) {
    if (err instanceof ProviderError && err.status === 403) return null;
    throw err;
  }
}

function toTokens(
  parsed: z.infer<typeof tokenResponseSchema>,
  account: z.infer<typeof accountSchema> | null
): OAuthTokens {
  const email = account?.email ?? null;
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token ?? null,
    expiresAt: parsed.expires_in ? new Date(Date.now() + parsed.expires_in * 1000) : null,
    scopes: parsed.scope ?? null,
    accountLabel: email ?? account?.name?.display_name ?? "Dropbox account",
    accountDomain: email?.split("@")[1] ?? null,
    externalId: account?.account_id ?? parsed.account_id ?? null,
  };
}

export function dropboxEmptyMetrics(): NormalizedMetrics {
  return emptyMetrics(
    "UNSTRUCTURED_BYTES",
    "Exact account storage from the Dropbox space-usage API.",
    "EXACT"
  );
}

function formatGb(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

function dedupe(a: string[]): string[] {
  return Array.from(new Set(a));
}
