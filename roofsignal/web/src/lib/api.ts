import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";

export const SESSION_COOKIE = "rs_session";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
  }
}

function config() {
  const base = process.env.ROOFSIGNAL_API_URL;
  const token = process.env.SERVICE_API_TOKEN;
  if (!base || !token) throw new ApiError(500, "ROOFSIGNAL_API_URL and SERVICE_API_TOKEN must be set");
  return { base: base.replace(/\/$/, ""), token };
}

type Options = {
  method?: "GET" | "POST";
  params?: Record<string, string | string[] | undefined>;
  body?: unknown;
  /** Staff routes send the signed-in user's session; public routes don't. */
  auth?: boolean;
  /** Forwarded for consent records on public routes. */
  client?: boolean;
};

/** Visitor IP and user agent, as seen by this server, for consent records. */
export async function clientHeaders(): Promise<Record<string, string>> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "";
  return { "X-Client-IP": ip, "X-Client-User-Agent": h.get("user-agent") ?? "" };
}

export async function apiFetch(path: string, opts: Options = {}) {
  await connection(); // all API data is per-request; never prerender it at build time
  const { base, token } = config();
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    if (v === undefined || v === "") continue;
    for (const item of Array.isArray(v) ? v : [v]) if (item) url.searchParams.append(k, item);
  }
  const hdrs: Record<string, string> = { "X-Service-Token": token };
  if (opts.auth !== false) {
    const session = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!session) redirect("/login");
    hdrs.Authorization = `Bearer ${session}`;
  }
  if (opts.client) Object.assign(hdrs, await clientHeaders());
  if (opts.body !== undefined) hdrs["Content-Type"] = "application/json";
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: hdrs,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: "no-store",
  });
  if (res.status === 401 && opts.auth !== false) redirect("/login");
  if (!res.ok) {
    let detail: unknown;
    try {
      detail = (await res.json()).detail;
    } catch {
      detail = undefined;
    }
    throw new ApiError(res.status, `${path} -> ${res.status}`, detail);
  }
  return res;
}

export async function apiJson<T>(path: string, params?: Record<string, string | string[] | undefined>): Promise<T> {
  return (await apiFetch(path, { params })).json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown, opts: Omit<Options, "method" | "body"> = {}): Promise<T> {
  return (await apiFetch(path, { ...opts, method: "POST", body })).json() as Promise<T>;
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

export type User = { id: string; email: string; display_name: string; role: "admin" | "supervisor" | "agent" };

export type Script = { script: string; talking_points: string[]; reason_codes: string[] };

export type QueueItem = {
  id: string;
  queue: string;
  call_kind: string;
  status: string;
  phone_masked: string;
  first_name: string | null;
  last_name: string | null;
  address: string | null;
  zip: string | null;
  site_address: string | null;
  town: string | null;
  year_built: number | null;
  recipient_state: string | null;
  recipient_timezone: string | null;
  script: Script;
};

export type QueueSummary = {
  queues: { queue: string; ready_now: number; scheduled: number }[];
  claimed: QueueItem | null;
};

export type DecisionRow = {
  id: string;
  e164: string;
  purpose: string;
  call_kind: string;
  allowed: boolean;
  block_reasons: string[];
  checks: { check: string; status: string; reason_code: string; detail: string; data_version: string | null }[];
  ruleset_version: string;
  evaluated_at: string;
  recipient_state: string | null;
  recipient_timezones: string[];
  next_window_start: string | null;
  allow_mock_data: boolean;
  actor: string;
};

export type Landing = {
  code: string | null;
  trigger_text: string | null;
  tracking_phone: string | null;
  disclosure: { version: string; text: string; sha256: string };
};
