import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";
test("fixture: stale workspace revision reapplies only the intent", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => { (window as any).__TEST_CONFLICT_ONCE__ = true; (window as any).__TEST_CALLS__.length = 0; });
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(3);
  await expect(
    page.getByRole("tab", { name: "Other window", exact: true }),
  ).toBeVisible();
  const calls = await page.evaluate(() => (window as any).__TEST_CALLS__);
  expect(calls.filter((r:any) => r.op === 'workspace_get')).toHaveLength(2);
  expect(calls.filter((r:any) => r.op === 'workspace_save').map((r:any) => r.expectedRevision)).toEqual([0,1]);
  expect(calls.filter((r:any) => r.op === 'snapshot')).toHaveLength(1);
});
for (const replacement of ['profile','import']) {
  test(`workspace-only pre-read preserves mutation scope across ${replacement}`, async ({page}) => {
    await fixture(page,{savedProfile:true});
    await page.evaluate(() => {const w=window as any; let once=true; w.__TEST_AFTER_DISPATCH__=async(r:any)=>{if(r.op==='workspace_get' && once){once=false; w.__HELD_WORKSPACE__=true; await new Promise<void>(resolve => w.__RELEASE_WORKSPACE__=resolve);}};});
    await page.getByRole('button',{name:'Technology',exact:true}).click();
    await expect.poll(() => page.evaluate(() => (window as any).__HELD_WORKSPACE__)).toBe(true);
    if(replacement==='profile') {
      await page.getByLabel('Reading profile',{exact:true}).selectOption('default');
      await expect(page.getByLabel('Reading profile',{exact:true})).toHaveValue('default');
    } else {
      const backup=await page.evaluate(() => JSON.stringify((window as any).__TEST_SNAPSHOT__()));
      await page.getByRole('button',{name:'Settings',exact:true}).click();
      await page.getByRole('button',{name:'Backup',exact:true}).click();
      await page.getByLabel('Backup JSON').fill(backup);
      await page.getByLabel('I understand this replaces the current local data').check();
      await page.getByRole('button',{name:'Import backup',exact:true}).click();
      await expect(page.getByRole('button',{name:'Import backup',exact:true})).toBeDisabled();
    }
    await page.evaluate(async () => {(window as any).__RELEASE_WORKSPACE__(); await new Promise(requestAnimationFrame);});
    if(replacement==='import') {await expect(page.getByText('Backup imported.',{exact:true})).toBeVisible(); await page.getByRole('button',{name:'Close settings'}).click();}
    await expect(page.getByRole('tab',{name:'Headlines',exact:true})).toBeVisible();
    const result=await page.evaluate(() => ({calls:(window as any).__TEST_CALLS__, current:(window as any).__TEST_SNAPSHOT__()}));
    expect(result.current.workspace.tabs[0].mode).toBe('all');
    const saves=result.calls.filter((r:any)=>r.op==='workspace_save');
    expect(saves.length).toBe(replacement==='profile' ? 1 : 0);
    if(replacement==='profile') {expect(saves[0].profileId).toBe('desk-b'); expect(await page.evaluate(()=>(window as any).__TEST_SNAPSHOT__('desk-b').workspace.tabs[0].section)).toBe('technology');}
  });
}

test("fixture: detached window locks profile and mutates only its own tab", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => {
    (window as any).__TEST_CONTEXT__ = {
      label: "detached-home",
      detached: true,
      profileId: "default",
      tabId: "home",
    };
    window.dispatchEvent(new Event("data-changed"));
  });
  await expect(
    page.getByRole("button", { name: "Reattach", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Reading profile")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "New tab", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Technology", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Technology", exact: true }),
  ).toBeVisible();
});
test("fixture: single-letter shortcuts do not intercept modified system shortcuts", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", {
      name: "Researchers map a new lunar water reserve",
      exact: true,
    })
    .click();
  await page.keyboard.press("Control+s");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__TEST_CALLS__.filter(
            (r: any) => r.op === "article_state" && "saved" in r,
          ).length,
      ),
    )
    .toBe(0);
});
