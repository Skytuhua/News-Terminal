import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";

test("fixture: local AI action reads back installed model without changing source rights", async ({ page }) => {
  await fixture(page, { v02: true });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "AI providers", exact: true }).click();
  const before = await page.evaluate(() => (window as any).__TEST_SNAPSHOT__().sources);
  await page.getByRole("button", { name: "Use local AI", exact: true }).click();
  await expect(page.getByLabel("Ollama model", { exact: true })).toHaveValue("qwen3:4b-instruct-2507-q4_K_M");
  await expect(page.getByLabel("Enable Ollama", { exact: true })).toBeChecked();
  await expect(page.getByLabel("I consent to sending excerpts to Ollama")).toBeChecked();
  expect(await page.evaluate(() => (window as any).__TEST_SNAPSHOT__().sources)).toEqual(before);
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((c: any) => c.op === "summarize").length)).toBe(0);
});
