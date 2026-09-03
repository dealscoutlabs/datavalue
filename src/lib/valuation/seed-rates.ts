/**
 * Illustrative reference base rates.
 *
 * READ THIS BEFORE CHANGING A NUMBER.
 *
 * These are not market quotes, not appraisals, and not offers. They are
 * reference points, and each carries a note saying where it came from so that
 * the question "where did you get that number?" has an answer.
 *
 * The honest position, stated in the UI and the README: almost no publicly
 * reported corpus-licensing transaction discloses a per-GB or per-record rate.
 * The figures below are therefore either (a) derived from a reported per-asset
 * price, or (b) taken from an observable per-record market. Anything derived by
 * dividing a headline deal value by a guessed corpus size is deliberately NOT
 * used here, because that arithmetic is not defensible.
 *
 * They are also deliberately conservative. Seeding a flattering number to make a
 * demo land better is exactly the failure mode this product exists to avoid.
 */
import type { DataUnitType, ProviderKey } from "@/generated/prisma";

export type SeedRate = {
  provider: ProviderKey;
  unitType: DataUnitType;
  baseRate: number;
  sourceNote: string;
};

export const SEED_RATES: SeedRate[] = [
  {
    provider: "DROPBOX",
    unitType: "UNSTRUCTURED_BYTES",
    baseRate: 8.0,
    sourceNote:
      "Derived from the low end of the publicly reported Photobucket per-asset licensing range (about $0.05 per image), which at a typical 3 MB image implies roughly $17/GB, then discounted by more than half because ordinary business file storage is a lower-signal, lower-demand corpus than a curated media library. Reference point only.",
  },
  {
    provider: "MICROSOFT",
    unitType: "UNSTRUCTURED_BYTES",
    baseRate: 6.0,
    sourceNote:
      "Set below the general file-storage reference because a Microsoft 365 measurement blends OneDrive files with mailbox volume, and mailbox volume is dominated by attachments and duplicated thread quoting. Reference point only.",
  },
  {
    provider: "GOOGLE",
    unitType: "UNSTRUCTURED_BYTES",
    baseRate: 6.0,
    sourceNote:
      "Matches the Microsoft 365 reference for the same reason: a Google Workspace measurement blends Drive with Gmail, and Google-native documents do not report ordinary file sizes at all. Reference point only.",
  },
  {
    provider: "SLACK",
    unitType: "UNSTRUCTURED_BYTES",
    baseRate: 5.0,
    sourceNote:
      "Lowest of the unstructured references because Slack can only be measured for shared files. The files are fragmentary by nature and the surrounding conversation, which is where most of the meaning sits, cannot be measured at all. Reference point only.",
  },
  {
    provider: "HUBSPOT",
    unitType: "STRUCTURED_RECORDS",
    baseRate: 0.25,
    sourceNote:
      "Taken from the observable B2B contact-data market, where per-record pricing for verified business contacts commonly sits between roughly $0.10 and $1.00 per record depending on verification depth. $0.25 sits in the lower third of that range because CRM exports are unverified at source. Reference point only.",
  },
  {
    provider: "DEMO",
    unitType: "UNSTRUCTURED_BYTES",
    baseRate: 8.0,
    sourceNote: "Mirrors the general file-storage reference. Used only by the demo organisation.",
  },
];

export const FORMULA_DESCRIPTION =
  "midpoint_rate = base_rate x quality x recency x rights x uniqueness. Low and high are 0.6x and 1.6x the midpoint. Rights can never exceed 1.0.";
