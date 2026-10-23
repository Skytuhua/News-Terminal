import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";
test("fixture: export saves through the native file host and JSON import requires explicit replacement consent", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Backup", exact: true }).click();
  await page
    .getByRole("button", { name: "Export backup", exact: true })
    .click();
  await expect(page.getByText('Backup file saved.', {exact:true})).toBeVisible();
  const exportCalls = await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r:any) => ['export', 'backup_export_file'].includes(r.op)));
  expect(exportCalls.map((r:any) => r.op)).toEqual(['backup_export_file']);
  const downloaded = page.waitForEvent("download");
  await page.getByRole('button', {name:'Prepare backup JSON', exact:true}).click();
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

test('fixture: a native backup file is imported by opaque id after explicit confirmation', async ({page}) => {
  await fixture(page);
  await page.evaluate(() => {
    const w = window as any, backup = w.__TEST_SNAPSHOT__();
    backup.profile.name = 'File restored desk';
    w.__TEST_FILE_BACKUP__ = {name:'large-saved-history.json', data:backup};
  });
  await page.getByRole('button', {name:'Settings', exact:true}).click();
  await page.getByRole('button', {name:'Backup', exact:true}).click();
  await page.getByRole('button', {name:'Choose backup file', exact:true}).click();
  await expect(page.getByText('Selected backup: large-saved-history.json', {exact:true})).toBeVisible();
  await expect(page.getByRole('button', {name:'Import backup', exact:true})).toBeDisabled();
  await page.getByLabel('I understand this replaces the current local data').check();
  await page.getByRole('button', {name:'Import backup', exact:true}).click();
  await expect(page.getByText('Backup imported.', {exact:true})).toBeVisible();
  expect(await page.evaluate(() => (window as any).__TEST_SNAPSHOT__().profile.name)).toBe('File restored desk');
  const calls = await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r:any) => ['import','backup_import_file'].includes(r.op)));
  expect(calls).toEqual([{op:'backup_import_file', fileId:expect.any(String), confirmed:true, replacementToken:expect.any(String), apiKey:undefined}]);
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
