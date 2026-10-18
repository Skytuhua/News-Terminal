import { expect, test, type Page } from "@playwright/test";
import { fixture } from "./fixture";

const calls = (page: Page, op: string) => page.evaluate(
  op => (window as any).__TEST_CALLS__.filter((r: any) => r.op === op).length, op,
);
const painted = (page: Page) => page.evaluate(() => new Promise<void>(resolve =>
  requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
));

test("5000-story readbacks keep the selected page and search stable without serializing the cache", async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    const w = window as any, s = w.__TEST_SNAPSHOT__();
    w.__TEST_PATCH__({ articles: Array.from({ length: 5000 }, (_, i) => ({
      ...s.articles[0], id: `reader-${i}`, title: `Needle report ${i}`, groupId: `group-${i}`,
    })) });
    window.dispatchEvent(new Event("data-changed"));
  });
  await page.getByRole("button", { name: "5000 new stories · Show latest", exact: true }).click();
  await expect(page.getByTestId("story-row")).toHaveCount(100);
  await page.getByRole("searchbox").fill("Needle");
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_SNAPSHOT__().workspace.tabs[0].query)).toBe("Needle");
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await page.getByRole("button", { name: "Needle report 149", exact: true }).click();
  await expect(page.getByRole("button", { name: "Mark unread", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_SNAPSHOT__().workspace.tabs[0].selectedId)).toBe("reader-149");
  await page.getByRole("button", { name: "Save story", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unsave story", exact: true })).toBeVisible();
  const pageIds = await page.getByTestId("story-row").evaluateAll(rows => rows.map(row => row.getAttribute("data-article-id")));
  expect(pageIds).toEqual(Array.from({ length: 100 }, (_, i) => `reader-${100 + i}`));

  await page.evaluate(() => {
    const w = window as any;
    w.__TEST_CALLS__.length = 0;
    w.__READER_CACHE_SERIALIZATIONS__ = 0;
    const original = JSON.stringify;
    JSON.stringify = function (value: any, ...args: any[]) {
      const article = value && !Array.isArray(value) && typeof value.id === "string" && value.id.startsWith("reader-") && "sourceName" in value;
      const fullInput = Array.isArray(value) && (
        (value.length === 2 && Array.isArray(value[1]) && value[1].length >= 5000) ||
        (value.length === 3 && Array.isArray(value[2]) && value[2].length >= 5000)
      );
      if (article || fullInput) w.__READER_CACHE_SERIALIZATIONS__++;
      return (original as any)(value, ...args);
    } as typeof JSON.stringify;
  });
  await page.getByRole("button", { name: "Refresh feeds", exact: true }).click();
  await expect(page.getByText("Refresh complete · 1 updated · 0 source failures", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const w = window as any, s = w.__TEST_SNAPSHOT__();
    const articles = s.articles.map((a: any) => a.id === "reader-150" ? { ...a, read: true }
      : a.id === "reader-151" ? { ...a, saved: true } : a).reverse();
    articles.unshift({ ...articles[0], id: "pending-reader", title: "Needle pending arrival" });
    w.__TEST_PATCH__({ articles });
    window.dispatchEvent(new Event("data-changed"));
  });
  await expect(page.getByRole("button", { name: "1 new story · Show latest", exact: true })).toBeVisible();
  await expect(page.locator('[data-article-id="reader-150"]')).toHaveClass(/\bread\b/);
  await expect(page.locator('[data-article-id="reader-151"]').getByLabel("Saved", { exact: true })).toBeVisible();
  expect(await page.getByTestId("story-row").evaluateAll(rows => rows.map(row => row.getAttribute("data-article-id")))).toEqual(pageIds);
  await expect(page.locator(".detail h2")).toHaveText("Needle report 149");
  // A mistaken input revision restarts the 180 ms search debounce after readback.
  await page.waitForTimeout(250);
  expect(await calls(page, "search")).toBe(0);

  await page.evaluate(() => {
    const w = window as any, s = w.__TEST_SNAPSHOT__();
    w.__TEST_PATCH__({ articles: s.articles.map((a: any) => a.id === "reader-149"
      ? { ...a, title: "Corrected report 149", excerpt: "Corrected content with the same timestamp." } : a) });
    window.dispatchEvent(new Event("data-changed"));
  });
  await expect(page.locator(".detail h2")).toHaveText("Corrected report 149");
  await expect.poll(() => calls(page, "search")).toBe(1);
  await expect(page.getByText("4999 stories", { exact: true })).toBeVisible();
  // A real content change still adopts the host's new search ranking.
  await expect(page.getByTestId("story-row").first()).toHaveAttribute("data-article-id", "reader-4899");
  await expect(page.locator('[data-article-id="pending-reader"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__TEST_SNAPSHOT__().workspace.tabs[0].selectedId)).toBe("reader-149");
  expect(await page.evaluate(() => (window as any).__READER_CACHE_SERIALIZATIONS__)).toBe(0);
});

test("briefing revisions include pending arrivals and ignore unchanged readbacks of those arrivals", async ({ page }) => {
  await fixture(page, { v02: true });
  await page.getByRole("button", { name: "Daily briefing", exact: true }).click();
  await expect(page.getByText("Fixture cached coverage only", { exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).__TEST_CALLS__.length = 0; });

  await page.evaluate(() => {
    const w = window as any, s = w.__TEST_SNAPSHOT__();
    w.__TEST_PATCH__({
      articles: s.articles.map((a: any) => ({ ...a, read: true, saved: true })),
      sources: s.sources.map((source: any) => ({ ...source, status: "Stale", failures: 2 })),
    });
    window.dispatchEvent(new Event("data-changed"));
  });
  await expect.poll(() => calls(page, "snapshot")).toBe(1);
  await painted(page);
  expect(await calls(page, "daily_brief")).toBe(0);

  await page.evaluate(() => {
    const w = window as any, s = w.__TEST_SNAPSHOT__();
    w.__TEST_PATCH__({ articles: [{ ...s.articles[0], id: "pending", title: "Pending briefing story" }, ...s.articles] });
    window.dispatchEvent(new Event("data-changed"));
  });
  await expect(page.getByRole("button", { name: "Open Pending briefing story", exact: true })).toBeVisible();
  expect(await calls(page, "daily_brief")).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event("data-changed")));
  await expect.poll(() => calls(page, "snapshot")).toBe(3);
  await painted(page);
  expect(await calls(page, "daily_brief")).toBe(1);

  await page.evaluate(() => {
    const w = window as any, s = w.__TEST_SNAPSHOT__();
    w.__TEST_PATCH__({ articles: s.articles.map((a: any) => a.id === "pending"
      ? { ...a, excerpt: "Corrected pending publisher excerpt." } : a) });
    window.dispatchEvent(new Event("data-changed"));
  });
  await expect(page.locator(".brief-excerpt").filter({ hasText: "Corrected pending publisher excerpt." })).toBeVisible();
  expect(await calls(page, "daily_brief")).toBe(2);
  await page.getByRole("button", { name: "All headlines", exact: true }).click();
  await expect(page.getByRole("button", { name: "1 new story · Show latest", exact: true })).toBeVisible();
  await expect(page.locator('[data-article-id="pending"]')).toHaveCount(0);
  await expect(page.getByTestId("story-row")).toHaveCount(3);
  expect(await calls(page, "sector_summary_preview")).toBe(0);
  expect(await calls(page, "sector_summarize")).toBe(0);
});

test("an older profile snapshot cannot repopulate the reconciled cache after a profile switch", async ({ page }) => {
  await fixture(page, { savedProfile: true });
  await page.evaluate(() => {
    const w = window as any, s = w.__TEST_SNAPSHOT__();
    w.__TEST_PATCH__({ articles: s.articles.map((a: any) => ({ ...a, title: `Desk B ${a.title}` })) });
    window.dispatchEvent(new Event("data-changed"));
  });
  await expect(page.locator(".headline").first()).toHaveText("Desk B Researchers map a new lunar water reserve");
  await page.evaluate(() => {
    const w = window as any;
    let once = true;
    w.__TEST_AFTER_DISPATCH__ = async (r: any) => {
      if (once && r.op === "snapshot" && r.profileId === "desk-b") {
        once = false;
        await new Promise<void>(resolve => { w.__RELEASE_READER_SNAPSHOT__ = resolve; });
      }
    };
    window.dispatchEvent(new Event("data-changed"));
  });
  await expect.poll(() => page.evaluate(() => typeof (window as any).__RELEASE_READER_SNAPSHOT__)).toBe("function");
  await page.getByLabel("Reading profile", { exact: true }).selectOption("default");
  await page.evaluate(() => (window as any).__RELEASE_READER_SNAPSHOT__());
  await expect(page.getByLabel("Reading profile", { exact: true })).toHaveValue("default");
  await expect(page.locator(".headline").first()).toHaveText("Researchers map a new lunar water reserve");
  await page.getByRole("searchbox").fill("lunar");
  await expect(page.getByTestId("story-row")).toHaveCount(2);
  await expect(page.locator(".headline").filter({ hasText: "Desk B" })).toHaveCount(0);
  await page.locator(".headline").first().click();
  await expect(page.getByRole("button", { name: "Mark unread", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__TEST_SNAPSHOT__("desk-b").articles[0].read)).toBe(false);
});
