import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";
test("fixture: custom feed requires permission and exposes health", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", { name: "Sources & health", exact: false })
    .click();
  await expect(page.getByText("Healthy", { exact: true })).toBeVisible();
  await page.getByLabel("Enable Science Wire").uncheck();
  await expect(page.getByLabel("Enable Science Wire")).not.toBeChecked();
  await page.getByLabel("Feed name").fill("Local council");
  await page.getByLabel("Feed URL").fill("https://example.org/council.xml");
  await page
    .getByLabel("Publisher terms URL")
    .fill("https://example.org/terms");
  await page
    .getByLabel("I have permission to access and store this feed as selected")
    .check();
  await page.getByRole("button", { name: "Add feed", exact: true }).click();
  await expect(page.getByText("Local council", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__TEST_CALLS__.some(
          (r: any) =>
            r.op === "source_add" &&
            r.storage === "metadata" &&
            r.aiAllowed === false,
        ),
      ),
    )
    .toBe(true);
});
