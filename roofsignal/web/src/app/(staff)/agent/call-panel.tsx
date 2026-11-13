"use client";

import { useActionState, useState } from "react";

import { dial, dispose, type ActionState } from "./actions";

const LABELS: Record<string, string> = {
  QUALIFIED: "Qualified lead",
  CALLBACK: "Call back later",
  NO_ANSWER: "No answer",
  VOICEMAIL_NO_MESSAGE: "Voicemail (no message left)",
  NOT_INTERESTED: "Not interested",
  NOT_HOMEOWNER: "Not the homeowner",
  ALREADY_HAS_CONTRACTOR: "Already has a contractor",
  LANGUAGE_BARRIER: "Language barrier",
  WRONG_NUMBER: "Wrong number (never call again)",
  DNC_REQUESTED: "Asked not to be called (DNC)",
  HOSTILE: "Hostile (never call again)",
};

export function CallPanel({
  itemId,
  codes,
  concerns,
  timelines,
  insurance,
}: {
  itemId: string;
  codes: string[];
  concerns: string[];
  timelines: string[];
  insurance: string[];
}) {
  const [dialState, dialAction, dialing] = useActionState<ActionState, FormData>(dial, {});
  const [dispState, dispAction, saving] = useActionState<ActionState, FormData>(dispose, {});
  const [code, setCode] = useState("QUALIFIED");
  const callId = dialState.callId;

  return (
    <div className="space-y-4">
      {!callId && (
        <form action={dialAction} className="space-y-2">
          <input type="hidden" name="item_id" value={itemId} />
          <button disabled={dialing} className="rounded bg-accent px-4 py-2 text-white hover:bg-accent-hover disabled:opacity-60">
            {dialing ? "Checking compliance & dialing…" : "Dial"}
          </button>
          {dialState.error && (
            <div className="rounded border border-caution-line bg-caution-soft p-2 text-sm text-caution" role="alert">
              {dialState.error}
              {dialState.blocked && dialState.blocked.length > 0 && (
                <div className="mt-1 font-mono text-xs">{dialState.blocked.join(", ")}</div>
              )}
            </div>
          )}
        </form>
      )}

      {callId && (
        <form action={dispAction} className="space-y-3 text-sm">
          <input type="hidden" name="call_id" value={callId} />
          <p className="text-tier-a">{dialState.message}</p>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="recording_disclosed" /> I read the recording disclosure
          </label>
          <label className="block">
            <span className="text-xs text-ink-subtle">Disposition</span>
            <select name="code" value={code} onChange={(e) => setCode(e.target.value)}
              className="mt-1 block w-full rounded border border-line px-2 py-1.5">
              {codes.map((c) => (
                <option key={c} value={c}>{LABELS[c] ?? c}</option>
              ))}
            </select>
          </label>

          {code === "QUALIFIED" && (
            <fieldset className="space-y-2 rounded border border-line p-3">
              <legend className="px-1 text-xs text-ink-subtle">Qualification</legend>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="homeowner_confirmed" required /> Homeowner confirmed
              </label>
              <Select name="roof_concern" label="Roof concern" options={concerns} />
              <input name="roof_concern_notes" placeholder="Concern details (their words)"
                className="w-full rounded border border-line px-2 py-1.5" />
              <Select name="timeline" label="Timeline" options={timelines} />
              <Select name="insurance_claim_interest" label="Insurance claim interest (record only, no advice)" options={insurance} />
              <input name="best_appointment_window" placeholder="Best time for appointment"
                className="w-full rounded border border-line px-2 py-1.5" />
            </fieldset>
          )}
          {code === "CALLBACK" && (
            <label className="block">
              <span className="text-xs text-ink-subtle">Call back at (their local time)</span>
              <input type="datetime-local" name="callback_at" className="mt-1 block rounded border border-line px-2 py-1.5" />
            </label>
          )}
          <textarea name="notes" placeholder="Call notes" rows={3} className="w-full rounded border border-line px-2 py-1.5" />
          {dispState.error && <p className="text-caution" role="alert">{dispState.error}</p>}
          <button disabled={saving} className="rounded bg-accent px-4 py-2 text-white hover:bg-accent-hover disabled:opacity-60">
            {saving ? "Saving…" : "Save disposition"}
          </button>
        </form>
      )}
      {dispState.message && <p className="text-sm text-tier-a">{dispState.message}</p>}
    </div>
  );
}

const OPTION_LABELS: Record<string, string> = {
  leak: "Leak",
  missing_or_damaged_shingles: "Missing or damaged shingles (their words)",
  age: "Roof age",
  storm_concern: "Worried about recent storm",
  insurance_inspection: "Wants an inspection for insurance",
  none: "No specific concern",
  other: "Other",
  asap: "As soon as possible",
  "1_3_months": "1 to 3 months",
  "3_6_months": "3 to 6 months",
  "6_plus_months": "6+ months",
  unsure: "Not sure",
  yes: "Yes",
  no: "No",
  already_filed: "Already filed a claim",
};

function Select({ name, label, options }: { name: string; label: string; options: string[] }) {
  return (
    <label className="block">
      <span className="text-xs text-ink-subtle">{label}</span>
      <select name={name} required defaultValue="" className="mt-1 block w-full rounded border border-line px-2 py-1.5">
        <option value="" disabled>Choose…</option>
        {options.map((o) => (
          <option key={o} value={o}>{OPTION_LABELS[o] ?? o.replaceAll("_", " ")}</option>
        ))}
      </select>
    </label>
  );
}
