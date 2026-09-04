/**
 * Eligibility engine.
 *
 * Produces a per-source and organisation-wide screening status from the
 * questionnaire plus the scan metadata. It is deliberately the FIRST gate in the
 * product: the rate engine cannot run for a source this engine has not cleared.
 *
 * Two rules govern every change to this file:
 *  1. Missing input is treated as the most conservative input. An unanswered or
 *     "unsure" question never counts in the business's favour.
 *  2. No output of this engine may assert that data is legally sellable, cleared,
 *     licensable, or compliant. The strongest available status is
 *     LIKELY_ELIGIBLE, which describes a screening result, not a legal right.
 */
import type { EligibilityStatus, ProviderKey } from "@/generated/prisma";

export const ELIGIBILITY_ENGINE_VERSION = "1.0.0";

export type TriStateValue = "YES" | "NO" | "UNSURE";

export type QuestionnaireInput = {
  industry: string;
  dataAgeRange: string;
  originCreatedOrControlled: TriStateValue;
  thirdPartyPii: TriStateValue;
  ndaBoundMaterial: TriStateValue;
  employeePersonalData: TriStateValue;
  uniqueness: "UNIQUE_PROPRIETARY" | "SOMEWHAT" | "COMMONLY_AVAILABLE";
  alreadyLicensed: TriStateValue;
  exclusivityPossible: TriStateValue;
  personalData: TriStateValue;
  healthData: TriStateValue;
  financialData: TriStateValue;
  childrensData: TriStateValue;
  biometricData: TriStateValue;
  legalPrivilegeData: TriStateValue;
  credentialData: TriStateValue;
  exportControlledData: TriStateValue;
  willingToAnonymize: TriStateValue;
};

export type SourceInput = {
  connectionId: string;
  provider: ProviderKey;
  /** Content-free category buckets from the scan. */
  categoryKeys: string[];
  scopeLimited: boolean;
  hasMetrics: boolean;
};

export type ReasonSeverity = "BLOCKING" | "REVIEW" | "INFO";

export type EligibilityReason = {
  code: string;
  severity: ReasonSeverity;
  text: string;
};

export type EligibilityResult = {
  status: EligibilityStatus;
  engineVersion: string;
  reasons: EligibilityReason[];
  /** When false, every dollar figure for this scope must be suppressed. */
  ratesUnlocked: boolean;
};

/**
 * Providers whose corpora are structurally communications. Email and chat
 * archives always contain the other side of a conversation — counterparties,
 * job applicants, employees — whose material the business did not author and
 * generally cannot license on its own. These default to REVIEW_REQUIRED no
 * matter how the questionnaire is answered.
 */
const COMMUNICATIONS_PROVIDERS: ReadonlySet<ProviderKey> = new Set<ProviderKey>([
  "MICROSOFT", // Exchange Online mailboxes are scanned alongside OneDrive
  "GOOGLE", // Gmail is scanned alongside Drive
  "GOOGLE_ADMIN", // domain-wide Gmail storage is part of the measured volume
  "SLACK", // files are shared inside conversations with counterparties
]);

const COMMUNICATIONS_CATEGORIES = new Set(["email", "chat"]);

/** Sensitive special categories. A YES or UNSURE on any of these restricts. */
const SENSITIVE_FIELDS = [
  ["personalData", "personal information about identifiable individuals"],
  ["healthData", "health or medical information"],
  ["financialData", "financial account or payment information"],
  ["childrensData", "information about children"],
  ["biometricData", "biometric identifiers"],
  ["legalPrivilegeData", "legally privileged material"],
  ["credentialData", "credentials, keys or secrets"],
  ["exportControlledData", "export-controlled technical data"],
] as const;

/**
 * Categories that are not merely a review trigger but a practical bar. Neither
 * can be cured by redaction: credentials have no licensable form, and privilege
 * belongs to the client, not the business holding the file.
 */
const DISQUALIFYING_SENSITIVE_FIELDS = new Set(["credentialData", "legalPrivilegeData"]);

const RANK: Record<EligibilityStatus, number> = {
  LIKELY_ELIGIBLE: 0,
  REVIEW_REQUIRED: 1,
  LIKELY_INELIGIBLE: 2,
};

/** Returns the more conservative of two statuses. */
export function mostConservative(
  a: EligibilityStatus,
  b: EligibilityStatus
): EligibilityStatus {
  return RANK[a] >= RANK[b] ? a : b;
}

