import { test, expect, type Page } from '@playwright/test';
import { fixture } from './fixture';
const hiddenNav = (page: Page) => page.getByRole('button', {name:'Hidden stories', exact:true});
const recovery = (page: Page) => page.getByRole('main', {name:'Hidden stories'});
async function seedHidden(page:Page, count=201) {
  await page.evaluate(count => {
    const w = window as any, s = w.__TEST_SNAPSHOT__();
    w.__TEST_PATCH__({retainedArticles:Array.from({length:count}, (_,i) => ({...s.articles[0], id:`h${i}`, title:`Hidden report ${i}`, sourceName: i === count-1 ? 'Final Publisher' : 'Science Wire', hidden:true, saved:i%2===0, firstSeen:10000-i}))});
  }, count);
}

test('5000 retained hidden stories stay reachable with bounded mounted rows', async ({page},testInfo) => {
  await fixture(page); await seedHidden(page,5000);
  const started=performance.now();
  await hiddenNav(page).click();
  await expect(recovery(page).locator('.hidden-row')).toHaveCount(100);
  const loaded=performance.now();
  await recovery(page).getByLabel('Find hidden title or publisher').fill('4999 final');
  await expect(recovery(page).locator('.hidden-row')).toHaveCount(1);
  await expect(recovery(page).getByText('Hidden report 4999',{exact:true})).toBeVisible();
  const searched=performance.now();
  const calls=await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r:any) => ['search','article_state','summarize','media_load'].includes(r.op)));
  expect(calls).toEqual([]);
  const evidence={fixture:'synthetic retained hidden collection outside ordinary snapshot',retained:5000,mountedPageRows:100,filteredRows:1,loadAndPaintMs:loaded-started,localSearchAndPaintMs:searched-loaded,nativePerformance:false};
  console.log(JSON.stringify(evidence));
  await testInfo.attach('hidden-5000-measurement',{body:JSON.stringify(evidence),contentType:'application/json'});
});

test('short-height recovery paging reveals the next page start instead of keeping the old scroll offset', async ({page}) => {
  await fixture(page); await seedHidden(page); await hiddenNav(page).click();
  await page.setViewportSize({width:720,height:450});
  const view=recovery(page);
  await expect(view.locator('.hidden-row')).toHaveCount(100);
  await view.getByRole('button',{name:'Next page',exact:true}).click();
  await expect(view.getByText('Hidden report 100',{exact:true})).toBeInViewport();
  await expect(view.locator('.hidden-row').first()).toBeInViewport({ratio:1});
});

test('all retained hidden titles and publishers are reachable with 100-row pages and focus recovery', async ({page}) => {
  await fixture(page); await seedHidden(page);
  await hiddenNav(page).click();
  const view = recovery(page);
  await expect(view.locator('.hidden-row')).toHaveCount(100);
  await view.getByRole('button', {name:'Last page', exact:true}).click();
  await expect(view.locator('.hidden-row')).toHaveCount(1);
  await expect(view.getByText('Hidden report 200', {exact:true})).toBeVisible();
  await view.getByLabel('Find hidden title or publisher').fill('PUBLISHER 200');
  await expect(view.locator('.hidden-row')).toHaveCount(1);
  await view.getByLabel('Find hidden title or publisher').fill('');
  await view.getByRole('button', {name:'Last page', exact:true}).click();
  await view.getByRole('button', {name:'Restore', exact:true}).click();
  await expect(view.locator('.hidden-row')).toHaveCount(100);
  await expect(view.locator('.hidden-row').last().getByRole('button', {name:'Restore'})).toBeFocused();
  await expect(view.locator('.hidden-row').last()).toBeInViewport();
  await view.getByRole('button', {name:'First page', exact:true}).click();
  await expect(view.locator('.hidden-row').first()).toBeInViewport();
  await view.getByLabel('Find hidden title or publisher').fill('impossible query');
  await expect(view.getByText('No hidden stories match', {exact:true})).toBeVisible();
  await view.getByRole('button', {name:'Clear hidden search'}).click();
  await expect(view.locator('.hidden-row')).toHaveCount(100);
});

