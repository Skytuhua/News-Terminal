import { expect, test } from "@playwright/test";
import { fixture } from "./fixture";

test("focus navigation persists AI, Technology, Stocks, Others and all-headlines state", async ({ page }) => {
  await fixture(page, { v02: true });
  const nav = page.getByRole("navigation").filter({ hasText: "Focus" });
  const clickNav = async (name: string) => {
    await nav.getByRole("button", { name, exact: true }).first().click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  };

  await clickNav("AI");
  await expect(nav.getByRole("button", { name: "Technology", exact: true })).toHaveCount(1);
  await expect(nav.getByRole("button", { name: "Politics", exact: true })).toBeHidden();
  await expect(nav.getByRole("button", { name: "Others", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "News", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) => ["model_catalog", "benchmark_catalog"].includes(r.op)))).toHaveLength(0);
  await page.getByRole("button", { name: "Models", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI models" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_SNAPSHOT__().workspace.tabs[0].section)).toBe("ai");

  await clickNav("Technology");
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_SNAPSHOT__().workspace.tabs[0].section)).toBe("technology");

  await clickNav("Stocks");
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_SNAPSHOT__().workspace.tabs[0].section)).toBe("stocks");

  await clickNav("Others");
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_SNAPSHOT__().workspace.tabs[0].section)).toBe("others");

  await clickNav("All headlines");
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_SNAPSHOT__().workspace.tabs[0].section ?? null)).toBe(null);
});
