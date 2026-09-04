/**
 * Demo data.
 *
 * The demo organisation NEVER performs an OAuth handshake and never presents a
 * simulated successful connection. Its sources are created explicitly as demo
 * records, carry isDemo = true, and are rendered everywhere with a "Demo data"
 * badge. The adapter's OAuth methods throw on purpose: there is no code path in
 * this application that fakes a provider authorization.
 *
 * The fixture is deliberately chosen so the honest states are visible in a sales
 * context — it contains a SCOPE_LIMITED result (Slack) and sources that come back
 * REVIEW_REQUIRED (every communications corpus).
 */
import type { ProviderKey } from "@/generated/prisma";
import type { ConnectorAdapter, NormalizedMetrics } from "./types";

const GB = 1024 ** 3;

export const DEMO_PROVIDERS: ProviderKey[] = [
  "DROPBOX",
  "HUBSPOT",
  "MICROSOFT",
  "GOOGLE_ADMIN",
  "SLACK",
  "GOOGLE",
];

export const DEMO_ACCOUNT_LABELS: Record<string, string> = {
  DROPBOX: "ops@northwind-supply.example",
  HUBSPOT: "northwind-supply.example (Portal 24815503)",
  MICROSOFT: "j.okafor@northwind-supply.example",
  SLACK: "Northwind Supply",
  GOOGLE: "j.okafor@northwind-supply.example",
  GOOGLE_ADMIN: "northwind-supply.example (admin: it@northwind-supply.example)",
};

/**
 * Deterministic fixtures. No randomness — the demo renders identically on every
 * machine, which is what makes it usable in a test and in a sales call.
 */
