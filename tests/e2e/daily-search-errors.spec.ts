import { test, expect } from '@playwright/test';
import { fixture } from './fixture';

test('search failures offer retry instead of claiming there are no cached matches', async ({page}) => {
  await fixture(page);
  await page.evaluate(() => { (window as any).__FAIL_OP__ = 'search'; });
  await page.getByRole('searchbox').fill('lunar');
  await expect(page.getByRole('alert')).toContainText('Fixture service unavailable');
  await expect(page.getByRole('heading',{name:'No cached matches'})).toHaveCount(0);
  await page.evaluate(() => { (window as any).__FAIL_OP__ = ''; });
  await page.getByRole('button',{name:'Retry search',exact:true}).click();
  await expect(page.getByTestId('story-row')).toHaveCount(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
