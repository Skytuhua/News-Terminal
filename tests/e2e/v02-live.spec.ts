import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";

test("fixture: stream action errors remain visible after successful status polling", async ({ page }) => {
  await fixture(page, { v02: true });
  await page.getByRole("button", { name: "Live discussion", exact: true }).click();
  await expect(page.getByText("Stream off", { exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).__FAIL_OP__ = "live_set"; });
  await page.getByRole("button", { name: "Connect HN stream" }).click();
  await page.waitForTimeout(1200);
  await expect(page.getByRole("alert")).toContainText("Fixture service unavailable");
  await expect(page.getByText("Stream off", { exact: true })).toBeVisible();
});

test("fixture: live discussion is opt-in and local status polling stops on navigation", async ({ page }) => {
  await fixture(page, { v02: true });
  await page.getByRole("button", { name: "Live discussion", exact: true }).click();
  await expect(page.getByText("Stream off", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Connect HN stream", exact: true }).click();
  await expect(page.getByText("Stream connected", { exact: true })).toBeVisible();
  await expect(page.getByText("Fixture discussion about open science", { exact: true })).toBeVisible();
  await expect(page.getByText(/Initial snapshot is not newly published news/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_CALLS__.filter((c: any) => c.op === "live_status").length)).toBeGreaterThan(2);
  await page.getByRole("button", { name: "Open HN discussion" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_CALLS__.filter((c: any) => c.op === "open_original").at(-1)?.url)).toBe("https://news.ycombinator.com/item?id=1");
  await page.getByRole("button", { name: "All headlines", exact: true }).click();
  await expect(page.getByLabel("Search cached stories")).toBeVisible();
  const count = await page.evaluate(() => (window as any).__TEST_CALLS__.filter((c: any) => c.op === "live_status").length);
  await page.waitForTimeout(1300);
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((c: any) => c.op === "live_status").length)).toBe(count);
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((c: any) => c.op === "refresh").length)).toBe(0);
});
