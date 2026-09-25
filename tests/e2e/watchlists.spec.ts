import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";
test("fixture: watchlist rule narrows stories and overnight quiet hours persist", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("button", { name: "Manage watchlists" }).click();
  await page.getByLabel("Watchlist name").fill("Lunar desk");
  await page.getByLabel("Matching keywords").fill("lunar");
  await page.getByRole("button", { name: "Save watchlist" }).click();
  await expect(page.getByText("Watchlist saved.")).toBeVisible();
  await page.getByRole("button", { name: "Alerts", exact: true }).click();
  await page.getByLabel("Enable desktop alerts").check();
  await page.getByLabel("Enable quiet hours").check();
  await page.getByLabel("Quiet hours start").fill("23:00");
  await page.getByLabel("Quiet hours end").fill("06:30");
  await page.getByRole("button", { name: "Save alert settings" }).click();
  await expect(page.getByText("Alert settings saved.")).toBeVisible();
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.getByRole("button", { name: "Lunar desk", exact: true }).click();
  await expect(page.getByTestId("story-row")).toHaveCount(2);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__TEST_CALLS__.some(
          (r: any) =>
            r.op === "profile_update" &&
            r.quietHours?.start === "23:00" &&
            r.quietHours?.end === "06:30",
        ),
      ),
    )
    .toBe(true);
});
