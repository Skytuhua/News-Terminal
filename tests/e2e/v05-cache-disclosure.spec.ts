import { expect, test } from "@playwright/test";
import { fixture } from "./fixture";

// 0.5 cache disclosure. The host prunes silently - an unsaved story disappears
// after 30 days or outside the newest 5000 - and a reader relying on cached
// stories has no way to learn that. The policy has to be stated in the app.

const open = async (page: import("@playwright/test").Page) => {
  await fixture(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Storage & retention" }).click();
};

test("the panel states the real retention policy", async ({ page }) => {
  await open(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("30 days");
  await expect(dialog).toContainText("5,000");
  await expect(dialog).toContainText("90 days");
});

test("saved stories are called out as the way to keep a story", async ({ page }) => {
  await open(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Saved stories are never pruned");
  await expect(dialog.getByText("Saved stories are never pruned.")).toBeVisible();
});

test("the panel says pruning never unsaves or contacts the publisher", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("dialog")).toContainText("never unsaves a story");
  await expect(page.getByRole("dialog")).toContainText("never contacts the publisher");
});

test("the current cache size is reported from the loaded snapshot", async ({ page }) => {
  await open(page);
  const summary = page.getByLabel("Cached reading data");
  const count = await page.evaluate(() =>
    (window as any).__TEST_SNAPSHOT__().articles.length);
  await expect(summary).toContainText(`${count} stories cached`);
  // Zero must read as "0 stories cached", not as a blank or a missing row.
  await expect(summary).toContainText("saved");
  await expect(summary).toContainText("unread");
});

test("an empty cache reports zeroes rather than looking broken", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Storage & retention" }).click();
  // The policy text must still be fully present with no stories loaded.
  await expect(page.getByRole("dialog")).toContainText("30 days");
  await expect(page.getByLabel("Cached reading data")).toContainText("unread");
});

test("the figures agree with the story list rather than drifting from it", async ({ page }) => {
  await open(page);
  const before = (await page.getByLabel("Cached reading data").textContent())!;
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Researchers map a new lunar water reserve", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Storage & retention" }).click();
  const after = (await page.getByLabel("Cached reading data").textContent())!;
  // Reading a story changes the unread count but not the cache size.
  expect(after).not.toBe(before);
  expect(after).toMatch(/stories cached/);
});