export function demoMetricsFor(provider: ProviderKey): NormalizedMetrics {
  switch (provider) {
    case "DROPBOX":
      return {
        unitType: "UNSTRUCTURED_BYTES",
        totalBytes: Math.round(412.4 * GB),
        totalRecords: 0,
        totalFiles: 68431,
        categoryMix: {
          documents: { bytes: Math.round(96.2 * GB), count: 24118 },
          spreadsheets: { bytes: Math.round(41.7 * GB), count: 11902 },
          presentations: { bytes: Math.round(28.9 * GB), count: 3244 },
          images: { bytes: Math.round(88.1 * GB), count: 21455 },
          video: { bytes: Math.round(121.3 * GB), count: 1809 },
          archives: { bytes: Math.round(24.6 * GB), count: 2417 },
          other: { bytes: Math.round(11.6 * GB), count: 3486 },
        },
        recordBreakdown: [],
        oldestItemAt: "2016-03-14T09:22:00.000Z",
        newestItemAt: "2026-08-27T16:41:00.000Z",
        confidence: "EXACT",
        method:
          "Exact account storage from the Dropbox space-usage API, with file counts and types enumerated from folder metadata.",
        caveats: ["Account allocation is 2048.0 GB; 412.4 GB is in use."],
        scopeLimited: false,
      };

    case "HUBSPOT":
      return {
        unitType: "STRUCTURED_RECORDS",
        totalBytes: Math.round(6.1 * GB),
        totalRecords: 29367,
        totalFiles: 4188,
        categoryMix: {
          records: { bytes: 0, count: 29367 },
          documents: { bytes: Math.round(4.4 * GB), count: 3211 },
          images: { bytes: Math.round(1.7 * GB), count: 977 },
        },
        recordBreakdown: [
          { objectType: "contacts", count: 24318, fieldCompletenessPct: 71.4 },
          { objectType: "companies", count: 3902, fieldCompletenessPct: 63.8 },
          { objectType: "deals", count: 1147, fieldCompletenessPct: 84.2 },
        ],
        oldestItemAt: "2018-01-09T00:00:00.000Z",
        newestItemAt: "2026-08-31T11:05:00.000Z",
        confidence: "EXACT",
        method:
          "Exact record counts from the HubSpot CRM search API. Field completeness measured from a bounded sample of each object type.",
        caveats: [
          "contacts: count is exact (24,318); field completeness is from a 300-record sample.",
          "companies: count is exact (3,902); field completeness is from a 300-record sample.",
        ],
        scopeLimited: false,
      };

    case "MICROSOFT":
      return {
        unitType: "UNSTRUCTURED_BYTES",
        totalBytes: Math.round(129.6 * GB),
        totalRecords: 213540,
        totalFiles: 19288,
        categoryMix: {
          documents: { bytes: Math.round(44.2 * GB), count: 11402 },
          spreadsheets: { bytes: Math.round(21.8 * GB), count: 5119 },
          presentations: { bytes: Math.round(12.4 * GB), count: 1288 },
          images: { bytes: Math.round(9.7 * GB), count: 1479 },
          email: { bytes: Math.round(41.5 * GB), count: 213540 },
        },
        recordBreakdown: [],
        oldestItemAt: "2015-06-02T08:14:00.000Z",
        newestItemAt: "2026-09-01T07:52:00.000Z",
        confidence: "EXACT",
        method:
          "Delegated scan: exact OneDrive quota and exact mail folder counts and sizes for the signed-in account only.",
        caveats: [
          "This scan covers only the signed-in user's OneDrive and mailbox. Tenant-wide measurement needs a Microsoft 365 admin to grant the Reports.Read.All permission.",
          "OneDrive allocation is 1024.0 GB; 88.1 GB is in use.",
          "Mailbox contains 213,540 messages across all folders (exact folder counts from Microsoft Graph).",
        ],
        scopeLimited: false,
      };

    case "SLACK":
      // The deliberate SCOPE_LIMITED fixture.
      return {
        unitType: "UNSTRUCTURED_BYTES",
        totalBytes: Math.round(27.3 * GB),
        totalRecords: 0,
        totalFiles: 14204,
        categoryMix: {
          images: { bytes: Math.round(11.9 * GB), count: 8817 },
          documents: { bytes: Math.round(7.2 * GB), count: 3044 },
          spreadsheets: { bytes: Math.round(2.8 * GB), count: 1188 },
          video: { bytes: Math.round(4.1 * GB), count: 411 },
          other: { bytes: Math.round(1.3 * GB), count: 744 },
        },
        recordBreakdown: [],
        oldestItemAt: "2019-11-05T13:30:00.000Z",
        newestItemAt: "2026-09-02T09:18:00.000Z",
        confidence: "SCOPE_LIMITED",
        method:
          "Aggregate file volume from the Slack files API, plus channel and member counts. Message volume is not measured.",
        caveats: [
          "File volume only — message content is not measured. Slack limits non-Marketplace apps to 1 history request per minute with a maximum of 15 messages per request, which makes message-volume measurement impractical, so this app does not request the history permission at all.",
          "Workspace context: 214 public channels, 78 active members. These are counts only and contribute no measured volume.",
        ],
        scopeLimited: true,
      };

    case "GOOGLE_ADMIN":
      // Domain-wide, so materially larger than the single-user GOOGLE fixture.
      // No file count: the Admin SDK reports storage but not items held.
      return {
        unitType: "UNSTRUCTURED_BYTES",
        totalBytes: Math.round(1806.4 * GB),
        totalRecords: 0,
        totalFiles: 0,
        categoryMix: {
          documents: { bytes: Math.round(1114.2 * GB), count: 0 },
          email: { bytes: Math.round(601.7 * GB), count: 0 },
          images: { bytes: Math.round(90.5 * GB), count: 0 },
        },
        recordBreakdown: [],
        oldestItemAt: null,
        newestItemAt: "2026-09-01T00:00:00.000Z",
        confidence: "EXACT",
        method:
          "Domain-wide storage from the Google Workspace Admin SDK usage reports, summed across every account, with Drive and Gmail reported separately by Google rather than derived.",
        caveats: [
          "Measured across 78 Workspace accounts from the usage report dated 2026-09-01.",
          "Drive holds 1114.2 GB and Gmail holds 601.7 GB. Google reports these separately, so neither figure is derived by subtraction.",
          "The Admin SDK usage reports expose storage totals but not a count of items held, so no file or message count is reported for this source. The item figures Google does publish count activity during the report window, not the size of the corpus.",
          "Usage reports are published with a delay, so this reflects the domain as of 2026-09-01 rather than this moment.",
          "Domain storage allocation totals 7800.0 GB across all accounts.",
        ],
        scopeLimited: false,
      };

    case "GOOGLE":
      return {
        unitType: "UNSTRUCTURED_BYTES",
        totalBytes: Math.round(211.8 * GB),
        totalRecords: 148902,
        totalFiles: 31577,
        categoryMix: {
          documents: { bytes: Math.round(52.1 * GB), count: 14882 },
          spreadsheets: { bytes: Math.round(18.3 * GB), count: 7104 },
          presentations: { bytes: Math.round(9.4 * GB), count: 2011 },
          images: { bytes: Math.round(61.2 * GB), count: 6188 },
          video: { bytes: Math.round(15.4 * GB), count: 392 },
          email: { bytes: Math.round(55.4 * GB), count: 148902 },
        },
        recordBreakdown: [],
        oldestItemAt: "2014-02-11T10:00:00.000Z",
        newestItemAt: "2026-09-01T18:33:00.000Z",
        confidence: "SAMPLED",
        method:
          "Exact Drive storage quota from the Drive about endpoint, with exact Gmail message counts from the Gmail profile endpoint.",
        caveats: [
          "Total Google account usage is 267.2 GB across Drive, Gmail and Photos combined; 156.4 GB of that is Drive. Google does not break the remainder down by product, so any Gmail figure derived by subtraction would be approximate and is not used here.",
          "4,918 Google-native documents (Docs, Sheets, Slides) report no ordinary file size through the Drive API, so they are counted but contribute no bytes.",
          "Gmail holds 148,902 messages and 61,204 threads — both exact. Mailbox bytes are estimated from a 100-message size sample averaging 390 KB, so the byte figure is an estimate while the counts are not.",
        ],
        scopeLimited: false,
      };

    default:
      return {
        unitType: "UNSTRUCTURED_BYTES",
        totalBytes: 0,
        totalRecords: 0,
        totalFiles: 0,
        categoryMix: {},
        recordBreakdown: [],
        oldestItemAt: null,
        newestItemAt: null,
        confidence: "DERIVED",
        method: "Demo fixture.",
        caveats: [],
        scopeLimited: false,
      };
  }
}

const notReal = () => {
  throw new Error(
    "Demo sources never perform an OAuth handshake. This application does not simulate provider authorization."
  );
};

export const demoAdapter: ConnectorAdapter = {
  key: "DEMO",
  label: "Demo source",
  description: "Deterministic seeded data used only by the demo organisation.",
  unitType: "UNSTRUCTURED_BYTES",
  liveCapable: false,
  limitationNotice: "Demo fixture. Not a live connection.",
  scopes: [],
  permissionExplainer: { willRead: [], willNotRead: [] },
  isConfigured: () => true,
  getAuthorizationUrl: notReal,
  exchangeCode: notReal,
  refreshToken: notReal,
  async scanPage({ partial }) {
    return {
      state: {},
      partial,
      hasMore: false,
      itemsSeen: 0,
      progressPct: 100,
      progressLabel: "Demo fixture loaded",
    };
  },
  normalizeMetrics: (p) => p,
  async disconnect() {},
};
