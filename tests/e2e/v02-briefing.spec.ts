import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";

test("fixture: daily sector briefing uses dated native cache and honest empty coverage", async ({ page }) => {
  await fixture(page, { v02: true });
  await page.getByRole("button", { name: "Daily briefing", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Daily briefing", exact: true })).toBeVisible();
  await expect(page.getByText("Fixture cached coverage only")).toBeVisible();
  await expect(page.getByText("Headline outline · not AI-generated", { exact: true })).toBeVisible();
  await expect(page.getByText("No cached stories in this sector for this day.")).toBeVisible();
  await page.getByLabel("Briefing date").fill("2026-09-22");
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_CALLS__.filter((c: any) => c.op === "daily_brief").at(-1)?.date)).toBe("2026-09-22");
  await page.getByRole("button", { name: "Open Researchers map a new lunar water reserve" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_CALLS__.filter((c: any) => c.op === "open_original").at(-1)?.url)).toBe("https://example.org/moon");
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((c: any) => c.op === "summarize").length)).toBe(0);
});