test('query and write failures stay recoverable; acknowledged restore requires confirmation, not another write', async ({page}) => {
  await fixture(page); await seedHidden(page,1);
  await page.evaluate(() => (window as any).__FAIL_OP__ = 'hidden_stories');
  await hiddenNav(page).click();
  const view = recovery(page);
  await expect(view.getByRole('alert')).toContainText('Could not load hidden stories');
  await expect(view.getByText('No hidden stories', {exact:true})).toHaveCount(0);
  await page.evaluate(() => (window as any).__FAIL_OP__ = undefined);
  await view.getByRole('button', {name:'Reload hidden stories'}).click();
  await expect(view.locator('.hidden-row')).toHaveCount(1);
  await page.evaluate(() => (window as any).__FAIL_OP__ = 'article_state');
  await view.getByRole('button', {name:'Restore', exact:true}).click();
  await expect(view.getByRole('alert')).toContainText('Could not restore story');
  await expect(view.getByRole('button', {name:'Restore', exact:true})).toBeEnabled();
  await page.evaluate(() => { const w = window as any; w.__FAIL_OP__ = undefined; w.__TEST_AFTER_DISPATCH__ = (r:any) => { if(r.op === 'article_state') w.__FAIL_OP__ = 'hidden_stories'; }; });
  await view.getByRole('button', {name:'Restore', exact:true}).click();
  await expect(view.getByRole('alert')).toContainText('Restore acknowledged, but confirmation failed');
  await expect(view.getByText('Story restored', {exact:true})).toHaveCount(0);
  await expect(view.getByRole('button', {name:'Awaiting confirmation'})).toBeDisabled();
  await page.evaluate(() => { const w=window as any; w.__FAIL_OP__ = undefined; w.__TEST_AFTER_DISPATCH__ = undefined; });
  await view.getByRole('button', {name:'Reload hidden stories'}).click();
  await expect(view.getByText('No hidden stories', {exact:true})).toBeVisible();
  await expect(view.getByRole('status')).toContainText('Story restored');
  await expect(view.getByRole('button', {name:'Browse headlines'})).toBeFocused();
});

test('unconfirmed restore keeps remaining buttons visibly unavailable until reload', async ({page}) => {
  await fixture(page); await seedHidden(page,2); await hiddenNav(page).click();
  const view=recovery(page);
  await expect(view.locator('.hidden-row')).toHaveCount(2);
  await page.evaluate(() => {const w=window as any; w.__TEST_AFTER_DISPATCH__=(r:any)=>{if(r.op==='article_state') w.__FAIL_OP__='hidden_stories';};});
  await view.getByRole('button',{name:'Restore',exact:true}).first().click();
  await expect(view.getByRole('alert')).toContainText('Restore acknowledged');
  await expect(view.getByRole('button',{name:'Restore',exact:true})).toBeDisabled();
  await page.evaluate(() => {const w=window as any; w.__FAIL_OP__=undefined; w.__TEST_AFTER_DISPATCH__=undefined;});
  await view.getByRole('button',{name:'Reload hidden stories'}).click();
  await expect(view.getByRole('button',{name:'Restore',exact:true})).toBeEnabled();
  await expect(view.locator('.hidden-row')).toHaveCount(1);
});

test('cross-window hidden changes refresh the mounted recovery collection without polling', async ({page}) => {
  await fixture(page); await seedHidden(page,2); await hiddenNav(page).click();
  const view = recovery(page);
  await expect(view.locator('.hidden-row')).toHaveCount(2);
  await page.evaluate(() => {const w=window as any; const s=w.__TEST_SNAPSHOT__(); s.retainedArticles[0].hidden=false; w.__TEST_PATCH__(s); for(let i=0;i<8;i++) window.dispatchEvent(new Event('data-changed'));});
  await expect(view.locator('.hidden-row')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r:any) => r.op==='hidden_stories').length)).toBe(2);
});

