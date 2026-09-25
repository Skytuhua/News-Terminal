import { test, expect } from '@playwright/test';
import { fixture } from './fixture';

test('Unread J J K returns to the previous story without consuming C', async ({page}) => {
  await fixture(page);
  await page.getByLabel('Unread', {exact:true}).check();
  await page.locator('.list-heading h2').click();
  await page.keyboard.press('j');
  await expect(page.locator('.detail h2')).toHaveText('Researchers map a new lunar water reserve');
  await expect(page.getByTestId('story-row')).toHaveCount(2);
  await page.keyboard.press('j');
  await expect(page.locator('.detail h2')).toHaveText('What lunar water observations can tell us');
  await expect(page.getByTestId('story-row')).toHaveCount(1);
  await page.keyboard.press('k');
  await expect(page.locator('.detail h2')).toHaveText('Researchers map a new lunar water reserve');
  expect(await page.evaluate(() => (window as any).__TEST_SNAPSHOT__().articles.find((a:any) => a.id === 'c').read)).toBe(false);
  await page.keyboard.press('k');
  await expect(page.locator('.detail h2')).toHaveText('Researchers map a new lunar water reserve');
});

test('bounded pages retain every cached story, full search and keyboard crossing', async ({ page }, info) => {
  await fixture(page);
  await page.evaluate(() => {
    const s = (window as any).__TEST_SNAPSHOT__();
    (window as any).__TEST_PATCH__({ articles: Array.from({length: 5101}, (_, i) => ({...s.articles[0], id:`daily-${i}`, title:`Daily report ${i}`, groupId:`g-${Math.floor(i/3)}`, saved:i === 5100 })) });
    window.dispatchEvent(new Event('data-changed'));
  });
  await page.getByRole('button', {name:'5101 new stories · Show latest'}).click();
  await expect(page.getByTestId('story-row')).toHaveCount(100);
  await expect(page.getByText('5101 stories', {exact:true})).toBeVisible();
  await page.locator('.headline').first().click();
  for(let i = 0; i < 100; i++) await page.keyboard.press('j');
  await expect(page.locator('.detail h2')).toHaveText('Daily report 100');
  await expect(page.locator('[data-article-id="daily-100"]')).toBeVisible();
  await page.keyboard.press('k');
  await expect(page.locator('[data-article-id="daily-99"]')).toBeInViewport();
  await page.getByRole('button', {name:'Next page',exact:true}).click();
  await expect(page.locator('[data-article-id="daily-100"]')).toBeInViewport();
  await page.screenshot({path:info.outputPath('daily-paged-reader.png')});
  await page.getByRole('button', {name:'Last page',exact:true}).click();
  await expect(page.getByTestId('story-row')).toHaveCount(1);
  await page.getByRole('button', {name:'Daily report 5100',exact:true}).click();
  await expect(page.locator('.detail h2')).toHaveText('Daily report 5100');
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_SNAPSHOT__().workspace.tabs[0].selectedId)).toBe('daily-5100');
  await page.reload();
  await expect(page.locator('.detail h2')).toHaveText('Daily report 5100');
  await expect(page.locator('[data-article-id="daily-5100"]')).toBeVisible();
  await page.getByRole('searchbox').fill('Daily report 5100');
  await expect(page.getByTestId('story-row')).toHaveCount(1);
  await expect(page.locator('.headline')).toHaveText('Daily report 5100');
  await page.getByRole('button', {name:'Saved stories',exact:true}).click();
  await expect(page.locator('.headline')).toHaveText('Daily report 5100');
});
