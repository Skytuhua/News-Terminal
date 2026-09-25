import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";
test("fixture: failed hide keeps the current story readable and reports an inline error", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", {
      name: "Researchers map a new lunar water reserve",
      exact: true,
    })
    .click();
  await page.evaluate(() => ((window as any).__FAIL_OP__ = "article_state"));
  await page.getByRole("button", { name: "Hide story", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Fixture service unavailable",
  );
  await expect(
    page.getByRole("heading", {
      name: "Researchers map a new lunar water reserve",
    }),
  ).toBeVisible();
});