test('hidden search shortcuts remain local and failed reload never claims an empty collection', async ({page}) => {
  await fixture(page); await hiddenNav(page).click();
  const view=recovery(page);
  await expect(view.getByText('No hidden stories',{exact:true})).toBeVisible();
  await page.keyboard.press('/');
  await expect(view.getByLabel('Find hidden title or publisher')).toBeFocused();
  await view.getByRole('heading',{name:'Hidden stories',exact:true}).click();
  await page.keyboard.press('Control+k');
  await expect(view.getByLabel('Find hidden title or publisher')).toBeFocused();
  await page.evaluate(() => (window as any).__FAIL_OP__='hidden_stories');
  await view.getByRole('button',{name:'Reload hidden stories'}).click();
  await expect(view.getByRole('alert')).toContainText('Could not load hidden stories');
  await expect(view.getByText('No hidden stories',{exact:true})).toHaveCount(0);
});

test('restore confirmation is newer than an already in-flight collection read', async ({page}) => {
  await fixture(page); await seedHidden(page,1); await hiddenNav(page).click();
  const view=recovery(page);
  await expect(view.locator('.hidden-row')).toHaveCount(1);
  await page.evaluate(() => {const w=window as any; let once=true; w.__TEST_AFTER_DISPATCH__=async (r:any) => {if(r.op==='hidden_stories' && once) {once=false; w.__HELD__=true; await new Promise<void>(resolve => w.__RELEASE__=resolve);}}; window.dispatchEvent(new Event('data-changed'));});
  await expect.poll(() => page.evaluate(() => (window as any).__HELD__)).toBe(true);
  await view.getByRole('button',{name:'Restore',exact:true}).click();
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_SNAPSHOT__().retainedArticles[0].hidden)).toBe(false);
  await expect(view.getByRole('button',{name:'Restoring…',exact:true})).toBeDisabled();
  await page.evaluate(() => (window as any).__RELEASE__());
  await expect(view.getByText('No hidden stories',{exact:true})).toBeVisible();
  await expect(view.getByRole('status')).toContainText('Story restored');
  await expect(view.getByRole('button',{name:'Browse headlines'})).toBeFocused();
});

for (const held of ['article_state','hidden_stories']) {
  for (const leave of ['profile','tab']) {
    test(`late ${held} response cannot revive a previous ${leave} recovery surface`, async ({page}) => {
      await fixture(page,{savedProfile:true}); await seedHidden(page,1);
      await hiddenNav(page).click();
      await expect(recovery(page).locator('.hidden-row')).toHaveCount(1);
      await page.evaluate(held => {const w=window as any; let once=true; w.__TEST_AFTER_DISPATCH__=async (r:any) => {if(r.op===held && once) {once=false; w.__HELD__=true; await new Promise<void>(resolve => w.__RELEASE__=resolve);}};}, held);
      await recovery(page).getByRole('button',{name:held==='article_state' ? 'Restore' : 'Reload hidden stories',exact:true}).click();
      await expect.poll(() => page.evaluate(() => (window as any).__HELD__)).toBe(true);
      if(leave==='profile') {
        await page.getByLabel('Reading profile',{exact:true}).selectOption('default');
        await expect(page.getByTestId('story-row')).toHaveCount(3);
        await seedHidden(page,1); await hiddenNav(page).click();
        await expect(recovery(page).locator('.hidden-row')).toHaveCount(1);
      } else {
        await page.getByRole('button',{name:'New tab',exact:true}).click();
        await expect(page.getByTestId('story-row')).toHaveCount(3);
      }
      const before=await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r:any) => r.op==='hidden_stories').length);
      await page.evaluate(async () => {(window as any).__RELEASE__(); await new Promise(requestAnimationFrame);});
      expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r:any) => r.op==='hidden_stories').length)).toBe(before);
      await expect(page.getByText('Story restored',{exact:true})).toHaveCount(0);
      if(leave==='profile') {
        await expect(recovery(page).locator('.hidden-row')).toHaveCount(1);
        const profiles=await page.evaluate(() => ({a:(window as any).__TEST_SNAPSHOT__('desk-b'),b:(window as any).__TEST_SNAPSHOT__('default')}));
        expect(profiles.b.retainedArticles[0]).toMatchObject({hidden:true,read:false,saved:true});
        expect(profiles.a.retainedArticles[0].hidden).toBe(held !== 'article_state');
      } else await expect(recovery(page)).toHaveCount(0);
    });
  }
}

