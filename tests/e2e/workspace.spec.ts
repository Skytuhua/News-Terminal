import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";
test("fixture: tabs reorder, detach, reattach and restore without duplicating", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.getByRole("button", { name: "Others", exact: true }).click();
  await page.getByRole("button", { name: "Science", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Science", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Move tab left" }).click();
  await expect(page.getByRole("tab").first()).toHaveText("Science");
  await page.getByRole("button", { name: "Detach tab" }).click();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.getByText("Science · Another screen")).toBeVisible();
  await page.getByRole("button", { name: "Reattach", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole("tab").first()).toHaveText("Science");
  await page.getByRole("button", { name: "Close Science tab" }).click();
  await expect(page.getByRole("tab")).toHaveCount(1);
});
test("fixture: refresh preserves selected story and defers new rows until requested", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", {
      name: "Researchers map a new lunar water reserve",
      exact: true,
    })
    .click();
  await page.evaluate(() => {
    (window as any).__TEST_ADD_STORY__ = true;
  });
  await page.getByRole("button", { name: "Refresh feeds" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Researchers map a new lunar water reserve",
    }),
  ).toBeVisible();
  await expect(page.getByTestId("story-row")).toHaveCount(3);
  await page.getByRole("button", { name: "1 new story · Show latest" }).click();
  await expect(page.getByTestId("story-row")).toHaveCount(4);
});
