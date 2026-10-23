import { test, expect, type Page } from '@playwright/test';
import { fixture } from './fixture';

async function remoteImport(page: Page, suppressEvent = false) {
  await page.evaluate(async suppressEvent => {
    const w = window as any, backup = w.__TEST_SNAPSHOT__();
    backup.profile.preferences.topics = ['imported'];
    w.__TEST_SUPPRESS_REPLACEMENT_EVENT__ = suppressEvent;
    await w.__NEWS_TEST_DISPATCH__({op:'import', data:JSON.stringify(backup)});
  }, suppressEvent);
}

test('remote import discards an unsaved preferences draft with the same profile id', async ({page}) => {
  await fixture(page);
  await page.getByRole('button', {name:'Settings', exact:true}).click();
  await page.locator('input[name="topics"]').fill('obsolete draft');
  await remoteImport(page);
  await expect(page.locator('input[name="topics"]')).toHaveValue('imported');
  await page.getByRole('button', {name:'Save preferences', exact:true}).click();
  await expect(page.getByText('Preferences saved.', {exact:true})).toBeVisible();
  expect(await page.evaluate(() => (window as any).__TEST_SNAPSHOT__().profile.preferences.topics)).toEqual(['imported']);
});

test('a settings save held before host execution cannot overwrite a remote import before its event arrives', async ({page}) => {
  await fixture(page);
  await page.getByRole('button', {name:'Settings', exact:true}).click();
  await page.locator('input[name="topics"]').fill('obsolete draft');
  await page.evaluate(() => {
    const w = window as any;
    w.__TEST_BEFORE_DISPATCH__ = async (r:any) => {
      if (r.op === 'profile_update') await new Promise<void>(resolve => {w.__RELEASE_SAVE__ = resolve;});
    };
  });
  await page.getByRole('button', {name:'Save preferences', exact:true}).click();
  await expect.poll(() => page.evaluate(() => !!(window as any).__RELEASE_SAVE__)).toBe(true);
  await remoteImport(page, true);
  await page.evaluate(() => (window as any).__RELEASE_SAVE__());
  await expect(page.getByRole('alert')).toContainText('Database replaced');
  expect(await page.evaluate(() => (window as any).__TEST_SNAPSHOT__().profile.preferences.topics)).toEqual(['imported']);
  await page.evaluate(() => window.dispatchEvent(new Event('database-replaced')));
  await expect(page.locator('input[name="topics"]')).toHaveValue('imported');
});

test('remote import clears watchlist editing state as well as its input draft', async ({page}) => {
  await fixture(page);
  await page.evaluate(() => {
    const w = window as any;
    w.__TEST_PATCH__({watchlists:[{id:'watch', name:'Original watch', keywords:['old'], topics:[], sources:[], alerts:false}]});
    window.dispatchEvent(new Event('data-changed'));
  });
  await page.getByRole('button', {name:'Settings', exact:true}).click();
  await page.getByRole('button', {name:'Watchlists', exact:true}).click();
  await page.getByRole('button', {name:'Edit Original watch', exact:true}).click();
  await page.getByLabel('Watchlist name', {exact:true}).fill('Obsolete draft');
  await page.evaluate(async () => {
    const w = window as any, backup = w.__TEST_SNAPSHOT__();
    backup.watchlists[0].name = 'Imported watch';
    await w.__NEWS_TEST_DISPATCH__({op:'import', data:JSON.stringify(backup)});
  });
  await expect(page.getByRole('button', {name:'Edit Imported watch', exact:true})).toBeVisible();
  await expect(page.getByLabel('Watchlist name', {exact:true})).toHaveValue('');
  await expect(page.getByRole('button', {name:'Cancel editing', exact:true})).toHaveCount(0);
  await page.getByRole('button', {name:'Edit Imported watch', exact:true}).click();
  await expect(page.getByLabel('Watchlist name', {exact:true})).toHaveValue('Imported watch');
});

