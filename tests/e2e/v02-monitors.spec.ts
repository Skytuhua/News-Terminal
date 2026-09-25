import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";

test("fixture: screen arrangement targets current native window with readback", async ({ page }) => {
  await fixture(page, { v02: true });
  await page.getByRole("button", { name: "Screens", exact: true }).click();
  await expect(page.getByText("1920 × 1080 · 100% scale · Position 0, 0")).toBeVisible();
  await page.getByLabel("Target monitor").selectOption("screen-2");
  await page.getByLabel("Window arrangement").selectOption("right");
  await page.getByRole("button", { name: "Move this window" }).click();
  await expect(page.getByText("Current display: Left display")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((c: any) => c.op === "window_move").at(-1))).toMatchObject({ monitorId: "screen-2", layout: "right" });
  await expect(page.getByText(/Detach a tab first/)).toBeVisible();
});
