import { expect, test, type Page } from "@playwright/test";
import { fixture } from "./fixture";

// 0.5 keyboard triage. X hides, M toggles read, Escape closes the reading pane.
// All three must be inert while typing, with a dialog open, and during a
// workspace swap - a shortcut that fires when it should not is worse than one
// that is missing.

const LUNAR = "Researchers map a new lunar water reserve";

const openFirst = async (page: Page) => {
  await fixture(page);
  await page.getByRole("button", { name: LUNAR, exact: true }).click();
  await page.locator(".list-heading h2").click();
};

// Writes are asynchronous, so state assertions poll rather than sampling once.
const first = (page: Page) =>
  page.evaluate(() => {
    const a = (window as any).__TEST_SNAPSHOT__().articles[0];
    return { read: !!a.read, hidden: !!a.hidden };
  });

test("X hides the selected story and it stays recoverable", async ({ page }) => {
  await openFirst(page);
  const rowsBefore = await page.locator("[data-article-id]").count();
  await page.keyboard.press("x");
  await expect.poll(async () => (await first(page)).hidden).toBe(true);
  // The hidden story leaves the headline list; the others remain.
  await expect(page.locator("[data-article-id]")).toHaveCount(rowsBefore - 1);
  // Hidden, not deleted: it is still reachable from Hidden stories.
  await page.getByRole("button", { name: "Hidden stories", exact: true }).click();
  await expect(page.getByText(LUNAR, { exact: true }).first()).toBeVisible();
});

test("M toggles read on the selected story and is reversible", async ({ page }) => {
  await openFirst(page);
  // Selecting a story already marks it read, so M must mark it unread first.
  await expect.poll(async () => (await first(page)).read).toBe(true);
  await page.keyboard.press("m");
  await expect.poll(async () => (await first(page)).read).toBe(false);
  // Wait for the reload to settle before toggling again. M reads the current
  // read flag, so a second press issued before the first lands would toggle
  // from a stale value and silently do the same thing twice.
  await page.waitForTimeout(200);
  await page.keyboard.press("m");
  await expect.poll(async () => (await first(page)).read).toBe(true);
});

test("Escape closes the reading pane rather than leaving a stale story", async ({ page }) => {
  await openFirst(page);
  await expect(page.locator(".detail h2")).toHaveText(LUNAR);
  await page.keyboard.press("Escape");
  // The empty reading pane has its own heading, so assert on the story title
  // being gone from the reader rather than on the absence of any h2. The story
  // itself stays in the headline list - closing the pane is not a filter.
  await expect(page.locator(".detail h2")).toHaveText("Select a story");
  await expect(page.getByText(LUNAR, { exact: true })).toHaveCount(1);
  // Closing the pane must not change the story's read state.
  await expect.poll(async () => (await first(page)).read).toBe(true);
});

test("shortcuts are inert while typing in a field", async ({ page }) => {
  await openFirst(page);
  const search = page.getByRole("searchbox").first();
  await search.click();
  await search.type("m");
  expect(await search.inputValue()).toBe("m");
  // Typing "m" must not have marked the story unread or hidden it.
  await expect.poll(async () => (await first(page)).read).toBe(true);
  await expect.poll(async () => (await first(page)).hidden).toBe(false);
});

test("shortcuts are inert while a dialog is open, and Escape still closes the dialog", async ({ page }) => {
  await openFirst(page);
  await page.getByRole("button", { name: "Keyboard shortcuts", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("x");
  await page.waitForTimeout(300);
  await expect.poll(async () => (await first(page)).hidden).toBe(false);
  // Escape must close the dialog, not act on the story behind it.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(async () => (await first(page)).hidden).toBe(false);
});

test("X with no selected story does nothing", async ({ page }) => {
  await fixture(page);
  await page.locator(".list-heading h2").click();
  await page.keyboard.press("x");
  await page.waitForTimeout(300);
  expect(
    await page.evaluate(() =>
      (window as any).__TEST_SNAPSHOT__().articles.filter((a: any) => a.hidden).length,
    ),
  ).toBe(0);
});

test("the in-app shortcut list documents the new keys", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: "Keyboard shortcuts", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Hide selected story");
  await expect(dialog).toContainText("Mark read / unread selected story");
  await expect(dialog).toContainText("reading pane");
});