test('bulk Hide closes selected stories in every tab and keeps them closed after reload', async ({page}) => {
  await fixture(page);
  await page.evaluate(() => {
    const w = window as any, backup = w.__TEST_SNAPSHOT__();
    backup.workspace.tabs[0].selectedId = 'a';
    backup.workspace.tabs.push({id:'other', title:'Other desk', mode:'all', topic:'', query:'', selectedId:'a'});
    w.__TEST_PATCH__({workspace:backup.workspace});
    window.dispatchEvent(new Event('data-changed'));
  });
  await page.locator('[data-article-id="a"] .headline').click();
  await expect(page.locator('.detail h2')).toHaveText('Researchers map a new lunar water reserve');
  await page.getByRole('checkbox', {name:'Select Researchers map a new lunar water reserve', exact:true}).check();
  await page.getByRole('region', {name:'Bulk actions'}).getByRole('button', {name:'Hide', exact:true}).click();
  await expect(page.locator('[data-article-id="a"]')).toHaveCount(0);
  await expect(page.locator('.detail h2')).toHaveText('Select a story');
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_SNAPSHOT__().workspace.tabs.map((t:any) => t.selectedId || null))).toEqual([null, null]);
  await page.reload();
  await expect(page.getByRole('tab', {name:'Headlines', exact:true})).toBeVisible();
  await expect(page.locator('.detail h2')).toHaveText('Select a story');
  await page.getByRole('tab', {name:'Other desk', exact:true}).click();
  await expect(page.locator('.detail h2')).toHaveText('Select a story');
});

test('a delayed bulk Hide acknowledgement preserves a newer reader selection', async ({page}) => {
  await fixture(page);
  await page.locator('[data-article-id="a"] .headline').click();
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_SNAPSHOT__().workspace.tabs[0].selectedId)).toBe('a');
  await page.getByRole('checkbox', {name:'Select Researchers map a new lunar water reserve', exact:true}).check();
  await page.evaluate(() => {
    const w = window as any;
    w.__TEST_AFTER_DISPATCH__ = async (r:any) => {
      if (r.op === 'article_state_many') await new Promise<void>(resolve => {w.__RELEASE_HIDE__ = resolve;});
    };
  });
  await page.getByRole('region', {name:'Bulk actions'}).getByRole('button', {name:'Hide', exact:true}).click();
  await expect.poll(() => page.evaluate(() => !!(window as any).__RELEASE_HIDE__)).toBe(true);
  await page.locator('[data-article-id="b"] .headline').click();
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_SNAPSHOT__().workspace.tabs[0].selectedId)).toBe('b');
  await page.evaluate(() => (window as any).__RELEASE_HIDE__());
  await expect(page.getByText('1 stories hidden', {exact:true})).toBeVisible();
  await expect(page.locator('.detail h2')).toHaveText('What lunar water observations can tell us');
  expect(await page.evaluate(() => (window as any).__TEST_SNAPSHOT__().workspace.tabs[0].selectedId)).toBe('b');
});

test('an acknowledged bulk Hide clears persisted selections when its snapshot readback fails', async ({page}) => {
  await fixture(page);
  await page.locator('[data-article-id="a"] .headline').click();
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_SNAPSHOT__().workspace.tabs[0].selectedId)).toBe('a');
  await page.getByRole('checkbox', {name:'Select Researchers map a new lunar water reserve', exact:true}).check();
  await page.evaluate(() => {
    const w = window as any;
    w.__TEST_BEFORE_DISPATCH__ = (r:any) => {
      if (r.op === 'snapshot' && w.__TEST_CALLS__.some((r:any) => r.op === 'article_state_many'))
        throw new Error('Bulk Hide readback unavailable');
    };
  });
  await page.getByRole('region', {name:'Bulk actions'}).getByRole('button', {name:'Hide', exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Bulk Hide readback unavailable');
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_SNAPSHOT__().workspace.tabs[0].selectedId)).toBeUndefined();
  await expect(page.locator('.detail h2')).toHaveText('Select a story');
});
