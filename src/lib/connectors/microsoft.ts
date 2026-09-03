/**
 * Microsoft 365 connector — shippable with caveats.
 *
 * TWO scan paths, detected at runtime from the scopes the tenant actually granted:
 *
 *   admin      Requires Reports.Read.All, which is admin-consent-only. Uses the
 *              Graph usage reports for tenant-wide mailbox and OneDrive volume.
 *              Highest confidence.
 *   delegated  The DEFAULT. No admin required. /me/drive quota for OneDrive bytes
 *              and /me/mailFolders for exact per-folder message counts and byte
 *              sizes. Covers the signed-in user's own data only, which is a real
 *              limitation and is labelled as one everywhere it is displayed.
 *
 * The delegated path is complete and honest on its own. Nothing in this file
 * assumes the admin path is available.
 *
 * No message body, subject, recipient or file content is ever requested. Where a
 * byte size is unavailable it is sampled using the PidTagMessageSize extended
 * property (0x0E08), which returns a size integer and nothing else.
 */
import { z } from "zod";
import { providerJson, formEncode } from "./http";
import {
  addToCategory,
  boundedProgress,
  categoryForExtension,
  extensionOf,
  widenDateRange,
  type ConnectorAdapter,
  type NormalizedMetrics,
  type ScanPageResult,
} from "./types";
import { ProviderError } from "@/lib/logging";

