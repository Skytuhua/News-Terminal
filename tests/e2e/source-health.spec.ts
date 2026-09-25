import {test, expect} from '@playwright/test';
import {fixture} from './fixture';
test('failed first retrieval offers source review and refresh; partial failure keeps cached stories and offers review', async ({page}) => {
  await fixture(page);
  await page.evaluate(() => {const w=window as any, s=w.__TEST_SNAPSHOT__(); w.__TEST_PATCH__({articles:[], sources:s.sources.map((s:any) => ({...s, lastSuccess:null, failures:1,status:'Network timeout', lastAttempt:200, retryAt:300}))}); window.dispatchEvent(new Event('data-changed'));});
  await expect(page.getByRole('heading',{name:'Enabled sources have not retrieved stories'})).toBeVisible();
  await page.locator('.empty').getByRole('button',{name:'Review source failures',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button',{name:'Close settings',exact:true}).click();
  await page.evaluate(() => {const w=window as any; w.__TEST_ADD_STORY__=true; w.__TEST_REFRESH_RESULT__={updated:1,failed:1};});
  await page.locator('.empty').getByRole('button',{name:'Refresh feeds',exact:true}).click();
  await expect(page.getByTestId('story-row')).toHaveCount(1);
  await expect(page.getByText('Refresh complete · 1 updated · 1 source failures',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Review source failures',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r:any) => r.op==='refresh').length)).toBe(1);
});

test('enabled-source failures are actionable and timing respects interval plus backoff without fetching', async ({page}) => {
  await fixture(page);
  await page.evaluate(() => {
    const w=window as any, s=w.__TEST_SNAPSHOT__(), base=s.sources[0];
    const future=Math.floor(Date.now()/1000)+3600;
    w.__TEST_PATCH__({sources:[{...base, status:'HTTP 429; retry after 120 seconds', failures:2, lastAttempt:future, retryAt:future+120, refreshMinutes:30, lastSuccess:null}, {...base,id:'disabled',name:'Disabled Wire',enabled:false,failures:8}, {...base,id:'legacy',name:'Legacy Wire',lastSuccess:null,status:'Not fetched'}, {...base,id:'cached-legacy',name:'Cached Legacy Wire',status:'Legacy timeout'}, {...base,id:'previous-success',name:'Previously successful Wire',failures:1,status:'Timeout'}]});
    window.dispatchEvent(new Event('data-changed'));
  });
  await expect(page.getByRole('button',{name:'Sources & health 2 failing'})).toBeVisible();
  await page.getByRole('button',{name:'Sources & health 2 failing'}).click();
  await expect(page.getByLabel('Source directory summary')).toContainText('5 configured');
  await expect(page.getByLabel('Source directory summary')).toContainText('5 free keyless');
  const science=page.locator('.source-row').filter({has:page.getByText('Science Wire',{exact:true})});
  await expect(science).toContainText('Adapter: RSS/Atom feed');
  await expect(science).toContainText('Access: Free, no key');
  await expect(science).toContainText('Images: reviewed candidates');
  await expect(science).toContainText('Failed · no successful retrieval');
  await expect(science).toContainText('Last attempt:');
  await expect(science).toContainText('Eligible after');
  await expect(science).toContainText('HTTP 429');
  await expect(page.locator('.source-row').filter({has:page.getByText('Disabled Wire',{exact:true})})).toContainText('Disabled · not scheduled');
  await expect(page.locator('.source-row').filter({has:page.getByText('Legacy Wire',{exact:true})})).toContainText('Eligibility unavailable');
  await expect(page.locator('.source-row').filter({has:page.getByText('Cached Legacy Wire',{exact:true})})).toContainText('Successful retrieval recorded');
  await expect(page.locator('.source-row').filter({has:page.getByText('Previously successful Wire',{exact:true})})).toContainText('Failed · previous success recorded');
  await expect(page.getByRole('button',{name:'Retry now',exact:true})).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r:any) => ['refresh','source_update','media_load'].includes(r.op)))).toEqual([]);
  await page.getByRole('button',{name:'Close settings',exact:true}).click();
  await expect(page.getByTestId('story-row')).toHaveCount(3);
});
