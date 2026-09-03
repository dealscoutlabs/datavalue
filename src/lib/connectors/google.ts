/**
 * Google Workspace connector — implemented in full, but DEMO-ONLY in this build.
 *
 * The code paths below are the real ones. What makes this connector demo-only is
 * not the implementation, it is Google's policy:
 *
 *   - drive.metadata.readonly and gmail.metadata are both RESTRICTED scopes.
 *   - Launching publicly on a restricted scope requires OAuth verification plus
 *     an annual third-party security assessment (CASA), re-done every 12 months.
 *   - The stated product purpose — inventorying a business's data to assess
 *     whether it could be licensed — carries a real risk of rejection as a
 *     prohibited use case under Google's API Services User Data Policy and its
 *     Limited Use requirements, which restrict transferring user data except in
 *     narrow circumstances.
 *
 * In testing mode the app may add up to 100 test users, which is enough to run a
 * demo and nothing more. See README, "Google: demo-only, not launchable as
 * designed."
 */
import { z } from "zod";
import { providerJson, formEncode, sleep } from "./http";
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

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const DRIVE = "https://www.googleapis.com/drive/v3";
const GMAIL = "https://gmail.googleapis.com/gmail/v1";

const GMAIL_SAMPLE_SIZE = 100;
/** Gmail's per-user quota is measured per second; keep well under it. */
const GMAIL_SPACING_MS = 120;
const MAX_PAGES_PER_INVOCATION = 3;

const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
  scope: z.string().optional(),
  id_token: z.string().optional(),
});

const aboutSchema = z.object({
  user: z.object({ emailAddress: z.string().nullish(), displayName: z.string().nullish() }).nullish(),
  storageQuota: z
    .object({
      limit: z.string().nullish(),
      usage: z.string().nullish(),
      usageInDrive: z.string().nullish(),
      usageInDriveTrash: z.string().nullish(),
    })
    .nullish(),
});

const filesListSchema = z.object({
  files: z.array(
    z.object({
      id: z.string(),
      mimeType: z.string().nullish(),
      size: z.string().nullish(),
      modifiedTime: z.string().nullish(),
      createdTime: z.string().nullish(),
      fileExtension: z.string().nullish(),
    })
  ),
  nextPageToken: z.string().nullish(),
});

const gmailProfileSchema = z.object({
  emailAddress: z.string().nullish(),
  messagesTotal: z.number().nullish(),
  threadsTotal: z.number().nullish(),
});

const gmailListSchema = z.object({
  messages: z.array(z.object({ id: z.string() })).nullish(),
  nextPageToken: z.string().nullish(),
});

const gmailMessageSchema = z.object({
  id: z.string(),
  sizeEstimate: z.number().nullish(),
  internalDate: z.string().nullish(),
});

function clientId() {
  return process.env.GOOGLE_CLIENT_ID ?? "";
}
function clientSecret() {
  return process.env.GOOGLE_CLIENT_SECRET ?? "";
}

