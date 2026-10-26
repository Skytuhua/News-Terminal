import { expect, test, type Page } from "@playwright/test";
import { fixture } from "./fixture";

const selectedIds = (page: Page) => page.getByTestId("story-row").evaluateAll(rows =>
  rows.filter(row => row.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked)
    .map(row => row.getAttribute("data-article-id")));

const selectionWrites = (page: Page) => page.evaluate(() =>
  (window as any).__TEST_CALLS__.filter((request: any) =>
    request.op === "article_state" || request.op === "article_state_many" || request.op === "workspace_save"));

test("invert selection toggles the visible complement without reading or persisting stories", async ({ page }) => {
  await fixture(page);
  const bar = page.getByRole("region", { name: "Bulk actions" });
  await expect(page.getByRole("button", { name: "Invert selection", exact: true })).toHaveCount(0);
  const before = await page.evaluate(() => ({
    workspace: (window as any).__TEST_SNAPSHOT__().workspace,
    storage: { ...localStorage },
  }));
  await page.evaluate(() => { (window as any).__TEST_CALLS__.length = 0; });

  await page.getByTestId("story-row").first().getByRole("checkbox").check();
  await expect.poll(() => selectedIds(page)).toEqual(["a"]);
  await bar.getByRole("button", { name: "Invert selection", exact: true }).click();
  await expect(bar).toContainText("2 selected");
  await expect.poll(() => selectedIds(page)).toEqual(["b", "c"]);
  await bar.getByRole("button", { name: "Invert selection", exact: true }).click();
  await expect(bar).toContainText("1 selected");
  await expect.poll(() => selectedIds(page)).toEqual(["a"]);

  expect(await selectionWrites(page)).toEqual([]);
  expect(await page.evaluate(() => ({
    workspace: (window as any).__TEST_SNAPSHOT__().workspace,
    storage: { ...localStorage },
  }))).toEqual(before);
  expect(await page.evaluate(() => (window as any).__TEST_SNAPSHOT__().articles.map((a: any) => a.read)))
    .toEqual([false, false, false]);
});

test("inverting a fully selected page clears the selection and removes bulk actions", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: "Select this page", exact: true }).click();
  const bar = page.getByRole("region", { name: "Bulk actions" });
  await expect(bar).toContainText("3 selected");
  await bar.getByRole("button", { name: "Invert selection", exact: true }).click();
  await expect(bar).toHaveCount(0);
  await expect.poll(() => selectedIds(page)).toEqual([]);
});

test("inversion stays within each page and changing pages clears the selection", async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    const w = window as any, snapshot = w.__TEST_SNAPSHOT__();
    w.__TEST_PATCH__({ articles: Array.from({ length: 105 }, (_, index) => ({
      ...snapshot.articles[0], id: `page-${index}`, title: `Page report ${index}`,
    })) });
    window.dispatchEvent(new Event("data-changed"));
  });
  await page.getByRole("button", { name: "105 new stories · Show latest", exact: true }).click();
  await page.evaluate(() => { (window as any).__TEST_CALLS__.length = 0; });
  const bar = page.getByRole("region", { name: "Bulk actions" });
  await page.getByRole("checkbox", { name: "Select Page report 0", exact: true }).check();
  await bar.getByRole("button", { name: "Invert selection", exact: true }).click();
  await expect(bar).toContainText("99 selected");
  await expect.poll(() => selectedIds(page)).toEqual(Array.from({ length: 99 }, (_, index) => `page-${index + 1}`));
  expect(await selectionWrites(page)).toEqual([]);

  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(bar).toHaveCount(0);
  await expect.poll(() => selectedIds(page)).toEqual([]);
  await page.getByRole("checkbox", { name: "Select Page report 100", exact: true }).check();
  await bar.getByRole("button", { name: "Invert selection", exact: true }).click();
  await expect(bar).toContainText("4 selected");
  await expect.poll(() => selectedIds(page)).toEqual(["page-101", "page-102", "page-103", "page-104"]);
  expect(await selectionWrites(page)).toEqual([]);

  await bar.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_SNAPSHOT__().articles
    .filter((a: any) => a.saved).map((a: any) => a.id)))
    .toEqual(["page-101", "page-102", "page-103", "page-104"]);
  const writes = await selectionWrites(page);
  expect(writes).toHaveLength(1);
  expect(writes[0].op).toBe("article_state_many");
  expect(writes[0].items).toEqual([
    { articleId: "page-101", saved: true },
    { articleId: "page-102", saved: true },
    { articleId: "page-103", saved: true },
    { articleId: "page-104", saved: true },
  ]);
});
