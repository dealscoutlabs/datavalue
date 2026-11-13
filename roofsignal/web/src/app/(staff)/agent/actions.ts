"use server";

import { revalidatePath } from "next/cache";

import { ApiError, apiPost } from "@/lib/api";
import { getUser } from "@/lib/session";

export type ActionState = { error?: string; message?: string; callId?: string; blocked?: string[] };

// Every action re-verifies the session with the API (getUser) and the API checks role and ownership again.

export async function claimNext(): Promise<void> {
  await getUser();
  await apiPost("/api/agent/claim", {});
  revalidatePath("/agent");
}

export async function release(form: FormData): Promise<void> {
  await getUser();
  await apiPost(`/api/agent/items/${encodeURIComponent(String(form.get("item_id")))}/release`, {});
  revalidatePath("/agent");
}

export async function dial(_prev: ActionState, form: FormData): Promise<ActionState> {
  await getUser();
  const itemId = String(form.get("item_id"));
  try {
    const r = await apiPost<{ call_id: string; provider: string }>(
      `/api/agent/items/${encodeURIComponent(itemId)}/dial`,
      {},
    );
    return { callId: r.call_id, message: `Connected via ${r.provider}.` };
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      const d = e.detail as { reasons?: string[] };
      revalidatePath("/agent");
      return { error: "The compliance gate blocked this call.", blocked: d?.reasons ?? [] };
    }
    return { error: "Dial failed." };
  }
}

export async function dispose(_prev: ActionState, form: FormData): Promise<ActionState> {
  await getUser();
  const callId = String(form.get("call_id"));
  const code = String(form.get("code"));
  const qualification =
    code === "QUALIFIED"
      ? {
          homeowner_confirmed: form.get("homeowner_confirmed") === "on",
          roof_concern: form.get("roof_concern"),
          roof_concern_notes: form.get("roof_concern_notes"),
          timeline: form.get("timeline"),
          insurance_claim_interest: form.get("insurance_claim_interest"),
          best_appointment_window: form.get("best_appointment_window"),
        }
      : undefined;
  const callbackAt = form.get("callback_at") ? new Date(String(form.get("callback_at"))).toISOString() : undefined;
  try {
    await apiPost(`/api/agent/calls/${encodeURIComponent(callId)}/disposition`, {
      code,
      notes: form.get("notes") || null,
      recording_disclosed: form.get("recording_disclosed") === "on",
      callback_at: callbackAt,
      qualification,
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 422) return { error: String(e.detail), callId };
    return { error: "Could not save the disposition.", callId };
  }
  revalidatePath("/agent");
  return { message: `Saved: ${code}` };
}
