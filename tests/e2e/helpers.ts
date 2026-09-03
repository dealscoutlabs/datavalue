import { execSync } from "node:child_process";
import type { Page } from "@playwright/test";

/**
 * Restores the demo organisation to its seeded state: five measured sources and
 * NO questionnaire response, so no dollar figure exists anywhere.
 *
 * Called explicitly by any spec whose precondition is "nothing has been answered
 * yet". Projects run sequentially against one database, so a spec that submits a
 * questionnaire would otherwise leak that state into the next project's run.
 */
export function reseedDemo() {
  execSync("npx dotenv -e .env -- tsx prisma/seed.ts", { stdio: "ignore" });
}

export async function enterDemo(page: Page) {
  await page.goto("/demo");
  await page.getByRole("button", { name: /enter the demo/i }).click();
  await page.waitForURL("**/dashboard");
}

/** Waits until no source card is still showing a running scan. */
export async function waitForScansToSettle(page: Page) {
  await page
    .locator('[role="progressbar"]')
    .first()
    .waitFor({ state: "detached", timeout: 60_000 })
    .catch(() => {
      /* no scan was running */
    });
}

const CLEAN_ANSWERS: Record<string, string> = {
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
  contactMethod: "EMAIL",
};

/**
 * Fills the questionnaire with answers that surface no restricting condition.
 * Pass overrides to test a specific forcing rule end to end.
 */
export async function completeQuestionnaire(page: Page, overrides: Record<string, string> = {}) {
  await page.goto("/questionnaire");
  await page.selectOption("#industry", "Logistics & transport");
  await page.selectOption("#dataAgeRange", "7–15 years");

  const answers = { ...CLEAN_ANSWERS, ...overrides };
  for (const [name, value] of Object.entries(answers)) {
    await page.locator(`input[name="${name}"][value="${value}"]`).check();
  }

  await page.getByRole("button", { name: /get my eligibility assessment/i }).click();
  await page.waitForURL("**/report");
}

/** The dashboard's total measured volume, in bytes, parsed from the summary. */
export async function measuredVolume(page: Page): Promise<number> {
  const text = await page
    .locator("dd")
    .filter({ hasText: /^[\d.,]+ (B|KB|MB|GB|TB)$/ })
    .first()
    .innerText();
  const [, value, unit] = text.match(/^([\d.,]+)\s+(B|KB|MB|GB|TB)$/) ?? [];
  const factor = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }[unit] ?? 0;
  return Number(value.replace(/,/g, "")) * factor;
}

/** Every visible currency figure on the page. */
export async function visibleDollarFigures(page: Page): Promise<string[]> {
  const text = await page.locator("main").innerText();
  return text.match(/\$[\d,]+(\.\d+)?/g) ?? [];
}
