import { expect, test, type Page } from "@playwright/test";
import { fixture } from "./fixture";

const now = new Date("2026-10-25T12:00:00Z");
const ids = (page: Page) => page.getByTestId("story-row").evaluateAll(rows =>
  rows.map(row => row.getAttribute("data-article-id")));

async function readingFixture(page: Page) {
  await page.clock.setFixedTime(now);
  await fixture(page);
  await page.evaluate(at => {
    const w = window as any, s = w.__TEST_SNAPSHOT__();
    w.__TEST_PATCH__({ articles: s.articles.map((a: any, i: number) => ({
      ...a,
      sourceId: i === 1 ? "orbital" : "science",
      sourceName: i === 1 ? "Orbital Review" : "Science Wire",
      publishedAt: i === 0 ? at - 3600 : i === 1 ? at - 2 * 86400 : null,
      read: i === 1,
    })) });
    window.dispatchEvent(new Event("data-changed"));
  }, now.getTime() / 1000);
  await page.getByRole("button", { name: /^More filters/ }).click();
  await expect(page.getByLabel("Publisher", { exact: true }).locator("option")).toHaveCount(3);
}

test("publisher and reading filters intersect and empty results can be cleared", async ({ page }) => {
  await readingFixture(page);
  await page.getByLabel("Publisher", { exact: true }).selectOption("orbital");
  await expect.poll(() => ids(page)).toEqual(["b"]);
  await page.getByLabel("Reading status", { exact: true }).selectOption("unread");
  await expect(page.getByRole("heading", { name: "No stories match these filters" })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect.poll(() => ids(page)).toEqual(["a", "b", "c"]);
  await expect(page.getByLabel("Publisher", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Reading status", { exact: true })).toHaveValue("all");
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) =>
    r.op === "article_state" || r.op === "article_state_many"))).toEqual([]);
});

test("publication filters use publication dates and disclose undated exclusions", async ({ page }) => {
  await readingFixture(page);
  await page.getByLabel("Published", { exact: true }).selectOption("day");
  await expect.poll(() => ids(page)).toEqual(["a"]);
  await expect(page.getByText("Date filters exclude stories without a publication time.", { exact: true })).toBeVisible();
  await page.getByLabel("Published", { exact: true }).selectOption("week");
  await expect.poll(() => ids(page)).toEqual(["a", "b"]);
  await page.getByLabel("Publisher", { exact: true }).selectOption("orbital");
  await expect.poll(() => ids(page)).toEqual(["b"]);
  await page.getByRole("button", { name: /^More filters/ }).click();
  await expect(page.getByRole("button", { name: "More filters (2)", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => ids(page)).toEqual(["b"]);
});

test("navigation resets extra filters and clears page selection", async ({ page }) => {
  await readingFixture(page);
  await page.getByLabel("Publisher", { exact: true }).selectOption("orbital");
  await page.getByLabel("Published", { exact: true }).selectOption("week");
  await page.getByRole("button", { name: "Select this page", exact: true }).click();
  await expect(page.getByRole("region", { name: "Bulk actions" })).toBeVisible();
  await page.getByRole("button", { name: "Saved stories", exact: true }).click();
  await expect(page.getByLabel("Publisher", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Published", { exact: true })).toHaveValue("all");
  await expect(page.getByRole("region", { name: "Bulk actions" })).toHaveCount(0);
});

test("select page stays within 100 rows and unsaves in one batch without marking read", async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    const w = window as any, s = w.__TEST_SNAPSHOT__();
    w.__TEST_PATCH__({ articles: Array.from({ length: 105 }, (_, i) => ({
      ...s.articles[0], id: `page-${i}`, title: `Saved report ${i}`, saved: true,
    })) });
    window.dispatchEvent(new Event("data-changed"));
  });
  await page.getByRole("button", { name: "105 new stories · Show latest", exact: true }).click();
  await page.evaluate(() => { (window as any).__TEST_CALLS__.length = 0; });
  await page.getByRole("button", { name: "Select this page", exact: true }).click();
  await expect(page.getByRole("region", { name: "Bulk actions" })).toContainText("100 selected");
  expect(await page.evaluate(() => (window as any).__TEST_SNAPSHOT__().articles.some((a: any) => a.read))).toBe(false);
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) => r.op.startsWith("article_state")))).toEqual([]);
  await page.getByRole("region", { name: "Bulk actions" }).getByRole("button", { name: "Unsave", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_SNAPSHOT__().articles.filter((a: any) => a.saved).map((a: any) => a.id)))
    .toEqual(["page-100", "page-101", "page-102", "page-103", "page-104"]);
  const batches = await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) => r.op === "article_state_many"));
  expect(batches).toHaveLength(1);
  expect(batches[0].profileId).toBe("default");
  expect(batches[0].items).toHaveLength(100);
  expect(batches[0].items[0]).toEqual({ articleId: "page-0", saved: false });
  expect(await page.evaluate(() => (window as any).__TEST_SNAPSHOT__().articles.some((a: any) => a.read))).toBe(false);
  await page.getByRole("button", { name: "Select this page", exact: true }).click();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByRole("region", { name: "Bulk actions" })).toHaveCount(0);
  await page.getByRole("button", { name: "Select this page", exact: true }).click();
  await expect(page.getByRole("region", { name: "Bulk actions" })).toContainText("5 selected");
  await page.getByRole("button", { name: "Clear selection", exact: true }).click();
  await expect(page.getByRole("region", { name: "Bulk actions" })).toHaveCount(0);
});

test("changing an extra filter clears bulk selection", async ({ page }) => {
  await readingFixture(page);
  await page.getByRole("button", { name: "Select this page", exact: true }).click();
  await expect(page.getByRole("region", { name: "Bulk actions" })).toContainText("3 selected");
  await page.getByLabel("Publisher", { exact: true }).selectOption("orbital");
  await expect(page.getByRole("region", { name: "Bulk actions" })).toHaveCount(0);
  await expect.poll(() => ids(page)).toEqual(["b"]);
});

test("extra filters and selection stay reachable in a narrow short window", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 450 });
  await readingFixture(page);
  await page.getByLabel("Published", { exact: true }).selectOption("week");
  await page.getByRole("button", { name: "Select this page", exact: true }).click();
  const unsave = page.getByRole("region", { name: "Bulk actions" }).getByRole("button", { name: "Unsave", exact: true });
  await unsave.scrollIntoViewIfNeeded();
  await expect(unsave).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Clear selection", exact: true }).click();
  await page.getByRole("button", { name: /^More filters/ }).click();
  await expect(page.getByTestId("story-row").first()).toBeInViewport();
});

test("pagination returns to the top when a short window scrolls the expanded tools", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 450 });
  await fixture(page);
  await page.evaluate(() => {
    const w = window as any, s = w.__TEST_SNAPSHOT__();
    w.__TEST_PATCH__({ articles: Array.from({ length: 105 }, (_, i) => ({
      ...s.articles[0], id: `scroll-${i}`, title: `Page report ${i}`,
    })) });
    window.dispatchEvent(new Event("data-changed"));
  });
  await page.getByRole("button", { name: "105 new stories · Show latest", exact: true }).click();
  await page.getByRole("button", { name: /^More filters/ }).click();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByTestId("story-row").first()).toHaveAttribute("data-article-id", "scroll-100");
  await expect.poll(() => page.locator("main.headlines").evaluate(el => el.scrollTop)).toBe(0);
  await expect(page.getByRole("button", { name: "Select this page", exact: true })).toBeInViewport();
});
