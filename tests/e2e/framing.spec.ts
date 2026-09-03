import { expect, test } from "@playwright/test";
import { completeQuestionnaire, enterDemo, reseedDemo, visibleDollarFigures } from "./helpers";

/**
 * These are the tests that protect the product's central framing constraint.
 * If any of them fails, the product is making a claim it cannot support.
 */
test.describe("no dollar figure before the questionnaire", () => {
  // Precondition: the demo has measured sources but no rights answers.
  test.beforeEach(() => reseedDemo());

  test("dashboard shows measurement and eligibility, never currency", async ({ page }) => {
    await enterDemo(page);
    // Seeded demo has five measured sources and no questionnaire response.
    await expect(page.getByRole("heading", { name: /data inventory/i })).toBeVisible();
    await expect(page.getByText(/Total measured volume/i)).toBeVisible();

    expect(await visibleDollarFigures(page)).toHaveLength(0);
    await expect(page.getByText(/indicative reference rate/i)).toHaveCount(0);
  });

  test("report suppresses every rate until the questionnaire is submitted", async ({ page }) => {
    await enterDemo(page);
    await page.goto("/report");

    expect(await visibleDollarFigures(page)).toHaveLength(0);
    await expect(
      page.getByText(/does not show a dollar figure of any kind before the eligibility assessment/i)
    ).toBeVisible();
  });
});

test.describe("no dollar figure for a source that needs review", () => {
  test("rates appear only for sources that passed, and never as a portfolio total", async ({ page }) => {
    await enterDemo(page);
    await completeQuestionnaire(page);

    // Dropbox and HubSpot pass the screening; the three communications corpora do not.
    await expect(page.getByText(/indicative reference rate/i).first()).toBeVisible();

    const figures = await visibleDollarFigures(page);
    expect(figures.length).toBeGreaterThan(0);

    // Every rate carries its unit label, so no figure can read as a total.
    const reportText = await page.locator("main").innerText();
    expect(reportText).toMatch(/per GB/);
    expect(reportText).toMatch(/These are not added together/i);
    expect(reportText).not.toMatch(/total (estimated )?value/i);
    expect(reportText).not.toMatch(/your data is worth/i);
    // The measurement section is currency-free: no total lives beside the volume.
    const measured = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: /1\. What was measured/i }) });
    expect((await measured.innerText()).match(/\$/g) ?? []).toHaveLength(0);

    // Every currency figure on the page sits next to a per-unit label.
    for (const figure of figures) {
      const idx = reportText.indexOf(figure);
      const window = reportText.slice(Math.max(0, idx - 400), idx + 400);
      expect(window).toMatch(/per GB|per usable record|Base rate/);
    }
  });

  test("a suppressed source shows the review notice instead of a rate", async ({ page }) => {
    await enterDemo(page);
    await completeQuestionnaire(page);
    await page.goto("/dashboard");

    const slackCard = page
      .locator("div.rounded-lg")
      .filter({ has: page.getByRole("heading", { name: "Slack", exact: true }) })
      .last();

    await expect(slackCard.getByText(/rights review required/i).first()).toBeVisible();
    await expect(slackCard.getByText(/indicative reference rate/i)).toHaveCount(0);
    expect((await slackCard.innerText()).match(/\$[\d,]+(\.\d+)?/g) ?? []).toHaveLength(0);
  });

  test("a sensitive answer suppresses every rate again", async ({ page }) => {
    await enterDemo(page);
    // Health data present anywhere forces at least REVIEW_REQUIRED for every source.
    await completeQuestionnaire(page, { healthData: "YES" });

    expect(await visibleDollarFigures(page)).toHaveLength(0);
    await expect(page.getByText(/no connected source passed the eligibility screening/i)).toBeVisible();
  });

  test("the dashboard summary never shows a currency total even when rates exist", async ({ page }) => {
    await enterDemo(page);
    await completeQuestionnaire(page);
    await page.goto("/dashboard");

    const summary = page.locator("div.rounded-lg").first();
    expect((await summary.innerText()).match(/\$/g) ?? []).toHaveLength(0);
  });
});
