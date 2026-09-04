import { expect, test } from "@playwright/test";

/**
 * The estimator is a marketing page and deliberately shows currency. It lives on
 * its own route so the product surfaces — homepage, dashboard, report — stay
 * currency-free and their framing assertions keep holding.
 */
test("estimator renders the published default range", async ({ page }) => {
  await page.goto("/data-payout");
  const main = page.locator("main");
  await expect(main).toContainText("$285,896");
  await expect(main).toContainText("$604,463");
});

test("estimator recalculates from the inputs", async ({ page }) => {
  await page.goto("/data-payout");
  await page.fill("#employees", "100");
  await page.fill("#years", "5");
  await expect(page.locator("main")).toContainText("$329,633");
  await expect(page.locator("main")).toContainText("$677,356");

  await page.selectOption("#region", "OTHER");
  await page.fill("#employees", "50");
  await page.fill("#years", "10");
  await expect(page.locator("main")).toContainText("$85,769");
});

test("the estimator does not leak currency onto the product surfaces", async ({ page }) => {
  await page.goto("/");
  const home = await page.locator("main").innerText();
  expect(home.match(/\$[\d,]+/g) ?? []).toHaveLength(0);
  // ...but the homepage does link to it.
  await expect(page.getByRole("link", { name: /try the estimator/i })).toBeVisible();
});
