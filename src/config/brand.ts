/**
 * Single source of truth for brand, buyer identity, contact details and the
 * illustrative rate seeds. Change values here, not in components.
 *
 * FRAMING CONSTRAINT (see README "Why there is no dollar headline"):
 * Nothing in this file may be used to render a portfolio dollar total. Dollar
 * figures are per-unit indicative *rate ranges* only, per source, and only after
 * the eligibility assessment unlocks them. FTC Section 5 deception is judged on
 * the net impression of a communication, not on the presence of a disclaimer —
 * a big number with fine print fails that test, so the number does not exist.
 */

export const brand = {
  name: "DataValue",
  logoText: "DataValue",
  tagline: "Know what data your business actually has.",
  supportingText:
    "DataValue securely inventories your business data volume and assesses licensing eligibility. Metadata only — we never read your files, email or customer records.",
  primaryCta: "Run my data inventory",

  // The organisation that would conduct a verified review. Placeholder.
  buyer: {
    companyName: "DataValue Data Partners, Inc.",
    legalNotice: "DataValue is a data inventory and eligibility assessment tool.",
  },

  contact: {
    // Where verified-review leads are delivered. Never contact anyone else.
    internalLeadEmail: process.env.LEAD_NOTIFICATION_EMAIL ?? "leads@example.com",
    publicEmail: "hello@example.com",
    publicPhone: "",
    addressLines: ["Address placeholder", "City, ST 00000"],
  },

  colors: {
    // Restrained financial-product palette: neutral grounds, navy text, one emerald accent.
    accent: "#0f766e",
    accentForeground: "#ffffff",
    ink: "#111827",
    inkMuted: "#4b5563",
    surface: "#ffffff",
    ground: "#f8fafc",
    border: "#e5e7eb",
  },

  legal: {
    /** Rendered on every screen that shows a rate. Plain language, no hedging. */
    rateDisclosure:
      "These are illustrative reference rates for comparable licensed corpora. They are not quotes, offers, or appraisals. Your business's own rights to license this data have not been verified.",
    /** Rendered wherever a connection is made. */
    connectionDisclosure:
      "Connecting an account is not a sale or a license. It grants read-only, metadata-only access so we can measure volume. Nothing is sold or shared without a separate signed agreement.",
    /** Rendered on the legal placeholder pages. */
    placeholderNotice:
      "This page is a placeholder. It requires legal review before production use.",
    /** Rendered wherever eligibility is displayed. */
    eligibilityDisclosure:
      "This is an automated screening based on your answers and measured metadata. It is not legal advice and does not determine whether you may lawfully license this data.",
  },

  /**
   * Illustrative reference points, seeded into ValuationRate. Every value carries
   * a sourceNote explaining where it came from; admins can edit these without code.
   * These are deliberately conservative — they are chosen to be defensible if
   * questioned, not to make a demo look impressive.
   */
  seedRates: {
    formulaVersion: "1.0.0",
  },

  demo: {
    badgeLabel: "Demo data",
    orgName: "Northwind Supply Co. (Demo)",
    email: "demo@datavalue.example",
  },
} as const;

export type Brand = typeof brand;
