/**
 * Shared option lists.
 *
 * These live in a plain module, NOT in a "use server" file. A file marked
 * "use server" may only export async functions; any other export is rewritten
 * into an action reference at build time, so a constant array imported from one
 * arrives at the client as something that is not an array.
 */
export const INDUSTRIES = [
  "Professional services",
  "Construction & trades",
  "Healthcare services",
  "Financial services",
  "Legal services",
  "Retail & e-commerce",
  "Manufacturing",
  "Logistics & transport",
  "Real estate",
  "Media & marketing",
  "Technology",
  "Education",
  "Non-profit",
  "Other",
] as const;

export const EMPLOYEE_RANGES = ["1–9", "10–49", "50–199", "200–499", "500+"] as const;

export const DATA_AGE_RANGES = [
  "Under 1 year",
  "1–3 years",
  "3–7 years",
  "7–15 years",
  "Over 15 years",
] as const;
