import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";
import { completeQuestionnaire, enterDemo, reseedDemo } from "./helpers";

/**
 * Whole-product hygiene: no console errors, no failed requests, no dead internal
 * links, no leftover placeholder copy, and no credential leaking into the page.
 */
const PUBLIC_PAGES = ["/", "/data-payout", "/terms", "/privacy", "/security", "/contact", "/demo", "/signin", "/signup"];
const APP_PAGES = ["/dashboard", "/sources", "/questionnaire", "/report", "/review", "/settings"];

function collectProblems(page: Page) {
  const problems: string[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") problems.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
  page.on("requestfailed", (req) => {
    // Navigations the test itself aborts are not product defects.
    if (req.failure()?.errorText === "net::ERR_ABORTED") return;
    problems.push(`requestfailed: ${req.url()} ${req.failure()?.errorText}`);
  });
  return problems;
}

test("public pages render cleanly", async ({ page }) => {
  const problems = collectProblems(page);
  for (const path of PUBLIC_PAGES) {
    const res = await page.goto(path);
    expect(res?.status(), `${path} status`).toBeLessThan(400);
    await expect(page.locator("main")).toBeVisible();
    const text = await page.locator("body").innerText();
    expect(text, `${path} placeholder copy`).not.toMatch(/lorem ipsum|TODO|FIXME|\bTBD\b/i);
  }
  expect(problems).toEqual([]);
});

test("application pages render cleanly for a signed-in user", async ({ page }) => {
  reseedDemo();
  const problems = collectProblems(page);
  await enterDemo(page);
  for (const path of APP_PAGES) {
    const res = await page.goto(path);
    expect(res?.status(), `${path} status`).toBeLessThan(400);
    await expect(page.locator("main")).toBeVisible();
  }
  expect(problems).toEqual([]);
});

test("every internal link resolves", async ({ page, request }) => {
  reseedDemo();
  await enterDemo(page);
  const seen = new Set<string>();

  for (const path of [...PUBLIC_PAGES, ...APP_PAGES]) {
    await page.goto(path);
    const hrefs = await page.locator("a[href^='/']").evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? "")
    );
    for (const href of hrefs) {
      const clean = href.split("#")[0];
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);
      const res = await request.get(clean, { maxRedirects: 0 });
      expect([200, 307, 308], `${clean} from ${path}`).toContain(res.status());
    }
  }
  expect(seen.size).toBeGreaterThan(5);
});

test("coming-soon sources are disabled, not dressed up as working", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/sources");
  const comingSoon = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /coming soon/i }) });
  const buttons = comingSoon.getByRole("button");
  const count = await buttons.count();
  expect(count).toBeGreaterThan(5);
  for (let i = 0; i < count; i++) {
    await expect(buttons.nth(i)).toBeDisabled();
  }
});

test("no credential or token ever reaches the page", async ({ page }) => {
  reseedDemo();
  await enterDemo(page);
  await completeQuestionnaire(page);

  for (const path of ["/dashboard", "/report", "/sources", "/settings"]) {
    await page.goto(path);
    const html = await page.content();
    expect(html).not.toMatch(/accessTokenEnc|refreshTokenEnc|passwordHash/);
    // The AES-GCM envelope format, in case a token were ever serialised.
    expect(html).not.toMatch(/\bv1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\./);
  }

  const storage = await page.evaluate(() => ({
    local: JSON.stringify(window.localStorage),
    session: JSON.stringify(window.sessionStorage),
  }));
  expect(storage.local).toBe("{}");
  expect(storage.session).toBe("{}");
});

test("the permission screen is shown before any provider consent", async ({ page }) => {
  reseedDemo();
  await enterDemo(page);
  await page.goto("/sources/dropbox");
  await expect(page.getByRole("heading", { name: /connect dropbox/i })).toBeVisible();
  await expect(page.getByText(/what we will read/i)).toBeVisible();
  await expect(page.getByText(/what we will not read/i)).toBeVisible();
  await expect(page.getByText("account_info.read")).toBeVisible();
  await expect(page.getByText("files.metadata.read")).toBeVisible();
  // A demo organisation is told plainly that it cannot authorize a real account.
  await expect(page.getByText(/cannot authorize a real provider account/i)).toBeVisible();
});
