import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";
test("fixture: visit mutation events never advance the watermark twice", async ({
  page,
}) => {
  await fixture(page, { visitEvents: true });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__TEST_CALLS__.filter((r: any) => r.op === "visit")
            .length,
      ),
    )
    .toBe(1);
});
test("fixture: resetting preferences updates the visible form and preserves saves", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", {
      name: "Researchers map a new lunar water reserve",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Save story", exact: true }).click();
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page.getByLabel("Include keywords").fill("moon");
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(page.getByText("Preferences saved.")).toBeVisible();
  await page
    .getByRole("button", { name: "Reset preferences", exact: true })
    .click();
  await expect(page.getByLabel("Include keywords")).toHaveValue("");
  await page.getByRole("button", { name: "Close settings" }).click();
  await page
    .getByRole("button", { name: "Saved stories", exact: true })
    .click();
  await expect(page.getByTestId("story-row")).toHaveCount(1);
});