function isRestrictive(v: TriStateValue | undefined | null): boolean {
  // UNSURE is treated exactly like YES. An unanswered risk is an unresolved risk.
  return v !== "NO";
}

/**
 * Assess a single connected source.
 *
 * @param questionnaire null when the business has not completed it yet, which is
 *        itself a REVIEW_REQUIRED condition — rates stay locked.
 */
export function assessSource(
  source: SourceInput,
  questionnaire: QuestionnaireInput | null
): EligibilityResult {
  const reasons: EligibilityReason[] = [];
  // Held in an object rather than a `let`, so that control-flow narrowing does
  // not collapse the type after the initial assignment — every read below must
  // see whatever the escalations actually produced.
  const acc: { status: EligibilityStatus } = { status: "LIKELY_ELIGIBLE" };

  const escalate = (next: EligibilityStatus, reason: EligibilityReason) => {
    acc.status = mostConservative(acc.status, next);
    reasons.push(reason);
  };

  if (!source.hasMetrics) {
    escalate("REVIEW_REQUIRED", {
      code: "NO_SCAN",
      severity: "REVIEW",
      text: "No completed metadata scan for this source yet, so nothing has been measured.",
    });
  }

  // --- structural provider rule, independent of the questionnaire -----------
  const isCommsProvider = COMMUNICATIONS_PROVIDERS.has(source.provider);
  const hasCommsCategories = source.categoryKeys.some((k) =>
    COMMUNICATIONS_CATEGORIES.has(k)
  );
  if (isCommsProvider || hasCommsCategories) {
    escalate("REVIEW_REQUIRED", {
      code: "COMMUNICATIONS_CORPUS",
      severity: "REVIEW",
      text:
        "This is a communications corpus. Email and chat archives structurally contain material written by counterparties, employees and other third parties, so they require a rights review regardless of how the questionnaire is answered.",
    });
  }

  if (source.scopeLimited) {
    escalate("REVIEW_REQUIRED", {
      code: "SCOPE_LIMITED",
      severity: "REVIEW",
      text:
        "The provider does not expose enough metadata to measure this corpus completely, so any assessment covers only the measured portion.",
    });
  }

  // --- questionnaire-driven rules ------------------------------------------
  if (!questionnaire) {
    escalate("REVIEW_REQUIRED", {
      code: "QUESTIONNAIRE_INCOMPLETE",
      severity: "REVIEW",
      text:
        "The rights and sensitivity questionnaire has not been completed. Eligibility defaults to the most conservative outcome until it is.",
    });
    return { status: acc.status, engineVersion: ELIGIBILITY_ENGINE_VERSION, reasons, ratesUnlocked: false };
  }

  // Origin of the data. If the business neither created it nor lawfully controls
  // it by contract, there is no plausible basis for it to license the corpus.
  if (questionnaire.originCreatedOrControlled === "NO") {
    escalate("LIKELY_INELIGIBLE", {
      code: "ORIGIN_NOT_CONTROLLED",
      severity: "BLOCKING",
      text:
        "You indicated the business neither created this data nor lawfully controls it under contract. Without one of those, there is no plausible basis to license it.",
    });
  } else if (questionnaire.originCreatedOrControlled === "UNSURE") {
    escalate("REVIEW_REQUIRED", {
      code: "ORIGIN_UNCERTAIN",
      severity: "REVIEW",
      text: "The origin and contractual control of this data is unconfirmed and needs review.",
    });
  }

  if (isRestrictive(questionnaire.thirdPartyPii)) {
    escalate("REVIEW_REQUIRED", {
      code: "THIRD_PARTY_PII",
      severity: "REVIEW",
      text:
        "Third-party or customer personal information may be present. That material carries obligations to the individuals it describes and must be reviewed.",
    });
  }

  if (isRestrictive(questionnaire.ndaBoundMaterial)) {
    escalate("REVIEW_REQUIRED", {
      code: "NDA_MATERIAL",
      severity: "REVIEW",
      text:
        "Counterparty material subject to an NDA or confidentiality obligation may be present, which typically restricts onward disclosure.",
    });
  }

  if (isRestrictive(questionnaire.employeePersonalData)) {
    escalate("REVIEW_REQUIRED", {
      code: "EMPLOYEE_PII",
      severity: "REVIEW",
      text: "Employee personal data may be present and needs a rights review.",
    });
  }

  for (const [field, label] of SENSITIVE_FIELDS) {
    const value = questionnaire[field];
    if (!isRestrictive(value)) continue;
    const disqualifying = DISQUALIFYING_SENSITIVE_FIELDS.has(field);
    const suffix = value === "UNSURE" ? " may be" : " is reported to be";
    escalate(disqualifying ? "LIKELY_INELIGIBLE" : "REVIEW_REQUIRED", {
      code: `SENSITIVE_${field.toUpperCase()}`,
      severity: disqualifying ? "BLOCKING" : "REVIEW",
      text: disqualifying
        ? `This corpus${suffix} to contain ${label}. Material of this kind has no licensable form and cannot proceed on this basis.`
        : `This corpus${suffix} to contain ${label}, which requires a rights and compliance review.`,
    });
  }

  // Informational signals. These never restrict and never raise a rate on their own.
  if (questionnaire.alreadyLicensed === "YES") {
    reasons.push({
      code: "ALREADY_LICENSED",
      severity: "INFO",
      text:
        "You indicated this data is already licensed elsewhere. Existing agreements may limit exclusivity.",
    });
  }
  if (questionnaire.willingToAnonymize === "YES" && acc.status === "REVIEW_REQUIRED") {
    reasons.push({
      code: "ANONYMISATION_OFFERED",
      severity: "INFO",
      text:
        "You indicated a willingness to anonymise or redact. That may narrow the scope of a rights review but does not change this screening result.",
    });
  }

  if (acc.status === "LIKELY_ELIGIBLE") {
    reasons.push({
      code: "SCREENING_PASSED",
      severity: "INFO",
      text:
        "Your answers did not surface a restricting condition for this source. This is a screening result only — it does not confirm that you hold the rights to license this data.",
    });
  }

  return {
    status: acc.status,
    engineVersion: ELIGIBILITY_ENGINE_VERSION,
    reasons,
    // Rates unlock only on a clean screen. REVIEW_REQUIRED and LIKELY_INELIGIBLE
    // both suppress every dollar figure for the source.
    ratesUnlocked: acc.status === "LIKELY_ELIGIBLE",
  };
}

