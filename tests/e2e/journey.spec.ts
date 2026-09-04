import { expect, test } from "@playwright/test";
import {
  completeQuestionnaire,
  connectedSourceCount,
  reseedDemo,
  visibleDollarFigures,
  waitForScansToSettle,
} from "./helpers";

/**
 * The full happy path in demo mode:
 * landing -> demo -> add a source -> scan completes -> measured volume increases
 * -> questionnaire -> eligibility result -> verified-review confirmation.
 */
test.beforeEach(() => reseedDemo());

test("full demo journey", async ({ page }) => {
  // --- landing -------------------------------------------------------------
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Know what data your business actually has"
  );

  // The homepage must not price anything.
  expect(await visibleDollarFigures(page)).toHaveLength(0);

  await page.getByRole("link", { name: /view demo/i }).first().click();
  await page.waitForURL("**/demo");
  await page.getByRole("button", { name: /enter the demo/i }).click();
  await page.waitForURL("**/dashboard");

  // --- demo is labelled as demo -------------------------------------------
  await expect(page.getByText("Demo data").first()).toBeVisible();
  await expect(page.getByText(/No provider account is connected/i)).toBeVisible();

  // --- disconnect a source, then add it back so the scan runs for real -----
  const slackCard = page.locator("div").filter({ hasText: /^Slack/ }).first();
  await slackCard.getByRole("link", { name: /disconnect/i }).click();
  await page.waitForURL("**/disconnect/**");
  await expect(page.getByRole("heading", { name: /disconnect slack/i })).toBeVisible();
  await page.getByRole("button", { name: /disconnect and delete/i }).click();
  await page.waitForURL("**/dashboard");
  // Scoped to the connected-sources list: Slack also appears in the "Add another
  // source" grid once it is disconnected, which is the correct behaviour.
  const connectedSources = page.locator("section").filter({
    has: page.getByRole("heading", { name: /^connected sources$/i }),
  });
  await expect(connectedSources.getByRole("heading", { name: "Slack", exact: true })).toHaveCount(0);

  const sourcesWithoutSlack = await connectedSourceCount(page);

  // --- add the demo source back -------------------------------------------
  await page.goto("/sources");
  const slackSourceCard = page
    .locator("li")
    .filter({ has: page.getByRole("heading", { name: "Slack", exact: true }) });
  await slackSourceCard.getByRole("button", { name: /add demo source/i }).click();
  await page.waitForURL("**/dashboard");

  // --- scan completes and the measured volume goes back up -----------------
  await waitForScansToSettle(page);
  await page.reload();
  await expect(connectedSources.getByRole("heading", { name: "Slack", exact: true })).toBeVisible();
  await expect(page.getByText(/File volume only/i).first()).toBeVisible();

  // The org total is displayed to one decimal of TB, so a 27 GB source does not
  // move it. Assert on what actually changed: the source is back in the list and
  // its own measured volume is showing.
  expect(await connectedSourceCount(page)).toBe(sourcesWithoutSlack + 1);
  const rescannedSlackCard = page
    .locator("div.rounded-lg")
    .filter({ has: page.getByRole("heading", { name: "Slack", exact: true }) })
    .last();
  await expect(rescannedSlackCard).toContainText("27.3 GB");

  // --- questionnaire -------------------------------------------------------
  await completeQuestionnaire(page);

  // --- eligibility result --------------------------------------------------
  await expect(page.getByRole("heading", { name: /Data Inventory & Eligibility Report/i })).toBeVisible();
  await expect(page.getByText("Rights review required").first()).toBeVisible();
  // The communications-corpus rule is stated on the report, not buried.
  await expect(page.getByText(/communications corpus/i).first()).toBeVisible();

  // --- verified review request --------------------------------------------
  await page.getByRole("link", { name: /request a verified review/i }).first().click();
  await page.waitForURL("**/review");

  await page.fill("#contactRole", "Operations Director");
  await page.check('input[name="consentToContact"]');
  await page.check('input[name="acknowledgedNotAnOffer"]');
  await page.getByRole("button", { name: /request a review/i }).click();

  await page.waitForURL("**/review/submitted**");
  await expect(page.getByRole("heading", { name: /request has been received/i })).toBeVisible();
  await expect(page.getByText(/no file, email or customer record was included/i)).toBeVisible();
});

test("signup and onboarding create a real organisation", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;

  await page.goto("/");
  await page.getByRole("link", { name: /run my data inventory/i }).first().click();
  await page.waitForURL("**/signup");

  await page.fill("#name", "Test Operator");
  await page.fill("#email", email);
  await page.fill("#password", "a-long-enough-password");
  await page.getByRole("button", { name: /create account/i }).click();

  await page.waitForURL("**/onboarding");
  await page.fill("#name", "E2E Logistics Ltd");
  await page.selectOption("#industry", "Logistics & transport");
  await page.selectOption("#employeeRange", "10–49");
  await page.getByRole("button", { name: /continue to sources/i }).click();

  await page.waitForURL("**/sources");
  await expect(page.getByRole("heading", { name: /data sources/i })).toBeVisible();

  // A brand new organisation has nothing measured and therefore no dollar figure.
  await page.goto("/dashboard");
  await expect(page.getByText(/nothing measured yet/i)).toBeVisible();
  expect(await visibleDollarFigures(page)).toHaveLength(0);
});