for (const held of ['article_state','hidden_stories']) {
  test(`import replaces a hidden recovery view despite a delayed ${held} response`, async ({page}) => {
    await fixture(page); await seedHidden(page,2); await hiddenNav(page).click();
    await expect(recovery(page).locator('.hidden-row')).toHaveCount(2);
    await page.evaluate(held => {
      const w=window as any;
      let once=true;
      w.__TEST_AFTER_DISPATCH__ = async (r:any) => { if(r.op===held && once) {once=false; w.__HELD__=true; await new Promise<void>(resolve => w.__RELEASE__=resolve);} };
    }, held);
    await recovery(page).getByRole('button', {name:held==='article_state' ? 'Restore' : 'Reload hidden stories', exact:true}).first().click();
    await expect.poll(() => page.evaluate(() => (window as any).__HELD__)).toBe(true);
    const backup = await page.evaluate(() => {const s=(window as any).__TEST_SNAPSHOT__(); s.retainedArticles=[{...s.retainedArticles[0], hidden:true, title:'Imported hidden title'}]; return JSON.stringify(s);});
    await page.getByRole('button', {name:'Settings',exact:true}).click();
    await page.getByRole('button', {name:'Backup',exact:true}).click();
    await page.getByLabel('Backup JSON').fill(backup);
    await page.getByLabel('I understand this replaces the current local data').check();
    await page.getByRole('button', {name:'Import backup',exact:true}).click();
    await expect(page.getByText('Backup imported.',{exact:true})).toBeVisible();
    await page.getByRole('button', {name:'Close settings',exact:true}).click();
    await expect(recovery(page).getByText('Imported hidden title',{exact:true})).toBeVisible();
    await page.evaluate(async () => { (window as any).__RELEASE__(); await new Promise(requestAnimationFrame); });
    await expect(recovery(page).locator('.hidden-row')).toHaveCount(1);
    await expect(recovery(page).getByText('Imported hidden title',{exact:true})).toBeVisible();
    await expect(recovery(page).getByText('Story restored',{exact:true})).toHaveCount(0);
    expect(await page.evaluate(() => {const c=(window as any).__TEST_CALLS__; return c.slice(c.findIndex((r:any) => r.op==='import')+1).filter((r:any) => r.op==='article_state' || r.op==='workspace_save');})).toEqual([]);
  });
}

test('restores a hidden saved story after reload without changing flags or reading', async ({page}) => {
  await fixture(page);
  await page.getByRole('button', {name:'Researchers map a new lunar water reserve', exact:true}).click();
  await page.getByRole('button', {name:'Save story', exact:true}).click();
  await expect(page.getByRole('button', {name:'Unsave story', exact:true})).toBeVisible();
  await page.getByRole('button', {name:'Hide story', exact:true}).click();
  await page.getByRole('button', {name:'Dismiss hidden story notice'}).click();
  await page.reload();
  await hiddenNav(page).click();
  await expect(recovery(page).getByRole('heading', {name:'Researchers map a new lunar water reserve'})).toBeVisible();
  await page.reload();
  await expect(recovery(page)).toBeVisible();
  await page.evaluate(() => (window as any).__TEST_CALLS__.length = 0);
  await page.keyboard.press('j'); await page.keyboard.press('s'); await page.keyboard.press('o');
  await recovery(page).getByRole('button', {name:'Restore', exact:true}).click();
  await expect(recovery(page).getByText('No hidden stories', {exact:true})).toBeVisible();
  await expect(recovery(page).getByRole('status')).toContainText('Story restored');
  const state = await page.evaluate(() => ({s:(window as any).__TEST_SNAPSHOT__(), calls:(window as any).__TEST_CALLS__}));
  expect(state.s.articles[0]).toMatchObject({hidden:false, read:true, saved:true, groupId:'moon'});
  expect(state.calls.filter((r:any) => r.op === 'article_state')).toEqual([{op:'article_state', profileId:'default', articleId:'a', hidden:false, replacementToken:expect.any(String)}]);
  expect(state.calls.some((r:any) => ['summarize','media_load','open_original'].includes(r.op))).toBe(false);
});
