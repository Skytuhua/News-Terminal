import { expect, test, type Page } from "@playwright/test";
import { fixture } from "./fixture";

// 0.5 source search and filter. Thirty sources with no way to find one is a
// real daily-use cost. The matching itself is unit-tested in
// tests/v05-source-filter.test.ts; this covers the panel wiring.

const mk = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: "Science Wire",
  url: "https://example.org/feed",
  homepage: "https://example.org",
  kind: "reporting",
  topics: ["science"],
  region: "world",
  language: "en",
  enabled: true,
  status: "Healthy",
  lastSuccess: 200,
  termsUrl: "https://example.org/terms",
  storage: "excerpt",
  failures: 0,
  ...over,
});

// A small realistic directory: one disabled, one failing, one from Germany.
const SOURCES = [
  mk("a", { name: "Ars Technica", kind: "technology", region: "US" }),
  mk("b", { name: "Nature", kind: "science", region: "UK", failures: 3 }),
  mk("c", { name: "Local Paper", kind: "local", region: "US", enabled: false }),
  mk("d", { name: "Der Spiegel", kind: "news", region: "Germany", language: "German" }),
];

const openSources = async (page: Page) => {
  await fixture(page, { sources: SOURCES });
  await page.getByRole("button", { name: /Sources & health/ }).click();
};

const rows = (page: Page) => page.locator(".source-row");
test("all sources are shown with no search or filter", async ({ page }) => {
  await openSources(page);
  expect(await rows(page).count()).toBe(4);
  await expect(page.getByText("sources shown", { exact: false })).toContainText("4 of 4");
});

test("search narrows the list and states how many remain", async ({ page }) => {
  await openSources(page);
  const total = await rows(page).count();
  await page.getByRole("searchbox", { name: "Search sources" }).fill("ars");
  const shown = await rows(page).count();
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThan(total);
  await expect(page.getByText("sources shown", { exact: false })).toContainText(`${shown} of ${total}`);
});

test("search matches on region, not only on name", async ({ page }) => {
  await openSources(page);
  await page.getByRole("searchbox", { name: "Search sources" }).fill("Germany");
  expect(await rows(page).count()).toBeGreaterThan(0);
  await expect(rows(page).first()).toContainText("Germany");
});

test("a search matching nothing explains itself instead of looking broken", async ({ page }) => {
  await openSources(page);
  await page.getByRole("searchbox", { name: "Search sources" }).fill("zzzznotasource");
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByText("No sources match the current search and filter", { exact: false })).toBeVisible();
});

test("the filter chips state their counts in text, not colour alone", async ({ page }) => {
  await openSources(page);
  const group = page.getByRole("group", { name: "Filter sources by state" });
  await expect(group.getByRole("button", { name: /^All \d+$/ })).toBeVisible();
  await expect(group.getByRole("button", { name: /^Enabled \d+$/ })).toBeVisible();
  await expect(group.getByRole("button", { name: /^Disabled \d+$/ })).toBeVisible();
  await expect(group.getByRole("button", { name: /^Failing \d+$/ })).toBeVisible();
});

test("the disabled filter shows only disabled sources", async ({ page }) => {
  await openSources(page);
  await page.getByRole("button", { name: /^Disabled \d+$/ }).click();
  const count = await rows(page).count();
  expect(count).toBeGreaterThan(0);
  const checked = await page.locator('.source-row input[type="checkbox"]:checked').count();
  expect(checked).toBe(0);
});

test("a filter chip is announced as pressed, so the choice is not visual only", async ({ page }) => {
  await openSources(page);
  const chip = page.getByRole("button", { name: /^Failing \d+$/ });
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
});

test("search and filter combine", async ({ page }) => {
  await openSources(page);
  const total = await rows(page).count();
  await page.getByRole("button", { name: /^Enabled \d+$/ }).click();
  const enabled = await rows(page).count();
  await page.getByRole("searchbox", { name: "Search sources" }).fill("germany");
  const both = await rows(page).count();
  expect(both).toBeLessThanOrEqual(enabled);
  expect(enabled).toBeLessThanOrEqual(total);
});

test("toggling a source still works after filtering", async ({ page }) => {
  await openSources(page);
  await page.getByRole("button", { name: /^Disabled \d+$/ }).click();
  const target = rows(page).filter({ hasText: "Local Paper" });
  await expect(target).toHaveCount(1);
  // click rather than check: check() re-verifies the checked state, which
  // cannot settle here because the row leaves the filter as a result.
  await target.getByRole("checkbox", { name: /^Enable / }).click({ timeout: 20000 });

  const call = await page.evaluate(() =>
    (window as any).__TEST_CALLS__.filter((r: any) => r.op === "source_update").pop());
  expect(call).toBeTruthy();
  expect(call.sourceId).toBe("c");
  // It was the only disabled source, so enabling it legitimately empties the
  // Disabled filter. The list must say so rather than going blank.
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByText("No sources match", { exact: false })).toBeVisible();
  // Switching back proves the other three are still there and not destroyed.
  await page.getByRole("button", { name: /^All \d+$/ }).click();
  await expect(rows(page)).toHaveCount(4);
  await expect(rows(page).filter({ hasText: "Local Paper" })).toHaveCount(1);
});

test("source checkboxes meet a usable target size", async ({ page }) => {
  await openSources(page);
  // The 13x13 box is the drawn control. The target is the wrapping label,
  // which is what a pointer actually hits, so that is what must be measured.
  const label = rows(page).first().locator("label.check:not(.media-permission)");
  const box = await label.boundingBox();
  expect(box).toBeTruthy();
  expect(box!.width).toBeGreaterThanOrEqual(24);
  expect(box!.height).toBeGreaterThanOrEqual(24);
  // And the control must still be reachable through that label.
  await expect(label.getByRole("checkbox", { name: /^Enable / })).toBeChecked();
});
