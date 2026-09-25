import { test, expect } from '@playwright/test';
import { fixture } from './fixture';

test('pane preferences survive reload and narrow layouts, scoped by profile and window/tab', async ({page}) => {
  await fixture(page, {savedProfile:true});
  const reader = page.getByRole('separator',{name:'Reading pane width'});
  await reader.focus(); await page.keyboard.press('End');
  await expect(reader).toHaveAttribute('aria-valuenow','600');
  await page.reload();
  await expect(reader).toHaveAttribute('aria-valuenow','600');
  await page.setViewportSize({width:640,height:720});
  await page.setViewportSize({width:1440,height:960});
  await expect(reader).toHaveAttribute('aria-valuenow','600');
  await page.getByLabel('Reading profile',{exact:true}).selectOption('default');
  await expect(reader).toHaveAttribute('aria-valuenow','390');
  await page.getByLabel('Reading profile',{exact:true}).selectOption('desk-b');
  await expect(reader).toHaveAttribute('aria-valuenow','600');
  await page.evaluate(() => { (window as any).__TEST_CONTEXT__ = {label:'detached-home',detached:true,profileId:'desk-b',tabId:'home'}; window.dispatchEvent(new Event('data-changed')); });
  await expect(reader).toHaveAttribute('aria-valuenow','390');
  await reader.focus(); await page.keyboard.press('Home');
  await expect(reader).toHaveAttribute('aria-valuenow','290');
  await page.evaluate(() => { (window as any).__TEST_CONTEXT__ = undefined; window.dispatchEvent(new Event('data-changed')); });
  await expect(reader).toHaveAttribute('aria-valuenow','600');
});

test('committed pointer resize persists, malformed or blocked layout storage is harmless', async ({page}) => {
  await fixture(page);
  const reader = page.getByRole('separator',{name:'Reading pane width'});
  const box = (await reader.boundingBox())!;
  await page.mouse.move(box.x + box.width/2, box.y + 40); await page.mouse.down();
  await page.mouse.move(box.x - 80, box.y + 40); await page.mouse.up();
  const preferred = await reader.getAttribute('aria-valuenow');
  await page.reload();
  await expect(reader).toHaveAttribute('aria-valuenow',preferred!);
  await page.evaluate(() => { for (const key of Object.keys(localStorage)) if(key.startsWith('news-terminal:panes:')) localStorage.setItem(key,'{"version":1,"nav":-200,"detail":"600px"}'); });
  await page.reload();
  await expect(reader).toHaveAttribute('aria-valuenow','390');
  await page.addInitScript(() => { const get = Storage.prototype.getItem; Storage.prototype.getItem = function(key) {if(key.startsWith('news-terminal:panes:')) throw new Error('storage denied'); return get.call(this,key);}; const set = Storage.prototype.setItem; Storage.prototype.setItem = function(key,value) {if(key.startsWith('news-terminal:panes:')) throw new Error('storage denied'); return set.call(this,key,value);}; });
  await page.reload();
  await reader.focus(); await page.keyboard.press('End');
  await expect(reader).toHaveAttribute('aria-valuenow','600');
  await expect(page.getByTestId('story-row')).toHaveCount(3);
});

test('day-aware row dates remain semantic and readable at compact widths', async ({page}, info) => {
  await page.clock.setFixedTime(new Date('2026-09-23T12:00:00'));
  await fixture(page);
  await page.evaluate(() => {
    const s = (window as any).__TEST_SNAPSHOT__();
    (window as any).__TEST_PATCH__({articles:s.articles.map((a:any,i:number) => ({...a,publishedAt:new Date(['2026-09-23T09:20:00','2026-09-22T09:20:00','2026-09-16T09:20:00'][i]).getTime()/1000}))});
    window.dispatchEvent(new Event('data-changed'));
  });
  await expect(page.locator('.row-meta time').nth(1)).toHaveText('yesterday');
  await expect(page.locator('.row-meta time').nth(2)).toHaveText('Sep 16');
  await expect(page.locator('.row-meta time').first()).toHaveAttribute('datetime', /2026-09-23T/);
  for(const width of [390,640,1024]) {
    await page.setViewportSize({width,height:844});
    expect(await page.evaluate(() => document.body.scrollWidth)).toBe(width);
    await expect(page.locator('.headline').first()).toBeVisible();
    await expect(page.locator('.row-meta time').nth(2)).toBeVisible();
    await page.screenshot({path:info.outputPath(`daily-dates-${width}.png`)});
  }
});
