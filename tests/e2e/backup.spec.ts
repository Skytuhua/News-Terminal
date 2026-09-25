import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";
test("fixture: export downloads a backup and import requires explicit replacement consent", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Backup", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export backup", exact: true })
    .click();
  expect((await downloaded).suggestedFilename()).toMatch(
    /^news-terminal.*\.json$/,
  );
  await page.getByLabel("Backup JSON").fill("{broken");
  await page
    .getByLabel("I understand this replaces the current local data")
    .check();
  await page
    .getByRole("button", { name: "Import backup", exact: true })
    .click();
  await expect(page.getByText("The backup is not valid JSON.")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__TEST_CALLS__.filter((r: any) => r.op === "import")
            .length,
      ),
    )
    .toBe(0);
});
test("fixture: shortcut help is reachable and keyboard typing never saves a story", async ({
  page,
}) => {
  await fixture(page);
  await page.keyboard.press("?");
  await expect(
    page.getByRole("dialog", { name: "Keyboard shortcuts" }),
  ).toBeVisible();
  await expect(
    page.getByText("Next / previous story", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox")).toBeFocused();
  await page.keyboard.type("save");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__TEST_CALLS__.filter(
            (r: any) => r.op === "article_state",
          ).length,
      ),
    )
    .toBe(0);
});