const TENANT = process.env.MICROSOFT_TENANT_ID || "common";
const AUTH_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`;
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const GRAPH = "https://graph.microsoft.com/v1.0";

const MAX_PAGES_PER_INVOCATION = 4;
const MAIL_SAMPLE_SIZE = 200;

/** Optional scope. If the tenant admin has not consented, the app falls back. */
export const ADMIN_REPORTS_SCOPE = "Reports.Read.All";

const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

const meSchema = z.object({
  id: z.string(),
  displayName: z.string().nullish(),
  userPrincipalName: z.string().nullish(),
  mail: z.string().nullish(),
});

const driveSchema = z.object({
  quota: z
    .object({
      total: z.number().nullish(),
      used: z.number().nullish(),
      remaining: z.number().nullish(),
      deleted: z.number().nullish(),
    })
    .nullish(),
});

const mailFoldersSchema = z.object({
  value: z.array(
    z.object({
      id: z.string(),
      totalItemCount: z.number().nullish(),
      sizeInBytes: z.number().nullish(),
    })
  ),
  "@odata.nextLink": z.string().optional(),
  "@odata.deltaLink": z.string().optional(),
});

const driveDeltaSchema = z.object({
  value: z.array(
    z
      .object({
        id: z.string(),
        name: z.string().nullish(),
        size: z.number().nullish(),
        lastModifiedDateTime: z.string().nullish(),
        createdDateTime: z.string().nullish(),
        file: z.object({ mimeType: z.string().nullish() }).nullish(),
        folder: z.object({}).passthrough().nullish(),
        deleted: z.object({}).passthrough().nullish(),
      })
      .passthrough()
  ),
  "@odata.nextLink": z.string().optional(),
  "@odata.deltaLink": z.string().optional(),
});

const messagesSampleSchema = z.object({
  value: z.array(
    z.object({
      id: z.string(),
      receivedDateTime: z.string().nullish(),
      singleValueExtendedProperties: z
        .array(z.object({ id: z.string(), value: z.string().nullish() }))
        .nullish(),
    })
  ),
  "@odata.nextLink": z.string().optional(),
});

const mailboxUsageSchema = z.object({
  value: z.array(
    z
      .object({
        userPrincipalName: z.string().nullish(),
        storageUsedInBytes: z.union([z.number(), z.string()]).nullish(),
        itemCount: z.union([z.number(), z.string()]).nullish(),
        lastActivityDate: z.string().nullish(),
      })
      .passthrough()
  ),
});

const oneDriveUsageSchema = z.object({
  value: z.array(
    z
      .object({
        ownerPrincipalName: z.string().nullish(),
        storageUsedInBytes: z.union([z.number(), z.string()]).nullish(),
        fileCount: z.union([z.number(), z.string()]).nullish(),
        lastActivityDate: z.string().nullish(),
      })
      .passthrough()
  ),
});

function clientId() {
  return process.env.MICROSOFT_CLIENT_ID ?? "";
}
function clientSecret() {
  return process.env.MICROSOFT_CLIENT_SECRET ?? "";
}

const DELEGATED_SCOPES = ["openid", "profile", "offline_access", "User.Read", "Files.Read.All", "Mail.Read"];

export const microsoftAdapter: ConnectorAdapter = {
  key: "MICROSOFT",
  label: "Microsoft 365",
  description: "OneDrive and Exchange Online. Exact storage and mailbox counts.",
  unitType: "UNSTRUCTURED_BYTES",
  liveCapable: true,
  limitationNotice:
    "Without a tenant admin granting Reports.Read.All, the scan measures only the signed-in user's OneDrive and mailbox, not the whole tenant.",
  scopes: [
    { scope: "User.Read", why: "Read your name and email so we can label the connection." },
    { scope: "Files.Read.All", why: "Read OneDrive storage quota and file metadata — sizes, types and dates. No file is downloaded." },
    { scope: "Mail.Read", why: "Read mail folder counts and folder byte sizes. No message body, subject or recipient is read." },
    { scope: "offline_access", why: "Keep the connection alive without asking you to sign in again." },
    { scope: `${ADMIN_REPORTS_SCOPE} (optional)`, why: "Tenant-wide usage reports. Requires a Microsoft 365 admin to consent. Without it the scan covers only your own account." },
  ],
  permissionExplainer: {
    willRead: [
      "Your OneDrive storage quota — used and total bytes",
      "File sizes, extensions and modification dates in your OneDrive",
      "The number of messages in each mail folder and the folder's total size",
    ],
    willNotRead: [
      "The subject, body, sender or recipient of any email",
      "The contents of any file or attachment",
      "Anyone else's mailbox, unless a tenant admin grants the reports permission",
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
      response_mode: "query",
      // Reports.Read.All is deliberately NOT requested here. Including an
      // admin-consent-only scope in the default request makes the whole consent
      // screen fail for a non-admin user. It is requested separately.
      scope: DELEGATED_SCOPES.join(" "),
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
      provider: "MICROSOFT",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formEncode({
        client_id: clientId(),
        client_secret: clientSecret(),
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
        scope: DELEGATED_SCOPES.join(" "),
      }),
    });
    const parsed = tokenResponseSchema.parse(raw);
    const me = await getMe(parsed.access_token);
    const scanPath = detectScanPath(parsed.scope ?? null);
    const upn = me?.mail ?? me?.userPrincipalName ?? null;
    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token ?? null,
      expiresAt: parsed.expires_in ? new Date(Date.now() + parsed.expires_in * 1000) : null,
      scopes: parsed.scope ?? null,
      accountLabel: upn ?? me?.displayName ?? "Microsoft 365 account",
      accountDomain: upn?.split("@")[1] ?? null,
      externalId: me?.id ?? null,
      scanPath,
    };
  },

  async refreshToken({ refreshToken }) {
    const raw = await providerJson(TOKEN_URL, {
      provider: "MICROSOFT",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formEncode({
        client_id: clientId(),
        client_secret: clientSecret(),
        refresh_token: refreshToken,
        grant_type: "refresh_token",
        scope: DELEGATED_SCOPES.join(" "),
      }),
    });
    const parsed = tokenResponseSchema.parse(raw);
    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token ?? refreshToken,
      expiresAt: parsed.expires_in ? new Date(Date.now() + parsed.expires_in * 1000) : null,
      scopes: parsed.scope ?? null,
      accountLabel: null,
      accountDomain: null,
      externalId: null,
      scanPath: detectScanPath(parsed.scope ?? null),
    };
  },

  async scanPage({ accessToken, state, partial, scanPath }) {
    if (scanPath === "admin") {
      return scanAdminPath(accessToken, state, partial);
    }
    return scanDelegatedPath(accessToken, state, partial);
  },

  normalizeMetrics(partial) {
    return { ...partial, caveats: Array.from(new Set(partial.caveats)) };
  },

  async disconnect() {
    // Microsoft has no delegated token-revocation endpoint an app can call for a
    // single grant; the user removes the app at myapplications.microsoft.com.
    // Local teardown still deletes every stored credential.
  },
};

/** Reports.Read.All is admin-consent-only, so its presence is the path signal. */
export function detectScanPath(grantedScopes: string | null): "admin" | "delegated" {
  if (!grantedScopes) return "delegated";
  return grantedScopes.split(/\s+/).some((s) => s.toLowerCase() === ADMIN_REPORTS_SCOPE.toLowerCase())
    ? "admin"
    : "delegated";
}

// ---------------------------------------------------------------- delegated

async function scanDelegatedPath(
  accessToken: string,
  state: Record<string, { cursor: string | null; completed: boolean; pageCount: number; sampling?: Record<string, unknown> }>,
  partial: NormalizedMetrics
): Promise<ScanPageResult> {
  const metrics: NormalizedMetrics = { ...partial, categoryMix: { ...partial.categoryMix } };
  const next = { ...state };
  const auth = { Authorization: `Bearer ${accessToken}` };
  let itemsSeen = 0;

  metrics.method =
    "Delegated scan: exact OneDrive quota and exact mail folder counts and sizes for the signed-in account only.";
  metrics.confidence = "EXACT";
  metrics.caveats = dedupe([
    ...metrics.caveats,
    "This scan covers only the signed-in user's OneDrive and mailbox. Tenant-wide measurement needs a Microsoft 365 admin to grant the Reports.Read.All permission.",
  ]);

  // --- OneDrive quota (exact) ------------------------------------------------
  if (!next["ms:drive"]?.completed) {
    try {
      const drive = driveSchema.parse(
        await providerJson(`${GRAPH}/me/drive?$select=quota`, { provider: "MICROSOFT", headers: auth })
      );
      metrics.totalBytes += drive.quota?.used ?? 0;
      if (drive.quota?.total) {
        metrics.caveats.push(
          `OneDrive allocation is ${gb(drive.quota.total)} GB; ${gb(drive.quota.used ?? 0)} GB is in use.`
        );
      }
    } catch (err) {
      if (err instanceof ProviderError && err.status === 403) {
        metrics.scopeLimited = true;
        metrics.caveats.push("OneDrive was not measured because the Files.Read.All permission was not granted.");
      } else throw err;
    }
    next["ms:drive"] = { cursor: null, completed: true, pageCount: 1 };
  }

  // --- OneDrive file categories ---------------------------------------------
  const driveItems = next["ms:driveitems"] ?? { cursor: null, completed: false, pageCount: 0 };
  let pages = 0;
  while (!driveItems.completed && pages < MAX_PAGES_PER_INVOCATION) {
    try {
      const url =
        driveItems.cursor ??
        `${GRAPH}/me/drive/root/delta?$select=id,name,size,lastModifiedDateTime,createdDateTime,file,folder,deleted&$top=200`;
      const page = driveDeltaSchema.parse(
        await providerJson(url, { provider: "MICROSOFT", headers: auth })
      );
      for (const item of page.value) {
        if (item.folder || item.deleted || !item.file) continue;
        itemsSeen += 1;
        metrics.totalFiles += 1;
        const category = categoryForExtension(item.name ? extensionOf(item.name) : null);
        addToCategory(metrics.categoryMix, category, item.size ?? 0);
        widenDateRange(metrics, item.lastModifiedDateTime ?? item.createdDateTime ?? undefined);
      }
      const nextLink = page["@odata.nextLink"];
      driveItems.cursor = nextLink ?? null;
      driveItems.pageCount += 1;
      driveItems.completed = !nextLink;
    } catch (err) {
      if (err instanceof ProviderError && (err.status === 403 || err.status === 404)) {
        metrics.scopeLimited = true;
        metrics.caveats.push("OneDrive file types were not enumerated because the permission was not granted.");
        driveItems.completed = true;
      } else throw err;
    }
    pages += 1;
  }
  next["ms:driveitems"] = driveItems;

  // --- Mail folders (exact counts and, where present, exact byte sizes) ------
  const mail = next["ms:mailfolders"] ?? { cursor: null, completed: false, pageCount: 0 };
  if (driveItems.completed && !mail.completed) {
    try {
      let sizeMissing = false;
      let messageCount = 0;
      let mailBytes = 0;
      let url =
        mail.cursor ??
        `${GRAPH}/me/mailFolders/delta?$select=id,displayName,totalItemCount,sizeInBytes`;
      let localPages = 0;
      while (url && localPages < MAX_PAGES_PER_INVOCATION) {
        const page = mailFoldersSchema.parse(
          await providerJson(url, { provider: "MICROSOFT", headers: auth })
        );
        for (const folder of page.value) {
          messageCount += folder.totalItemCount ?? 0;
          if (typeof folder.sizeInBytes === "number") mailBytes += folder.sizeInBytes;
          else if ((folder.totalItemCount ?? 0) > 0) sizeMissing = true;
        }
        itemsSeen += page.value.length;
        url = page["@odata.nextLink"] ?? "";
        localPages += 1;
        mail.pageCount += 1;
      }
      mail.cursor = url || null;
      mail.completed = !url;

      if (mail.completed) {
        metrics.totalRecords += messageCount;
        addToCategory(metrics.categoryMix, "email", mailBytes, messageCount);
        metrics.totalBytes += mailBytes;
        metrics.caveats.push(
          `Mailbox contains ${messageCount.toLocaleString()} messages across all folders (exact folder counts from Microsoft Graph).`
        );
        if (sizeMissing) {
          // Fall back to a bounded metadata sample using PidTagMessageSize. The
          // extended property returns an integer byte count and nothing else.
          const sampled = await sampleMailBytes(accessToken, metrics);
          if (sampled) {
            metrics.confidence = "SAMPLED";
            metrics.caveats.push(
              `Some mail folders did not report a byte size, so mailbox volume was estimated from a ${sampled.sampleSize}-message metadata sample (average ${Math.round(sampled.avgBytes / 1024)} KB per message). Message counts remain exact.`
            );
            const estimate = Math.round(sampled.avgBytes * messageCount);
            metrics.totalBytes += estimate;
            addToCategory(metrics.categoryMix, "email", estimate, 0);
            mail.sampling = { sampleSize: sampled.sampleSize, avgBytes: sampled.avgBytes };
          }
        }
      }
    } catch (err) {
      if (err instanceof ProviderError && err.status === 403) {
        metrics.scopeLimited = true;
        metrics.caveats.push("The mailbox was not measured because the Mail.Read permission was not granted.");
        mail.completed = true;
      } else throw err;
    }
    next["ms:mailfolders"] = mail;
  }

  const done = next["ms:drive"]?.completed && driveItems.completed && (next["ms:mailfolders"]?.completed ?? false);
  if (metrics.scopeLimited) metrics.confidence = "SCOPE_LIMITED";

  return {
    state: next,
    partial: metrics,
    hasMore: !done,
    itemsSeen,
    progressPct: boundedProgress(driveItems.pageCount + (mail.pageCount ?? 0), Boolean(done)),
    progressLabel: done
      ? "Scan complete"
      : `Reading OneDrive and mailbox metadata — ${metrics.totalFiles.toLocaleString()} files so far`,
  };
}

async function sampleMailBytes(
  accessToken: string,
  metrics: NormalizedMetrics
): Promise<{ sampleSize: number; avgBytes: number } | null> {
  try {
    const url =
      `${GRAPH}/me/messages?$top=${MAIL_SAMPLE_SIZE}&$select=id,receivedDateTime` +
      `&$expand=singleValueExtendedProperties($filter=id eq 'Long 0x0E08')`;
    const page = messagesSampleSchema.parse(
      await providerJson(url, { provider: "MICROSOFT", headers: { Authorization: `Bearer ${accessToken}` } })
    );
    let total = 0;
    let n = 0;
    for (const m of page.value) {
      widenDateRange(metrics, m.receivedDateTime ?? undefined);
      const prop = m.singleValueExtendedProperties?.find((p) => p.id.includes("0x0E08"));
      const v = prop?.value ? Number(prop.value) : NaN;
      if (Number.isFinite(v) && v > 0) {
        total += v;
        n += 1;
      }
    }
    if (n === 0) return null;
    return { sampleSize: n, avgBytes: total / n };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- admin

async function scanAdminPath(
  accessToken: string,
  state: Record<string, { cursor: string | null; completed: boolean; pageCount: number; sampling?: Record<string, unknown> }>,
  partial: NormalizedMetrics
): Promise<ScanPageResult> {
  const metrics: NormalizedMetrics = { ...partial, categoryMix: { ...partial.categoryMix } };
  const next = { ...state };
  const auth = { Authorization: `Bearer ${accessToken}` };
  let itemsSeen = 0;

  metrics.method =
    "Tenant-wide scan using the Microsoft Graph usage reports (Reports.Read.All), covering every mailbox and OneDrive account in the tenant.";
  metrics.confidence = "EXACT";

  // The report endpoints return CSV behind a 302 by default; $format=application/json
  // returns the rows directly.
  if (!next["ms:report:onedrive"]?.completed) {
    const rows = oneDriveUsageSchema.parse(
      await providerJson(
        `${GRAPH}/reports/getOneDriveUsageAccountDetail(period='D30')?$format=application/json`,
        { provider: "MICROSOFT", headers: auth }
      )
    );
    let concealed = false;
    for (const r of rows.value) {
      itemsSeen += 1;
      const bytes = num(r.storageUsedInBytes);
      const files = num(r.fileCount);
      metrics.totalBytes += bytes;
      metrics.totalFiles += files;
      addToCategory(metrics.categoryMix, "documents", bytes, files);
      widenDateRange(metrics, r.lastActivityDate ? `${r.lastActivityDate}T00:00:00.000Z` : undefined);
      if (r.ownerPrincipalName && !r.ownerPrincipalName.includes("@")) concealed = true;
    }
    if (concealed) {
      // Tenants can enable "display concealed user information in reports". The
      // totals stay correct; only the per-user identifiers are pseudonymised.
      metrics.caveats.push(
        "This tenant returns pseudonymised identifiers in usage reports. Aggregate volumes are unaffected; per-account attribution is not available."
      );
    }
    next["ms:report:onedrive"] = { cursor: null, completed: true, pageCount: 1 };
  }

  if (!next["ms:report:mailbox"]?.completed) {
    const rows = mailboxUsageSchema.parse(
      await providerJson(
        `${GRAPH}/reports/getMailboxUsageDetail(period='D30')?$format=application/json`,
        { provider: "MICROSOFT", headers: auth }
      )
    );
    let mailBytes = 0;
    let mailItems = 0;
    for (const r of rows.value) {
      itemsSeen += 1;
      mailBytes += num(r.storageUsedInBytes);
      mailItems += num(r.itemCount);
      widenDateRange(metrics, r.lastActivityDate ? `${r.lastActivityDate}T00:00:00.000Z` : undefined);
    }
    metrics.totalBytes += mailBytes;
    metrics.totalRecords += mailItems;
    addToCategory(metrics.categoryMix, "email", mailBytes, mailItems);
    metrics.caveats.push(
      `Tenant mailboxes hold ${mailItems.toLocaleString()} items totalling ${gb(mailBytes)} GB.`
    );
    next["ms:report:mailbox"] = { cursor: null, completed: true, pageCount: 1 };
  }

  metrics.caveats.push(
    "OneDrive file-type breakdown is not available from the tenant usage reports, so category mix is approximate on the admin path."
  );

  return {
    state: next,
    partial: metrics,
    hasMore: false,
    itemsSeen,
    progressPct: 100,
    progressLabel: "Scan complete",
  };
}

// ---------------------------------------------------------------- helpers

async function getMe(accessToken: string) {
  try {
    const raw = await providerJson(`${GRAPH}/me?$select=id,displayName,userPrincipalName,mail`, {
      provider: "MICROSOFT",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return meSchema.parse(raw);
  } catch {
    return null;
  }
}

function num(v: number | string | null | undefined): number {
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
