"use server";

import { ApiError, apiPost } from "@/lib/api";

export type EstimateState = { done?: boolean; willCall?: boolean; error?: string };

// Public action: no staff session. The API verifies the service token, validates every field, and checks that
// the consent text shown to the visitor (by hash) is exactly the approved disclosure before recording consent.
export async function submitEstimate(_prev: EstimateState, form: FormData): Promise<EstimateState> {
  const body = {
    first_name: String(form.get("first_name") ?? "").trim(),
    last_name: String(form.get("last_name") ?? "").trim(),
    phone: String(form.get("phone") ?? ""),
    email: String(form.get("email") ?? "").trim() || null,
    address: String(form.get("address") ?? "").trim(),
    zip: String(form.get("zip") ?? "").trim(),
    state: String(form.get("state") ?? "").trim(),
    consent_checked: form.get("consent") === "on",
    disclosure_version: String(form.get("disclosure_version") ?? ""),
    disclosure_sha256: String(form.get("disclosure_sha256") ?? ""),
    tracking_code: String(form.get("tracking_code") ?? "") || null,
    page_url: String(form.get("page_url") ?? "") || null,
  };
  try {
    const r = await apiPost<{ will_call: boolean }>("/public/requests", body, { auth: false, client: true });
    return { done: true, willCall: r.will_call };
  } catch (e) {
    if (e instanceof ApiError && e.status === 422) {
      const d = e.detail;
      return { error: typeof d === "string" ? d : "Please check the highlighted fields and try again." };
    }
    return { error: "Something went wrong. Please call us instead." };
  }
}

export type OptOutState = { done?: boolean; error?: string };

export async function submitOptOut(_prev: OptOutState, form: FormData): Promise<OptOutState> {
  try {
    await apiPost("/public/optout", { phone: String(form.get("phone") ?? "") }, { auth: false, client: true });
    return { done: true };
  } catch (e) {
    if (e instanceof ApiError && e.status === 422) return { error: "Please enter a valid 10-digit US phone number." };
    return { error: "Something went wrong. Please try again." };
  }
}
