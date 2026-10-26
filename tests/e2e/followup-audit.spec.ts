import { expect, test, type Page } from "@playwright/test";
import { fixture } from "./fixture";

const calls = (page: Page, op: string) => page.evaluate(
  op => (window as any).__TEST_CALLS__.filter((request: any) => request.op === op).length, op,
);
const painted = (page: Page) => page.evaluate(() => new Promise<void>(resolve =>
  requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
));

test("Focus section navigation starts at the first page of its destination", async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    const w = window as any, snapshot = w.__TEST_SNAPSHOT__();
    w.__TEST_PATCH__({ articles: Array.from({ length: 420 }, (_, index) => ({
      ...snapshot.articles[0], id: `focus-${index}`,
      title: `${index < 210 ? "AI" : "Technology"} report ${index % 210}`,
      sections: [index < 210 ? "ai" : "technology"],
    })) });
    window.dispatchEvent(new Event("data-changed"));
  });
  await page.getByRole("button", { name: "420 new stories · Show latest", exact: true }).click();
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await expect(page.locator(".list-heading h2")).toHaveText("AI");
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByTestId("story-row").first()).toHaveAttribute("data-article-id", "focus-100");

  await page.getByRole("button", { name: "Technology", exact: true }).click();
  await expect(page.locator(".list-heading h2")).toHaveText("Technology");
  await expect(page.getByTestId("story-row").first()).toHaveAttribute("data-article-id", "focus-210");
  await expect(page.getByRole("navigation", { name: "Headline pages" })).toContainText("1–100 of 210");

  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByTestId("story-row").first()).toHaveAttribute("data-article-id", "focus-310");
  await page.getByRole("button", { name: "All headlines", exact: true }).click();
  await expect(page.getByTestId("story-row").first()).toHaveAttribute("data-article-id", "focus-0");
  await expect(page.getByRole("navigation", { name: "Headline pages" })).toContainText("1–100 of 420");
});

test("a remote group split refreshes the mounted briefing while read/save changes preserve it", async ({ page }) => {
  await fixture(page, { v02: true });
  await page.evaluate(() => {
    const w = window as any, snapshot = w.__TEST_SNAPSHOT__();
    w.__TEST_PATCH__({ providers: snapshot.providers.map((provider: any) => ({ ...provider, enabled: true, consented: true })) });
    window.dispatchEvent(new Event("data-changed"));
  });
  await page.getByRole("button", { name: "Daily briefing", exact: true }).click();
  await expect(page.getByText("Fixture cached coverage only", { exact: true })).toBeVisible();
  await page.getByText("Optional AI summaries · per story", { exact: true }).click();
  await page.getByRole("button", { name: "Summarize excerpt", exact: true }).first().click();
  const generated = page.getByText("Fixture summary of the lunar observations.", { exact: true });
  await expect(generated).toBeVisible();
  const briefCalls = await calls(page, "daily_brief");
  const snapshotCalls = await calls(page, "snapshot");

  await page.evaluate(async () => {
    const w = window as any;
    const snapshot = await w.__NEWS_TEST_DISPATCH__({ op: "snapshot", profileId: "default" });
    await w.__NEWS_TEST_DISPATCH__({ op: "article_state", profileId: "default", articleId: "a", read: true, saved: true, replacementToken: snapshot.replacementToken });
    window.dispatchEvent(new Event("data-changed"));
  });
  await expect.poll(() => calls(page, "snapshot")).toBe(snapshotCalls + 2);
  await painted(page);
  expect(await calls(page, "daily_brief")).toBe(briefCalls);
  await expect(generated).toBeVisible();

  await page.evaluate(async () => {
    const w = window as any;
    w.__TEST_BEFORE_DISPATCH__ = async (request: any) => {
      if (request.op === "daily_brief") await new Promise<void>(resolve => { w.__RELEASE_SPLIT_BRIEF__ = resolve; });
    };
    const snapshot = await w.__NEWS_TEST_DISPATCH__({ op: "snapshot", profileId: "default" });
    // The native split changes only the profile's groupId overlay. The shared
    // fixture also changes only this field for its group_split operation.
    await w.__NEWS_TEST_DISPATCH__({ op: "group_split", profileId: "default", articleId: "b", replacementToken: snapshot.replacementToken });
    window.dispatchEvent(new Event("data-changed"));
  });
  await expect(page.getByText("Reading the local day’s coverage…", { exact: true })).toBeVisible();
  await expect(generated).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => typeof (window as any).__RELEASE_SPLIT_BRIEF__)).toBe("function");
  await page.evaluate(() => (window as any).__RELEASE_SPLIT_BRIEF__());
  await expect(page.getByText("Fixture cached coverage only", { exact: true })).toBeVisible();
  expect(await calls(page, "daily_brief")).toBe(briefCalls + 1);
});
