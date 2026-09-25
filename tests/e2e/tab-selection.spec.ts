import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";
test("fixture: detaching active tab restores the remaining tab selection", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", {
      name: "Researchers map a new lunar water reserve",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page
    .getByRole("button", {
      name: "New chips improve battery efficiency",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "New chips improve battery efficiency" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Detach tab" }).click();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(
    page.getByRole("heading", {
      name: "Researchers map a new lunar water reserve",
    }),
  ).toBeVisible();
});
