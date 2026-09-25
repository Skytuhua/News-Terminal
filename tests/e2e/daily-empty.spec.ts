import { test, expect } from '@playwright/test';
import { fixture } from './fixture';

test('all-hidden and hidden Saved empties offer persistent recovery, not an empty cache claim', async ({page}) => {
  await fixture(page);
  await page.evaluate(() => {const w=window as any, s=w.__TEST_SNAPSHOT__(); w.__TEST_PATCH__({articles:s.articles.map((a:any) => ({...a, hidden:true, saved:true}))}); window.dispatchEvent(new Event('data-changed'));});
  await expect(page.getByRole('heading',{name:'Your stories are hidden'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Your cache is empty'})).toHaveCount(0);
  await page.getByRole('button',{name:'View hidden stories',exact:true}).click();
  await expect(page.locator('.hidden-row')).toHaveCount(3);
  await page.getByRole('button',{name:'Saved stories',exact:true}).click();
  await expect(page.getByRole('heading',{name:'No visible saved stories'})).toBeVisible();
  await page.getByRole('button',{name:'View hidden stories',exact:true}).click();
  await expect(page.locator('.hidden-row')).toHaveCount(3);
});

test('empty Saved and filtered Saved have different truthful recovery actions', async ({page}) => {
  await fixture(page);
  await page.getByRole('button',{name:'Saved stories',exact:true}).click();
  await expect(page.getByRole('heading',{name:'No saved stories yet'})).toBeVisible();
  await page.getByRole('button',{name:'Browse headlines',exact:true}).click();
  await page.locator('.headline').first().click();
  await page.getByLabel('Save story',{exact:true}).click();
  await page.getByLabel('Unsave story',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Saved stories',exact:true}).click();
  await page.getByLabel('Unread',{exact:true}).check();
  await expect(page.getByRole('heading',{name:'No saved stories match these filters'})).toBeVisible();
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  await expect(page.getByTestId('story-row')).toHaveCount(1);
});

test('empty cache offers refresh, no enabled sources offers source setup, refresh error offers retry', async ({page}) => {
  await fixture(page);
  await page.evaluate(() => { (window as any).__TEST_PATCH__({articles:[],lastRefresh:null}); window.dispatchEvent(new Event('data-changed')); });
  await expect(page.getByRole('heading',{name:'Your cache is empty'})).toBeVisible();
  await expect(page.locator('.empty').getByRole('button',{name:'Refresh feeds',exact:true})).toBeVisible();
  await page.evaluate(() => { (window as any).__FAIL_OP__ = 'refresh'; });
  await page.locator('.empty').getByRole('button',{name:'Refresh feeds',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Fixture service unavailable');
  await page.evaluate(() => { (window as any).__FAIL_OP__ = ''; });
  await page.getByRole('button',{name:'Retry refresh',exact:true}).click();
  await expect(page.getByText('Refresh complete · 1 updated · 0 source failures',{exact:true})).toBeVisible();
  await page.evaluate(() => {
    const s = (window as any).__TEST_SNAPSHOT__();
    (window as any).__TEST_PATCH__({sources:s.sources.map((source:any) => ({...source, enabled:false}))});
    window.dispatchEvent(new Event('data-changed'));
  });
  await expect(page.getByRole('heading',{name:'No sources enabled'})).toBeVisible();
  await page.locator('.empty').getByRole('button',{name:'Manage sources',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('caught-up Unread resolves in one action; delayed search never claims an empty collection', async ({page}) => {
  await fixture(page);
  await page.evaluate(() => {
    const s = (window as any).__TEST_SNAPSHOT__();
    (window as any).__TEST_PATCH__({articles:s.articles.map((a:any) => ({...a,read:true}))});
    window.dispatchEvent(new Event('data-changed'));
    (window as any).__TEST_BEFORE_DISPATCH__ = async (r:any) => { if(r.op === 'search') await new Promise(resolve => { (window as any).__RELEASE_SEARCH__ = resolve; }); };
  });
  await page.getByLabel('Unread',{exact:true}).check();
  await expect(page.getByRole('heading',{name:'You’re caught up'})).toBeVisible();
  await page.getByRole('button',{name:'Show all stories',exact:true}).click();
  await expect(page.getByTestId('story-row')).toHaveCount(3);
  await page.getByRole('searchbox').fill('impossiblequery');
  await expect(page.getByText('Searching…',{exact:true}).first()).toBeVisible();
  await expect(page.getByRole('heading',{name:'No cached matches'})).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => !!(window as any).__RELEASE_SEARCH__)).toBe(true);
  await page.evaluate(() => (window as any).__RELEASE_SEARCH__());
  await expect(page.getByRole('heading',{name:'No cached matches'})).toBeVisible();
  await page.getByRole('button',{name:'Clear search',exact:true}).click();
  await expect(page.getByTestId('story-row')).toHaveCount(3);
});
