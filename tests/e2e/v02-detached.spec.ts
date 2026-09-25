import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";

for (const view of ["Daily briefing", "Live discussion"]) test(`fixture: ${view} retains detached tab ownership`, async ({ page }) => {
  await fixture(page, { v02: true });
  await page.getByRole("button", { name: view, exact: true }).click();
  await expect(page.getByRole("heading", { name: view, exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).__TEST_CONTEXT__ = { label: "detached-fixture", detached: true, profileId: "default", tabId: "home" }; window.dispatchEvent(new Event("data-changed")); });
  await expect(page.getByLabel("Reading profile", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reattach", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: view, exact: true })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "New tab", exact: true })).toHaveCount(0);
});
