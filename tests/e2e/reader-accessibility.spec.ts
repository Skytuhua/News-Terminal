import { expect, test, type Locator } from "@playwright/test";
import { fixture } from "./fixture";

const title = "Researchers map a new lunar water reserve";
const background = (locator: Locator) =>
  locator.evaluate((element) => getComputedStyle(element).backgroundColor);

test("bulk selection stays visibly distinct after the pointer leaves", async ({ page }, testInfo) => {
  await fixture(page);
  const row = page.locator(".story-row").filter({ has: page.getByRole("button", { name: title, exact: true }) });
  await page.mouse.move(1, 1);
  const normal = await background(row);
  await page.getByRole("checkbox", { name: `Select ${title}`, exact: true }).check();
  await page.mouse.move(1, 1);
  await expect(page.getByRole("region", { name: "Bulk actions" })).toContainText("1 selected");
  await expect.poll(() => background(row)).not.toBe(normal);
  await page.screenshot({ path: testInfo.outputPath("bulk-selected.png") });
  await page.getByRole("region", { name: "Bulk actions" }).getByRole("button", { name: "Clear", exact: true }).click();
  await page.mouse.move(1, 1);
  await expect.poll(() => background(row)).toBe(normal);
});

test("contrast themes retain row and workspace selection away from keyboard focus", async ({ page }, testInfo) => {
  await page.emulateMedia({ forcedColors: "active" });
  await fixture(page);
  await page.getByRole("button", { name: title, exact: true }).click();
  await page.getByRole("checkbox", { name: "Select New chips improve battery efficiency", exact: true }).check();
  await page.getByRole("button", { name: "Settings", exact: true }).focus();
  for (const selected of [".story-row.selected", ".story-row.triaged", ".tab.active", "nav button.chosen"]) {
    const visibleOutline = await page.locator(selected).first().evaluate((element) => {
      const style = getComputedStyle(element);
      return style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2;
    });
    expect(visibleOutline, `${selected} needs a persistent selection outline in contrast themes`).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath("contrast-selections.png") });
});

test("a 320px reading window keeps actions inside its toolbar", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await fixture(page);
  await page.getByRole("button", { name: title, exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("compact-reader.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const toolbar = page.locator(".detail-toolbar");
  const bounds = await toolbar.boundingBox();
  expect(bounds).not.toBeNull();
  for (const action of ["Back to headlines", "Save story", "Hide story", "Close story"]) {
    const button = page.getByRole("button", { name: action, exact: true });
    await expect(button).toBeVisible();
    const rect = await button.boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.x, action).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width, action).toBeLessThanOrEqual(320);
    expect(rect!.y + rect!.height, `${action} must fit inside its toolbar`).toBeLessThanOrEqual(bounds!.y + bounds!.height);
  }
  await page.getByRole("button", { name: "Save story", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unsave story", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to headlines", exact: true }).click();
  await expect(page.getByRole("button", { name: title, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: testInfo.outputPath("compact-settings.png") });
});