/**
 * Organisation-wide roll-up: the most conservative status across all sources,
 * plus the questionnaire-level reasons. With no sources at all the result is
 * REVIEW_REQUIRED, never LIKELY_ELIGIBLE.
 */
export function assessOrganization(
  sources: SourceInput[],
  questionnaire: QuestionnaireInput | null
): EligibilityResult & { perSource: Record<string, EligibilityResult> } {
  const perSource: Record<string, EligibilityResult> = {};
  for (const s of sources) perSource[s.connectionId] = assessSource(s, questionnaire);

  if (sources.length === 0) {
    return {
      status: "REVIEW_REQUIRED",
      engineVersion: ELIGIBILITY_ENGINE_VERSION,
      ratesUnlocked: false,
      reasons: [
        {
          code: "NO_SOURCES",
          severity: "REVIEW",
          text: "No data sources have been connected and scanned yet.",
        },
      ],
      perSource,
    };
  }

  let status: EligibilityStatus = "LIKELY_ELIGIBLE";
  const seen = new Set<string>();
  const reasons: EligibilityReason[] = [];
  for (const result of Object.values(perSource)) {
    status = mostConservative(status, result.status);
    for (const r of result.reasons) {
      if (r.severity === "INFO") continue;
      if (seen.has(r.code)) continue;
      seen.add(r.code);
      reasons.push(r);
    }
  }

  if (reasons.length === 0) {
    reasons.push({
      code: "SCREENING_PASSED",
      severity: "INFO",
      text:
        "No restricting condition was surfaced across your connected sources. This is a screening result only and does not confirm your rights to license this data.",
    });
  }

  return {
    status,
    engineVersion: ELIGIBILITY_ENGINE_VERSION,
    reasons,
    ratesUnlocked: status === "LIKELY_ELIGIBLE",
    perSource,
  };
}

export const ELIGIBILITY_LABELS: Record<
  EligibilityStatus,
  { label: string; tone: "positive" | "caution" | "negative"; blurb: string }
> = {
  LIKELY_ELIGIBLE: {
    label: "Screening passed",
    tone: "positive",
    blurb: "No restricting condition surfaced. Rights are still unverified.",
  },
  REVIEW_REQUIRED: {
    label: "Rights review required",
    tone: "caution",
    blurb: "Something in this corpus needs a human rights review before any rate is meaningful.",
  },
  LIKELY_INELIGIBLE: {
    label: "Not licensable on this basis",
    tone: "negative",
    blurb: "A blocking condition was reported for this source.",
  },
};
