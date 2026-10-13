import { expect, test } from "@playwright/test";
import { fixture } from "./fixture";

test("Your brief Read-empty describes the reading filter and clears it without leaving the brief", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: "Your brief", exact: true }).click();
  await expect(page.getByTestId("story-row")).toHaveCount(3);

  const status = page.getByLabel("Reading status", { exact: true });
  await status.selectOption("read");
  await expect(page.getByTestId("story-row")).toHaveCount(0);
  await expect(page.getByText("There are no read stories in this view.", { exact: true })).toBeVisible();
  await expect(page.getByText("No new cached stories since your previous visit.", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();

  await expect(status).toHaveValue("all");
  await expect(page.locator(".list-heading h2")).toHaveText("Your brief");
  await expect(page.getByTestId("story-row")).toHaveCount(3);
  const writes = await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) =>
    ["article_state", "article_state_many"].includes(r.op)));
  expect(writes).toEqual([]);
});
