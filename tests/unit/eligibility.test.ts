import { describe, expect, it } from "vitest";
import {
  assessOrganization,
  assessSource,
  mostConservative,
  type QuestionnaireInput,
  type SourceInput,
} from "@/lib/eligibility/engine";

/** A questionnaire with nothing restricting in it. The only path to LIKELY_ELIGIBLE. */
const CLEAN: QuestionnaireInput = {
  industry: "Manufacturing",
  dataAgeRange: "3–7 years",
  originCreatedOrControlled: "YES",
  thirdPartyPii: "NO",
  ndaBoundMaterial: "NO",
  employeePersonalData: "NO",
  uniqueness: "UNIQUE_PROPRIETARY",
  alreadyLicensed: "NO",
  exclusivityPossible: "YES",
  personalData: "NO",
  healthData: "NO",
  financialData: "NO",
  childrensData: "NO",
  biometricData: "NO",
  legalPrivilegeData: "NO",
  credentialData: "NO",
  exportControlledData: "NO",
  willingToAnonymize: "YES",
};

const FILE_SOURCE: SourceInput = {
  connectionId: "c1",
  provider: "DROPBOX",
  categoryKeys: ["documents", "images"],
  scopeLimited: false,
  hasMetrics: true,
};

describe("eligibility engine", () => {
  it("passes a clean file source and unlocks rates", () => {
    const r = assessSource(FILE_SOURCE, CLEAN);
    expect(r.status).toBe("LIKELY_ELIGIBLE");
    expect(r.ratesUnlocked).toBe(true);
  });

  it("defaults to REVIEW_REQUIRED with no questionnaire and keeps rates locked", () => {
    const r = assessSource(FILE_SOURCE, null);
    expect(r.status).toBe("REVIEW_REQUIRED");
    expect(r.ratesUnlocked).toBe(false);
    expect(r.reasons.map((x) => x.code)).toContain("QUESTIONNAIRE_INCOMPLETE");
  });

  it("never returns LIKELY_ELIGIBLE for a source with no completed scan", () => {
    const r = assessSource({ ...FILE_SOURCE, hasMetrics: false }, CLEAN);
    expect(r.status).toBe("REVIEW_REQUIRED");
    expect(r.ratesUnlocked).toBe(false);
  });

  // --- the forcing rules, one test per sensitive category ------------------
  const SENSITIVE_FIELDS = [
    "personalData",
    "healthData",
    "financialData",
    "childrensData",
    "biometricData",
    "legalPrivilegeData",
    "credentialData",
    "exportControlledData",
  ] as const;

  for (const field of SENSITIVE_FIELDS) {
    it(`forces at least REVIEW_REQUIRED and suppresses rates when ${field} is YES`, () => {
      const r = assessSource(FILE_SOURCE, { ...CLEAN, [field]: "YES" });
      expect(r.status).not.toBe("LIKELY_ELIGIBLE");
      expect(r.ratesUnlocked).toBe(false);
      expect(r.reasons.some((x) => x.code === `SENSITIVE_${field.toUpperCase()}`)).toBe(true);
    });

    it(`treats "not sure" on ${field} exactly like yes`, () => {
      const r = assessSource(FILE_SOURCE, { ...CLEAN, [field]: "UNSURE" });
      expect(r.status).not.toBe("LIKELY_ELIGIBLE");
      expect(r.ratesUnlocked).toBe(false);
    });
  }

  it("escalates credentials to LIKELY_INELIGIBLE", () => {
    const r = assessSource(FILE_SOURCE, { ...CLEAN, credentialData: "YES" });
    expect(r.status).toBe("LIKELY_INELIGIBLE");
  });

  it("escalates legal privilege to LIKELY_INELIGIBLE", () => {
    const r = assessSource(FILE_SOURCE, { ...CLEAN, legalPrivilegeData: "YES" });
    expect(r.status).toBe("LIKELY_INELIGIBLE");
  });

  it("forces REVIEW_REQUIRED on third-party PII", () => {
    const r = assessSource(FILE_SOURCE, { ...CLEAN, thirdPartyPii: "YES" });
    expect(r.status).toBe("REVIEW_REQUIRED");
    expect(r.ratesUnlocked).toBe(false);
  });

  it("forces REVIEW_REQUIRED on NDA-bound counterparty material", () => {
    const r = assessSource(FILE_SOURCE, { ...CLEAN, ndaBoundMaterial: "YES" });
    expect(r.status).toBe("REVIEW_REQUIRED");
  });

  it("forces REVIEW_REQUIRED on employee personal data", () => {
    const r = assessSource(FILE_SOURCE, { ...CLEAN, employeePersonalData: "YES" });
    expect(r.status).toBe("REVIEW_REQUIRED");
  });

  it("makes a source LIKELY_INELIGIBLE when the business neither created nor controls it", () => {
    const r = assessSource(FILE_SOURCE, { ...CLEAN, originCreatedOrControlled: "NO" });
    expect(r.status).toBe("LIKELY_INELIGIBLE");
    expect(r.ratesUnlocked).toBe(false);
  });

  // --- structural communications rule --------------------------------------
  for (const provider of ["MICROSOFT", "GOOGLE", "SLACK"] as const) {
    it(`defaults ${provider} to REVIEW_REQUIRED even with a perfectly clean questionnaire`, () => {
      const r = assessSource({ ...FILE_SOURCE, provider }, CLEAN);
      expect(r.status).toBe("REVIEW_REQUIRED");
      expect(r.ratesUnlocked).toBe(false);
      expect(r.reasons.map((x) => x.code)).toContain("COMMUNICATIONS_CORPUS");
    });
  }

  it("treats an email or chat category as a communications corpus regardless of provider", () => {
    const r = assessSource({ ...FILE_SOURCE, categoryKeys: ["documents", "email"] }, CLEAN);
    expect(r.status).toBe("REVIEW_REQUIRED");
    expect(r.reasons.map((x) => x.code)).toContain("COMMUNICATIONS_CORPUS");
  });

  it("forces review when the provider could not measure the whole corpus", () => {
    const r = assessSource({ ...FILE_SOURCE, scopeLimited: true }, CLEAN);
    expect(r.status).toBe("REVIEW_REQUIRED");
    expect(r.reasons.map((x) => x.code)).toContain("SCOPE_LIMITED");
  });

  it("never asserts that data is sellable, cleared or compliant", () => {
    const results = [
      assessSource(FILE_SOURCE, CLEAN),
      assessSource(FILE_SOURCE, null),
      assessSource({ ...FILE_SOURCE, provider: "SLACK" }, CLEAN),
    ];
    const forbidden = /\b(you may (legally )?sell|legally sellable|cleared for sale|is compliant|you own the rights|guaranteed)\b/i;
    for (const r of results) {
      for (const reason of r.reasons) {
        expect(reason.text).not.toMatch(forbidden);
      }
    }
  });

  // --- roll-up -------------------------------------------------------------
  it("rolls up to the most conservative status across sources", () => {
    const r = assessOrganization(
      [FILE_SOURCE, { ...FILE_SOURCE, connectionId: "c2", provider: "SLACK" }],
      CLEAN
    );
    expect(r.status).toBe("REVIEW_REQUIRED");
    expect(r.perSource.c1.status).toBe("LIKELY_ELIGIBLE");
    expect(r.perSource.c2.status).toBe("REVIEW_REQUIRED");
    expect(r.ratesUnlocked).toBe(false);
  });

  it("returns REVIEW_REQUIRED, not LIKELY_ELIGIBLE, when there are no sources at all", () => {
    const r = assessOrganization([], CLEAN);
    expect(r.status).toBe("REVIEW_REQUIRED");
    expect(r.ratesUnlocked).toBe(false);
  });

  it("orders statuses conservatively", () => {
    expect(mostConservative("LIKELY_ELIGIBLE", "REVIEW_REQUIRED")).toBe("REVIEW_REQUIRED");
    expect(mostConservative("LIKELY_INELIGIBLE", "REVIEW_REQUIRED")).toBe("LIKELY_INELIGIBLE");
    expect(mostConservative("LIKELY_ELIGIBLE", "LIKELY_ELIGIBLE")).toBe("LIKELY_ELIGIBLE");
  });
});