export const googleAdapter: ConnectorAdapter = {
  key: "GOOGLE",
  label: "Google Workspace",
  description: "Drive and Gmail. Exact storage quota and exact message counts.",
  unitType: "UNSTRUCTURED_BYTES",
  // Real OAuth is wired, but this build must not present Google as launchable.
  liveCapable: false,
  limitationNotice:
    "Demo only. Google classes both scopes this needs as restricted, which requires OAuth verification plus an annual third-party security assessment before any public launch.",
  scopes: [
    { scope: "https://www.googleapis.com/auth/drive.metadata.readonly", why: "Read Drive storage quota and file metadata — sizes, types and dates. This scope cannot read file contents. Restricted scope." },
    { scope: "https://www.googleapis.com/auth/gmail.metadata", why: "Read mailbox message and thread totals and per-message size estimates. This scope cannot read message bodies or subjects. Restricted scope." },
  ],
  permissionExplainer: {
    willRead: [
      "Your Drive storage quota — total, used, used in Drive, used in Drive trash",
      "File sizes, MIME types and modification dates",
      "Your total Gmail message and thread counts",
      "A size estimate for a bounded sample of messages",
    ],
    willNotRead: [
      "The contents of any Drive file",
      "The body, subject, sender or recipient of any email",
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
      scope: this.scopes.map((s) => s.scope).join(" "),
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
      provider: "GOOGLE",
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
    const about = await getAbout(parsed.access_token);
    const email = about?.user?.emailAddress ?? null;
    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token ?? null,
      expiresAt: parsed.expires_in ? new Date(Date.now() + parsed.expires_in * 1000) : null,
      scopes: parsed.scope ?? null,
      accountLabel: email ?? about?.user?.displayName ?? "Google account",
      accountDomain: email?.split("@")[1] ?? null,
      externalId: email,
    };
  },

  async refreshToken({ refreshToken }) {
    const raw = await providerJson(TOKEN_URL, {
      provider: "GOOGLE",
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
    };
  },

  async scanPage({ accessToken, state, partial }) {
    const metrics: NormalizedMetrics = { ...partial, categoryMix: { ...partial.categoryMix } };
    const next = { ...state };
    const auth = { Authorization: `Bearer ${accessToken}` };
    let itemsSeen = 0;

    // --- Drive quota (exact) -------------------------------------------------
    if (!next["google:about"]?.completed) {
      const about = aboutSchema.parse(
        await providerJson(`${DRIVE}/about?fields=user,storageQuota`, { provider: "GOOGLE", headers: auth })
      );
      const usageInDrive = big(about.storageQuota?.usageInDrive);
      const usage = big(about.storageQuota?.usage);
      const limit = big(about.storageQuota?.limit);
      metrics.totalBytes += usageInDrive;
      metrics.confidence = "EXACT";
      metrics.method =
        "Exact Drive storage quota from the Drive about endpoint, with exact Gmail message counts from the Gmail profile endpoint.";
      if (limit > 0) {
        metrics.caveats.push(`Google account allocation is ${gb(limit)} GB.`);
      }
      if (usage > 0) {
        // usage spans Drive + Gmail + Photos. Subtracting to derive a Gmail figure
        // is approximate and is not used as a headline number anywhere.
        metrics.caveats.push(
          `Total Google account usage is ${gb(usage)} GB across Drive, Gmail and Photos combined; ${gb(usageInDrive)} GB of that is Drive. Google does not break the remainder down by product, so any Gmail figure derived by subtraction would be approximate and is not used here.`
        );
      }
      next["google:about"] = { cursor: null, completed: true, pageCount: 1 };
    }

    // --- Drive file categories ----------------------------------------------
    const files = next["google:files"] ?? { cursor: null, completed: false, pageCount: 0 };
    let pages = 0;
    let nativeDocs = 0;
    while (!files.completed && pages < MAX_PAGES_PER_INVOCATION) {
      const params = new URLSearchParams({
        pageSize: "1000",
        fields: "nextPageToken,files(id,mimeType,size,modifiedTime,createdTime,fileExtension)",
        q: "trashed = false",
        includeItemsFromAllDrives: "true",
        supportsAllDrives: "true",
        corpora: "user",
      });
      if (files.cursor) params.set("pageToken", files.cursor);
      const page = filesListSchema.parse(
        await providerJson(`${DRIVE}/files?${params.toString()}`, { provider: "GOOGLE", headers: auth })
      );
      for (const f of page.files) {
        if (f.mimeType === "application/vnd.google-apps.folder") continue;
        itemsSeen += 1;
        metrics.totalFiles += 1;
        const size = big(f.size);
        // Google-native docs (Docs, Sheets, Slides) report no ordinary file size.
        if (f.mimeType?.startsWith("application/vnd.google-apps") && size === 0) nativeDocs += 1;
        addToCategory(metrics.categoryMix, categoryForMime(f.mimeType, f.fileExtension), size);
        widenDateRange(metrics, f.modifiedTime ?? f.createdTime ?? undefined);
      }
      files.cursor = page.nextPageToken ?? null;
      files.pageCount += 1;
      files.completed = !files.cursor;
      pages += 1;
    }
    if (nativeDocs > 0) {
      metrics.caveats.push(
        `${nativeDocs.toLocaleString()} Google-native documents (Docs, Sheets, Slides) report no ordinary file size through the Drive API, so they are counted but contribute no bytes.`
      );
    }
    next["google:files"] = files;

    // --- Gmail counts (exact) + bounded size sample --------------------------
    const gmail = next["google:gmail"] ?? { cursor: null, completed: false, pageCount: 0 };
    if (files.completed && !gmail.completed) {
      try {
        const profile = gmailProfileSchema.parse(
          await providerJson(`${GMAIL}/users/me/profile`, { provider: "GOOGLE", headers: auth })
        );
        const total = profile.messagesTotal ?? 0;
        metrics.totalRecords += total;

        const sample = await sampleGmailSizes(accessToken, metrics);
        if (sample && total > 0) {
          const estimate = Math.round(sample.avgBytes * total);
          metrics.totalBytes += estimate;
          addToCategory(metrics.categoryMix, "email", estimate, total);
          metrics.confidence = "SAMPLED";
          metrics.caveats.push(
            `Gmail holds ${total.toLocaleString()} messages and ${(profile.threadsTotal ?? 0).toLocaleString()} threads — both exact. Mailbox bytes are estimated from a ${sample.sampleSize}-message size sample averaging ${Math.round(sample.avgBytes / 1024)} KB, so the byte figure is an estimate while the counts are not.`
          );
          gmail.sampling = { sampleSize: sample.sampleSize, avgBytes: sample.avgBytes };
        } else {
          addToCategory(metrics.categoryMix, "email", 0, total);
          metrics.caveats.push(
            `Gmail holds ${total.toLocaleString()} messages (exact). No size sample could be taken, so mailbox bytes are not reported.`
          );
        }
      } catch (err) {
        if (err instanceof ProviderError && (err.status === 403 || err.status === 401)) {
          metrics.scopeLimited = true;
          metrics.caveats.push("Gmail was not measured because the gmail.metadata permission was not granted.");
        } else throw err;
      }
      gmail.completed = true;
      next["google:gmail"] = gmail;
    }

    const done = files.completed && gmail.completed;
    if (metrics.scopeLimited) metrics.confidence = "SCOPE_LIMITED";

    return {
      state: next,
      partial: metrics,
      hasMore: !done,
      itemsSeen,
      progressPct: boundedProgress(files.pageCount, done),
      progressLabel: done
        ? "Scan complete"
        : `Reading Drive and Gmail metadata — ${metrics.totalFiles.toLocaleString()} files so far`,
    } satisfies ScanPageResult;
  },

  normalizeMetrics(partial) {
    return { ...partial, caveats: Array.from(new Set(partial.caveats)) };
  },

  async disconnect({ accessToken }) {
    if (!accessToken) return;
    try {
      await providerJson(REVOKE_URL, {
        provider: "GOOGLE",
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

async function sampleGmailSizes(accessToken: string, metrics: NormalizedMetrics) {
  const auth = { Authorization: `Bearer ${accessToken}` };
  const list = gmailListSchema.parse(
    await providerJson(`${GMAIL}/users/me/messages?maxResults=${GMAIL_SAMPLE_SIZE}`, {
      provider: "GOOGLE",
      headers: auth,
    })
  );
  const ids = (list.messages ?? []).map((m) => m.id);
  if (ids.length === 0) return null;

  let total = 0;
  let n = 0;
  for (const id of ids) {
    // format=metadata returns sizeEstimate and headers only; we read the size and
    // the internal date and discard everything else without persisting it.
    await sleep(GMAIL_SPACING_MS);
    try {
      const msg = gmailMessageSchema.parse(
        await providerJson(
          `${GMAIL}/users/me/messages/${id}?format=metadata&metadataHeaders=Date`,
          { provider: "GOOGLE", headers: auth }
        )
      );
      if (msg.sizeEstimate && msg.sizeEstimate > 0) {
        total += msg.sizeEstimate;
        n += 1;
      }
      if (msg.internalDate) {
        widenDateRange(metrics, new Date(Number(msg.internalDate)).toISOString());
      }
    } catch {
      // A single failed sample must not fail the scan; the sample just gets smaller.
    }
  }
  return n === 0 ? null : { sampleSize: n, avgBytes: total / n };
}

async function getAbout(accessToken: string) {
  try {
    const raw = await providerJson(`${DRIVE}/about?fields=user,storageQuota`, {
      provider: "GOOGLE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return aboutSchema.parse(raw);
  } catch {
    return null;
  }
}

function categoryForMime(mime: string | null | undefined, ext: string | null | undefined) {
  if (mime === "application/vnd.google-apps.document") return "documents" as const;
  if (mime === "application/vnd.google-apps.spreadsheet") return "spreadsheets" as const;
  if (mime === "application/vnd.google-apps.presentation") return "presentations" as const;
  if (mime?.startsWith("image/")) return "images" as const;
  if (mime?.startsWith("video/")) return "video" as const;
  if (mime?.startsWith("audio/")) return "audio" as const;
  return categoryForExtension(ext ?? null);
}

function big(v: string | null | undefined): number {
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function gb(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}
