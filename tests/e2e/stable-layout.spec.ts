import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";
test("fixture: new-item notice does not move existing rows during refresh", async ({
  page,
}) => {
  await fixture(page);
  const row = page.getByTestId("story-row").first();
  const before = await row.boundingBox();
  await page.evaluate(() => ((window as any).__TEST_ADD_STORY__ = true));
  await page.getByRole("button", { name: "Refresh feeds" }).click();
  await expect(
    page.getByRole("button", { name: "1 new story · Show latest" }),
  ).toBeVisible();
  const after = await row.boundingBox();
  expect(after?.y).toBe(before?.y);
});
