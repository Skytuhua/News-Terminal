import { test, expect } from '@playwright/test';
import { fixture } from './fixture';

for (const change of ['revoke', 'source', 'compact', 'profile', 'import', 'viewport'] as const) {
  test(`late thumbnail discarded and cancelled after ${change}`, async ({ page }) => {
    await fixture(page, { v02:true, savedProfile: change === 'profile' });
    await page.evaluate(() => {
      (window as any).__TEST_BEFORE_DISPATCH__ = async (r:any) => {
        if (r.op === 'media_load') await new Promise<void>(resolve => { const w = window as any; (w.__RELEASE_IMAGES__ ||= []).push(resolve); w.__RELEASE_IMAGE__ = () => w.__RELEASE_IMAGES__.splice(0).forEach((release:()=>void) => release()); });
      };
    });
    await page.getByRole('button', { name:'Enable automatic images' }).click();
    await expect.poll(() => page.evaluate(() => !!(window as any).__RELEASE_IMAGE__)).toBe(true);
    if (change === 'source') await page.evaluate(async () => { await (window as any).__NEWS_TEST_DISPATCH__({op:'source_update',sourceId:'science',mediaAllowed:false}); });
    if (change === 'revoke') await page.getByRole('button', { name:'Disable automatic images' }).click();
    if (change === 'compact') await page.getByRole('button', { name:'Compact', exact:true }).click();
    if (change === 'profile') await page.getByLabel('Reading profile', { exact:true }).selectOption('default');
    if (change === 'import') await page.evaluate(async () => {
      const w = window as any;
      const backup = await w.__NEWS_TEST_DISPATCH__({op:'export'});
      await w.__NEWS_TEST_DISPATCH__({op:'import',data:backup});
    });
    if (change === 'viewport') await page.locator('.row-thumbnail').first().evaluate(node => { (node as HTMLElement).style.transform = 'translateY(10000px)'; });
    await expect.poll(() => page.evaluate(() => (window as any).__TEST_CALLS__.some((r:any) => r.op === 'media_cancel'))).toBe(true);
    await page.evaluate(() => { (window as any).__RELEASE_IMAGE__(); });
    await expect(page.locator('.row-thumbnail img')).toHaveCount(0);
  });
}

test('invalid native response gets a stable fallback and original remains available', async ({ page }) => {
  await fixture(page, { v02:true });
  await page.evaluate(() => { (window as any).__MEDIA_BAD_URL__ = true; });
  await page.getByRole('button', { name:'Enable automatic images' }).click();
  await expect(page.locator('.row-thumbnail').getByText('Image unavailable', {exact:true})).toBeVisible();
  await expect(page.locator('.row-thumbnail img')).toHaveCount(0);
  await page.getByRole('button', { name:'Researchers map a new lunar water reserve', exact:true }).click();
  await expect(page.getByRole('button', {name:'Open media original 1'})).toBeVisible();
});


for (const viewport of [{width:1440,height:900}, {width:1024,height:768}, {width:800,height:600}]) {
  test(`image layout screenshot ${viewport.width}`, async ({ page, browser }, info) => {
    await page.setViewportSize(viewport);
    await fixture(page, {v02:true});
    await page.getByRole('button', {name:'Enable automatic images'}).click();
    await expect(page.locator('.row-thumbnail img')).toBeVisible();
    const image = page.locator('.row-thumbnail img');
    await expect(image).toHaveCSS('object-fit', 'contain');
    const frame = page.locator('.thumbnail-frame');
    expect((await image.boundingBox())!.width).toBeCloseTo((await frame.boundingBox())!.width - 2, 0);
    expect(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`images-${viewport.width}.png`)});
    if (viewport.width === 1440) {
      // 200% desktop zoom has half the logical viewport and twice the device scale.
      const zoomContext = await browser.newContext({viewport:{width:720,height:450},deviceScaleFactor:2,baseURL:'http://127.0.0.1:1420'});
      const zoomPage = await zoomContext.newPage();
      await fixture(zoomPage, {v02:true});
      await zoomPage.getByRole('button', {name:'Enable automatic images'}).click();
      await expect(zoomPage.locator('.row-thumbnail img')).toBeVisible();
      expect(await zoomPage.evaluate(() => document.body.scrollWidth <= window.innerWidth)).toBe(true);
      await zoomPage.screenshot({path:info.outputPath('images-200-percent.png')});
      await zoomContext.close();
    }
  });
}

test('one opt-in loads credited visible thumbnails; Compact clears images without remote src', async ({ page }) => {
  const remote: string[] = [];
  page.on('request', r => { if (r.url().includes('example.org')) remote.push(r.url()); });
  await fixture(page, { v02: true });
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.some((r:any) => r.op === 'media_load'))).toBe(false);
  await page.getByRole('button', { name: 'Enable automatic images' }).click();
  const image = page.locator('.row-thumbnail img').first();
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img:HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('.row-thumbnail').getByText('Credit: Test fixture')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r:any) => r.op === 'media_load')[0])).toMatchObject({automatic:true,profileId:'default'});
  await page.getByRole('button', { name: 'Compact', exact:true }).click();
  await expect(page.locator('.row-thumbnail')).toHaveCount(0);
  expect(remote).toEqual([]);
});
