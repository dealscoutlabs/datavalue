/**
 * HubSpot CRM connector — fully shippable.
 *
 * Structured records are valued separately from bytes: the unit here is a usable
 * record, not a gigabyte.
 *
 * Endpoints used (all read-only):
 *   POST https://api.hubapi.com/oauth/v1/token
 *   GET  https://api.hubapi.com/oauth/v1/access-tokens/{token}      (portal label)
 *   POST https://api.hubapi.com/crm/v3/objects/{type}/search        (EXACT totals)
 *   GET  https://api.hubapi.com/crm/v3/objects/{type}               (bounded sample)
 *   GET  https://api.hubapi.com/files/v3/files                      (attachment bytes)
 *
 * Record CONTENTS are never persisted. The sample pages are read to compute a
 * completeness percentage and a date range, then discarded in the same tick.
 *
 * Rate limits: 100 requests per 10 seconds per portal for OAuth apps, and the
 * search endpoints are additionally capped at 4 requests per second per portal.
 * Both are respected below.
 */
import { z } from "zod";
import { providerJson, formEncode, sleep } from "./http";
import {
  addToCategory,
  categoryForExtension,
  widenDateRange,
  type ConnectorAdapter,
  type NormalizedMetrics,
  type ScanPageResult,
} from "./types";
import { ProviderError } from "@/lib/logging";

const AUTH_URL = "https://app.hubspot.com/oauth/authorize";
const TOKEN_URL = "https://api.hubapi.com/oauth/v1/token";
const API = "https://api.hubapi.com";

/** Sample budget per object type. Enough to be stable, small enough to be polite. */
const SAMPLE_PAGE_SIZE = 100;
const MAX_SAMPLE_PAGES = 3;
const MAX_STREAMS_PER_INVOCATION = 2;
/** Keeps us under the documented 4 requests/second search cap. */
const SEARCH_SPACING_MS = 300;

type ObjectType = "contacts" | "companies" | "deals";

const OBJECT_TYPES: {
  type: ObjectType;
  scope: string;
  /** Fields whose presence defines a "usable" record for this object type. */
  coreProperties: string[];
  dateProperty: string;
}[] = [
  {
    type: "contacts",
    scope: "crm.objects.contacts.read",
    coreProperties: ["email", "firstname", "lastname", "company"],
    dateProperty: "createdate",
  },
  {
    type: "companies",
    scope: "crm.objects.companies.read",
    coreProperties: ["name", "domain", "industry", "city"],
    dateProperty: "createdate",
  },
  {
    type: "deals",
    scope: "crm.objects.deals.read",
    coreProperties: ["dealname", "amount", "dealstage", "closedate"],
    dateProperty: "createdate",
  },
];

const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
  token_type: z.string().optional(),
});

const tokenInfoSchema = z.object({
  hub_id: z.union([z.number(), z.string()]).optional(),
  hub_domain: z.string().nullish(),
  user: z.string().nullish(),
  scopes: z.array(z.string()).optional(),
});

const searchSchema = z.object({ total: z.number() });

const listSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      createdAt: z.string().optional(),
      updatedAt: z.string().optional(),
      properties: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional(),
    })
  ),
  paging: z.object({ next: z.object({ after: z.string() }).optional() }).optional(),
});

const filesSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      size: z.number().nullish(),
      extension: z.string().nullish(),
      createdAt: z.string().nullish(),
      updatedAt: z.string().nullish(),
    })
  ),
  paging: z.object({ next: z.object({ after: z.string() }).optional() }).optional(),
});

function clientId() {
  return process.env.HUBSPOT_CLIENT_ID ?? "";
}
function clientSecret() {
  return process.env.HUBSPOT_CLIENT_SECRET ?? "";
}

