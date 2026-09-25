import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";
test("fixture: preferences persist and profiles isolate saves", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page.getByLabel("Include keywords").fill("moon, research");
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(page.getByText("Preferences saved.")).toBeVisible();
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.getByRole("button", { name: "Manage profiles" }).click();
  await page.getByLabel("New profile name").fill("Technology desk");
  await page
    .getByRole("button", { name: "Create profile", exact: true })
    .click();
  await expect(
    page.getByText("Technology desk", { exact: true }).first(),
  ).toBeAttached();
  await page.getByRole("button", { name: "Close settings" }).click();
  await page
    .getByLabel("Reading profile")
    .selectOption({ label: "Technology desk" });
  await expect(page.getByLabel("Reading profile")).toHaveValue(/.+/);
  await page
    .getByRole("button", { name: "Saved stories", exact: true })
    .click();
  await expect(page.getByText("No saved stories yet")).toBeVisible();
});
