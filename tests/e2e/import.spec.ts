import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";
test("fixture: a validated imported backup is read back into the workspace", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Backup", exact: true }).click();
  await page
    .getByRole("button", { name: "Export backup", exact: true })
    .click();
  await expect(page.getByLabel("Backup JSON")).not.toHaveValue("");
  const backup = JSON.parse(await page.getByLabel("Backup JSON").inputValue());
  backup.profile.name = "Restored desk";
  backup.profiles[0].name = "Restored desk";
  await page.getByLabel("Backup JSON").fill(JSON.stringify(backup));
  await page
    .getByLabel("I understand this replaces the current local data")
    .check();
  await page
    .getByRole("button", { name: "Import backup", exact: true })
    .click();
  await expect(page.getByText("Backup imported.")).toBeVisible();
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(
    page.getByLabel("Reading profile").locator("option:checked"),
  ).toHaveText("Restored desk");
});