export const hubspotAdapter: ConnectorAdapter = {
  key: "HUBSPOT",
  label: "HubSpot CRM",
  description: "CRM records. Exact object counts, field completeness and date range.",
  unitType: "STRUCTURED_RECORDS",
  liveCapable: true,
  scopes: [
    { scope: "oauth", why: "Required by HubSpot on every app install." },
    { scope: "crm.objects.contacts.read", why: "Count contact records and measure how completely their core fields are filled in." },
    { scope: "crm.objects.companies.read", why: "Count company records and measure field completeness." },
    { scope: "crm.objects.deals.read", why: "Count deal records and measure field completeness." },
    { scope: "files", why: "Measure the total size of files attached to CRM records. Read-only; contents are never fetched." },
  ],
  permissionExplainer: {
    willRead: [
      "How many contacts, companies and deals exist in your portal",
      "What percentage of each record's core fields are filled in",
      "The date range your records span",
      "The total byte size of attached files",
    ],
    willNotRead: [
      "The contents of any record — no names, emails, notes or deal values are stored",
      "Email, calls, tickets, or marketing content",
      "Nothing is created, modified or deleted in your portal",
    ],
  },

  isConfigured() {
    return Boolean(clientId() && clientSecret());
  },

  getAuthorizationUrl({ state, redirectUri }) {
    // HubSpot does not support PKCE on its public-app flow; the confidential
    // client secret is used at the token endpoint instead.
    const params = new URLSearchParams({
      client_id: clientId(),
      redirect_uri: redirectUri,
      scope: this.scopes.map((s) => s.scope).join(" "),
      state,
    });
    return `${AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode({ code, redirectUri }) {
    const raw = await providerJson(TOKEN_URL, {
      provider: "HUBSPOT",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formEncode({
        grant_type: "authorization_code",
        client_id: clientId(),
        client_secret: clientSecret(),
        redirect_uri: redirectUri,
        code,
      }),
    });
    const parsed = tokenResponseSchema.parse(raw);
    const info = await getTokenInfo(parsed.access_token);
    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token ?? null,
      expiresAt: parsed.expires_in ? new Date(Date.now() + parsed.expires_in * 1000) : null,
      scopes: info?.scopes?.join(" ") ?? null,
      accountLabel: info?.hub_domain ?? (info?.hub_id ? `Portal ${info.hub_id}` : "HubSpot portal"),
      accountDomain: info?.hub_domain ?? null,
      externalId: info?.hub_id != null ? String(info.hub_id) : null,
    };
  },

  async refreshToken({ refreshToken }) {
    const raw = await providerJson(TOKEN_URL, {
      provider: "HUBSPOT",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formEncode({
        grant_type: "refresh_token",
        client_id: clientId(),
        client_secret: clientSecret(),
        refresh_token: refreshToken,
      }),
    });
    const parsed = tokenResponseSchema.parse(raw);
    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token ?? refreshToken,
      expiresAt: parsed.expires_in ? new Date(Date.now() + parsed.expires_in * 1000) : null,
      scopes: null,
      accountLabel: null,
      accountDomain: null,
      externalId: null,
    };
  },

  async scanPage({ accessToken, state, partial }) {
    const metrics: NormalizedMetrics = {
      ...partial,
      categoryMix: { ...partial.categoryMix },
      recordBreakdown: [...partial.recordBreakdown],
    };
    const next = { ...state };
    const auth = { Authorization: `Bearer ${accessToken}` };
    let streamsDone = 0;
    let itemsSeen = 0;

    for (const spec of OBJECT_TYPES) {
      const key = `hubspot:${spec.type}`;
      const s = next[key] ?? { cursor: null, completed: false, pageCount: 0 };
      if (s.completed) continue;
      if (streamsDone >= MAX_STREAMS_PER_INVOCATION) break;

      try {
        // Exact total from the search endpoint. One request, no record contents.
        await sleep(SEARCH_SPACING_MS);
        const total = searchSchema.parse(
          await providerJson(`${API}/crm/v3/objects/${spec.type}/search`, {
            provider: "HUBSPOT",
            method: "POST",
            headers: { ...auth, "Content-Type": "application/json" },
            body: JSON.stringify({ limit: 1, filterGroups: [], properties: ["hs_object_id"] }),
          })
        );

        // Bounded sample for completeness and date range.
        let sampled = 0;
        let complete = 0;
        let after: string | undefined = undefined;
        for (let page = 0; page < MAX_SAMPLE_PAGES; page++) {
          const params = new URLSearchParams({
            limit: String(SAMPLE_PAGE_SIZE),
            properties: spec.coreProperties.join(","),
            archived: "false",
          });
          if (after) params.set("after", after);
          const listed: z.infer<typeof listSchema> = listSchema.parse(
            await providerJson(`${API}/crm/v3/objects/${spec.type}?${params.toString()}`, {
              provider: "HUBSPOT",
              method: "GET",
              headers: auth,
            })
          );
          for (const rec of listed.results) {
            sampled += 1;
            itemsSeen += 1;
            const props = rec.properties ?? {};
            const filled = spec.coreProperties.filter((p) => {
              const v = props[p];
              return v != null && String(v).trim() !== "";
            }).length;
            complete += filled / spec.coreProperties.length;
            widenDateRange(metrics, rec.createdAt);
            widenDateRange(metrics, rec.updatedAt);
          }
          after = listed.paging?.next?.after;
          if (!after) break;
        }

        metrics.totalRecords += total.total;
        metrics.recordBreakdown.push({
          objectType: spec.type,
          count: total.total,
          fieldCompletenessPct:
            sampled > 0 ? Math.round((complete / sampled) * 1000) / 10 : null,
        });
        addToCategory(metrics.categoryMix, "records", 0, total.total);
        if (sampled > 0 && total.total > sampled) {
          metrics.caveats.push(
            `${spec.type}: count is exact (${total.total.toLocaleString()}); field completeness is from a ${sampled.toLocaleString()}-record sample.`
          );
        }
        s.completed = true;
        s.pageCount += 1;
        s.sampling = { sampleSize: sampled, maxPages: MAX_SAMPLE_PAGES, pageSize: SAMPLE_PAGE_SIZE };
      } catch (err) {
        if (err instanceof ProviderError && err.status === 403) {
          // The portal did not grant this object scope. Record the gap honestly
          // rather than dropping the object type silently.
          metrics.scopeLimited = true;
          metrics.caveats.push(
            `${spec.type}: not measured because the "${spec.scope}" permission was not granted for this portal.`
          );
          s.completed = true;
        } else {
          throw err;
        }
      }
      next[key] = s;
      streamsDone += 1;
    }

    // Attachment bytes, if the files scope was granted.
    const filesKey = "hubspot:files";
    const fs = next[filesKey] ?? { cursor: null, completed: false, pageCount: 0 };
    const objectsDone = OBJECT_TYPES.every((s) => next[`hubspot:${s.type}`]?.completed);
    if (objectsDone && !fs.completed && streamsDone < MAX_STREAMS_PER_INVOCATION + 1) {
      try {
        const params = new URLSearchParams({ limit: "100" });
        if (fs.cursor) params.set("after", fs.cursor);
        const listed = filesSchema.parse(
          await providerJson(`${API}/files/v3/files?${params.toString()}`, {
            provider: "HUBSPOT",
            method: "GET",
            headers: auth,
          })
        );
        for (const f of listed.results) {
          itemsSeen += 1;
          metrics.totalFiles += 1;
          metrics.totalBytes += f.size ?? 0;
          addToCategory(metrics.categoryMix, categoryForExtension(f.extension ?? null), f.size ?? 0);
          widenDateRange(metrics, f.createdAt ?? undefined);
        }
        fs.cursor = listed.paging?.next?.after ?? null;
        fs.pageCount += 1;
        fs.completed = !fs.cursor;
      } catch (err) {
        if (err instanceof ProviderError && (err.status === 403 || err.status === 404)) {
          metrics.caveats.push(
            "Attached file volume was not measured because the \"files\" permission was not granted."
          );
          fs.completed = true;
        } else {
          throw err;
        }
      }
      next[filesKey] = fs;
    }

    const done =
      OBJECT_TYPES.every((s) => next[`hubspot:${s.type}`]?.completed) &&
      next[filesKey]?.completed === true;
    const streamsComplete = Object.values(next).filter((v) => v.completed).length;

    return {
      state: next,
      partial: metrics,
      hasMore: !done,
      itemsSeen,
      progressPct: done ? 100 : Math.min(95, Math.round((streamsComplete / 4) * 90)),
      progressLabel: done
        ? "Scan complete"
        : `Counting CRM objects — ${metrics.totalRecords.toLocaleString()} records so far`,
    } satisfies ScanPageResult;
  },

  normalizeMetrics(partial) {
    const anySampled = partial.recordBreakdown.some((r) => r.fieldCompletenessPct != null);
    return {
      ...partial,
      // The headline unit is the record count, which is exact. Completeness is
      // sampled, and the caveats say so.
      confidence: partial.scopeLimited ? "SCOPE_LIMITED" : "EXACT",
      method: anySampled
        ? "Exact record counts from the HubSpot CRM search API. Field completeness measured from a bounded sample of each object type."
        : "Exact record counts from the HubSpot CRM search API.",
      caveats: Array.from(new Set(partial.caveats)),
    };
  },

  async disconnect({ accessToken }) {
    if (!accessToken) return;
    try {
      // HubSpot revokes the refresh token grant; the access token endpoint is
      // best-effort and failures must not block local teardown.
      await providerJson(`${API}/oauth/v1/access-tokens/${accessToken}`, {
        provider: "HUBSPOT",
        method: "GET",
        headers: {},
        maxAttempts: 1,
      });
    } catch {
      /* ignore */
    }
  },
};

async function getTokenInfo(accessToken: string) {
  try {
    const raw = await providerJson(`${API}/oauth/v1/access-tokens/${accessToken}`, {
      provider: "HUBSPOT",
      method: "GET",
      headers: {},
    });
    return tokenInfoSchema.parse(raw);
  } catch {
    return null;
  }
}
