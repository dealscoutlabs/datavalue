import "server-only";

import { headers } from "next/headers";

import { isAuthorized } from "@/lib/basic-auth";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function assertAdmin() {
  const h = await headers();
  if (!isAuthorized(h.get("authorization"))) throw new ApiError(401, "Not authorized");
}

function config() {
  const base = process.env.ROOFSIGNAL_API_URL;
  const token = process.env.ADMIN_API_TOKEN;
  if (!base || !token) throw new ApiError(500, "ROOFSIGNAL_API_URL and ADMIN_API_TOKEN must be set");
  return { base: base.replace(/\/$/, ""), token };
}

export async function apiFetch(path: string, params?: Record<string, string | string[] | undefined>) {
  await assertAdmin();
  const { base, token } = config();
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === "") continue;
    for (const item of Array.isArray(v) ? v : [v]) if (item) url.searchParams.append(k, item);
  }
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) throw new ApiError(res.status, `${path} -> ${res.status}`);
  return res;
}

export async function apiJson<T>(path: string, params?: Record<string, string | string[] | undefined>): Promise<T> {
  return (await apiFetch(path, params)).json() as Promise<T>;
}

// ---- response types (mirror roofsignal/src/roofsignal/api/main.py) ----

export type RunStats = {
  properties: number;
  tiers: Record<string, number>;
  properties_with_storm_hits: number;
  properties_with_roof_permit: number;
  imagery_provider: string | null;
};

export type CountySummary = {
  key: string;
  name: string;
  state: string;
  parcel_adapter: string;
  properties: number;
  latest_run: null | { id: string; as_of: string; config_hash: string; finished_at: string | null; stats: RunStats };
};

export type PropertyRow = {
  id: string;
  parcel_id: string;
  site_address: string | null;
  zip: string | null;
  town: string | null;
  municipality: string | null;
  year_built: number | null;
  owner_name: string | null;
  owner_occupied_guess: boolean | null;
  score: number;
  tier: string;
  reason_codes: string[];
};

export type PropertyList = {
  run: { id: string; as_of: string; config_hash: string; stats: RunStats };
  total: number;
  items: PropertyRow[];
};

export type Component = {
  signal: string;
  counted: boolean;
  weight: number;
  normalized: number;
  confidence: number;
  points: number;
  reason_codes: string[];
  is_mock: boolean;
};

export type SignalRow = {
  signal: string;
  adapter: string;
  is_mock: boolean;
  value: number | null;
  normalized: number;
  confidence: number;
  reason_codes: string[];
  evidence: Record<string, unknown>;
};

export type PropertyDetail = {
  property: Record<string, unknown> & { parcel_id: string; site_address: string | null; county_key: string };
  run: { id: string; as_of: string; config_hash: string };
  score: { score: number; tier: string; reason_codes: string[]; components: Component[] } | null;
  signals: SignalRow[];
  permits: {
    permit_no: string;
    issued_on: string | null;
    work_category: string;
    work_type_raw: string | null;
    match_method: string | null;
    match_confidence: number | null;
    jurisdiction: string;
  }[];
};

export type ReasonCodes = Record<string, { label: string; agent_visible: boolean }>;

export type CampaignRow = {
  id: string;
  name: string;
  channel: string;
  trade: string;
  tier_filter: string[];
  tracking_phone: string;
  tracking_phone_is_mock: boolean;
  status: string;
  created_at: string;
  county_key: string;
  pieces: number;
  exported: number;
};
