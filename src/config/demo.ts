/**
 * Demo organisation credentials.
 *
 * These are seeded, published in the README, and grant access to nothing but the
 * fixed sample dataset. The demo organisation cannot connect a live provider
 * account: /api/connect/[provider]/start refuses demo organisations outright.
 */
export const DEMO_USER_EMAIL = "demo@datavalue.example";
export const DEMO_USER_PASSWORD = "demo-inventory-2026";

export function demoModeEnabled(): boolean {
  return process.env.DEMO_MODE_ENABLED !== "false";
}
