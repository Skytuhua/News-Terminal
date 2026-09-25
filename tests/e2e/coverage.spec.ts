import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";
test("fixture: compare related excerpts and split a false match", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", {
      name: "Researchers map a new lunar water reserve",
      exact: true,
    })
    .click();
  await expect(page.getByText("Likely related coverage")).toBeVisible();
  await page.getByRole("button", { name: "Compare coverage" }).click();
  await expect(
    page.getByRole("dialog", { name: "Compare coverage" }),
  ).toBeVisible();
  await expect(
    page.getByText("An independent look at the new observations.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Separate What lunar water observations can tell us",
    })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("What lunar water observations can tell us", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close comparison" }).click();
  await expect(page.getByText("First seen in this workspace")).toBeVisible();
});
