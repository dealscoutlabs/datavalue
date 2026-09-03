/**
 * Connector registry.
 *
 * A source appears as a working card only when it can do all of: persist the
 * connection securely, run a real metadata scan, save and display a result,
 * refresh tokens where the provider supports them, handle denial and errors, and
 * disconnect cleanly. Opening an OAuth screen is not enough.
 */
import type { ProviderKey } from "@/generated/prisma";
import type { ConnectorAdapter } from "./types";
import { dropboxAdapter } from "./dropbox";
import { hubspotAdapter } from "./hubspot";
import { microsoftAdapter } from "./microsoft";
import { googleAdapter } from "./google";
import { slackAdapter } from "./slack";
import { demoAdapter } from "./demo";

export const ADAPTERS: Record<ProviderKey, ConnectorAdapter> = {
  DROPBOX: dropboxAdapter,
  HUBSPOT: hubspotAdapter,
  MICROSOFT: microsoftAdapter,
  GOOGLE: googleAdapter,
  SLACK: slackAdapter,
  DEMO: demoAdapter,
};

/** Display order for the catalog. Mirrors implementation maturity. */
export const CATALOG_ORDER: ProviderKey[] = ["DROPBOX", "HUBSPOT", "MICROSOFT", "SLACK", "GOOGLE"];

export function getAdapter(provider: ProviderKey): ConnectorAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error(`No adapter registered for ${provider}`);
  return adapter;
}

export type CatalogEntry = {
  provider: ProviderKey;
  label: string;
  description: string;
  configured: boolean;
  liveCapable: boolean;
  limitationNotice?: string;
  scopes: { scope: string; why: string }[];
  permissionExplainer: { willRead: string[]; willNotRead: string[] };
};

export function catalog(): CatalogEntry[] {
  return CATALOG_ORDER.map((provider) => {
    const a = getAdapter(provider);
    return {
      provider,
      label: a.label,
      description: a.description,
      configured: a.isConfigured(),
      liveCapable: a.liveCapable,
      limitationNotice: a.limitationNotice,
      scopes: a.scopes,
      permissionExplainer: a.permissionExplainer,
    };
  });
}

/** Disabled cards. No OAuth client exists for any of these — they are honest placeholders. */
export const COMING_SOON = [
  { key: "salesforce", label: "Salesforce" },
  { key: "teams", label: "Microsoft Teams" },
  { key: "box", label: "Box" },
  { key: "gcs", label: "Google Cloud Storage" },
  { key: "s3", label: "AWS S3" },
  { key: "quickbooks", label: "QuickBooks" },
  { key: "zendesk", label: "Zendesk" },
  { key: "notion", label: "Notion" },
  { key: "monday", label: "Monday.com" },
  { key: "upload", label: "Direct file upload" },
] as const;
