import { test, expect } from '@playwright/test';
import { fixture } from './fixture';

// Install the broadcast wrapper before the renderer captures its IPC dispatcher.
async function broadcastFixture(page: import('@playwright/test').Page) {
  const navigate = page.goto.bind(page);
  page.goto = async (...args: Parameters<typeof page.goto>) => {
    await page.addInitScript(() => {
      let original = (window as any).__NEWS_TEST_DISPATCH__;
      Object.defineProperty(window, '__NEWS_TEST_DISPATCH__', { configurable: true,
        set(value) { original = value; },
        get() { return original && (async (r: any) => {
          const value = await original(r);
          if (['article_state','workspace_save','refresh'].includes(r.op)) window.dispatchEvent(new Event('data-changed'));
          return value;
        }); },
      });
    });
    return navigate(...args);
  };
  try { await fixture(page); } finally { page.goto = navigate; }
}

test('mutation broadcasts and explicit readback coalesce; query persistence does not repeat search', async ({page}) => {
  await broadcastFixture(page);
  await page.evaluate(() => { (window as any).__TEST_CALLS__.length = 0; });
  await page.locator('.headline').first().click();
  await expect(page.getByRole('button', {name:'Mark unread',exact:true})).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_SNAPSHOT__().workspace.tabs[0].selectedId)).toBe('a');
  const counts = await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r:any) => r.op === 'snapshot').length);
  expect(counts).toBeLessThanOrEqual(2);
  await page.getByRole('searchbox').fill('lunar');
  await expect(page.getByTestId('story-row')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_SNAPSHOT__().workspace.tabs[0].query)).toBe('lunar');
  await page.waitForTimeout(400); // regression window: old effect restarts after the 350 ms save
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r:any) => r.op === 'search').length)).toBe(1);
  await page.evaluate(() => { (window as any).__TEST_CALLS__.length = 0; });
  await page.getByRole('button', {name:'Refresh feeds',exact:true}).click();
  await expect(page.getByText('Refresh complete · 1 updated · 0 source failures',{exact:true})).toBeVisible();
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r:any) => r.op === 'snapshot').length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r:any) => r.op === 'search').length)).toBe(0);
  await page.getByRole('button', {name:'Save story',exact:true}).click();
  await page.getByRole('button', {name:'Unsave story',exact:true}).waitFor();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r:any) => r.op === 'search').length)).toBe(0);
  await page.evaluate(() => { const s = (window as any).__TEST_SNAPSHOT__(); (window as any).__TEST_PATCH__({articles:s.articles.map((a:any) => a.id === 'b' ? {...a,title:'Corrected independent report',excerpt:'No matching term'} : a)}); window.dispatchEvent(new Event('data-changed')); });
  await expect(page.getByTestId('story-row')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r:any) => r.op === 'search').length)).toBe(1);
});
