import { test, expect } from '@playwright/test';
import { fixture } from './fixture';

test('a rejected import leaves the original workspace usable after closing settings', async ({page}) => {
  await fixture(page);
  const backup=await page.evaluate(() => {const w=window as any; w.__FAIL_OP__='import'; return JSON.stringify(w.__TEST_SNAPSHOT__());});
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Backup',exact:true}).click();
  await page.getByLabel('Backup JSON').fill(backup);
  await page.getByLabel('I understand this replaces the current local data').check();
  await page.getByRole('button',{name:'Import backup',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Fixture service unavailable');
  await page.getByRole('button',{name:'Close settings',exact:true}).click();
  await expect(page.getByRole('tab',{name:'Headlines',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Technology',exact:true}).click();
  await expect(page.getByRole('tab',{name:'Technology',exact:true})).toBeVisible();
});

test('local replacement rejects a Restore held before host execution', async ({page}) => {
  await fixture(page);
  await page.evaluate(() => { const w=window as any, s=w.__TEST_SNAPSHOT__(); w.__TEST_PATCH__({retainedArticles:[{...s.articles[0],hidden:true,saved:true,title:'Original hidden'}]}); });
  await page.getByRole('button',{name:'Hidden stories',exact:true}).click();
  const view=page.getByRole('main',{name:'Hidden stories'});
  await expect(view.getByText('Original hidden',{exact:true})).toBeVisible();
  await page.evaluate(() => {
    const w=window as any; let once=true;
    w.__TEST_BEFORE_DISPATCH__=async (r:any) => {if(r.op==='article_state' && once) {once=false; w.__HELD__=true; await new Promise<void>(resolve=>w.__RELEASE__=resolve);}};
  });
  await view.getByRole('button',{name:'Restore',exact:true}).click();
  await expect.poll(() => page.evaluate(() => (window as any).__HELD__)).toBe(true);
  const backup=await page.evaluate(() => {const s=(window as any).__TEST_SNAPSHOT__(); s.retainedArticles[0].title='Imported hidden'; return JSON.stringify(s);});
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Backup',exact:true}).click();
  await page.getByLabel('Backup JSON').fill(backup);
  await page.getByLabel('I understand this replaces the current local data').check();
  await page.getByRole('button',{name:'Import backup',exact:true}).click();
  await expect(page.getByText('Backup imported.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close settings',exact:true}).click();
  await expect(view.getByText('Imported hidden',{exact:true})).toBeVisible();
  await page.evaluate(async () => {(window as any).__RELEASE__(); await new Promise(requestAnimationFrame);});
  expect(await page.evaluate(() => (window as any).__TEST_SNAPSHOT__().retainedArticles[0].hidden)).toBe(true);
  await expect(view.getByText('Story restored',{exact:true})).toHaveCount(0);
  await view.getByRole('button',{name:'Restore',exact:true}).click();
  await expect(view.getByText('No hidden stories',{exact:true})).toBeVisible();
});

for (const detached of [false, true]) {
test(`remote replacement releases ${detached ? 'detached' : 'main'} Hidden from an old read without waiting for its reply`, async ({page}) => {
  await fixture(page);
  if (detached) {
    await page.evaluate(() => {const w=window as any; w.__TEST_CONTEXT__={label:'detached-home',detached:true,profileId:'default',tabId:'home'}; window.dispatchEvent(new Event('data-changed'));});
    await expect(page.getByRole('button',{name:'Reattach',exact:true})).toBeVisible();
  }
  await page.evaluate(() => {const w=window as any,s=w.__TEST_SNAPSHOT__(); w.__TEST_PATCH__({retainedArticles:[{...s.articles[0],title:'Original hidden',hidden:true,saved:true}]});});
  await page.getByRole('button',{name:'Hidden stories',exact:true}).click();
  const view=page.getByRole('main',{name:'Hidden stories'});
  await expect(view.getByText('Original hidden',{exact:true})).toBeVisible();
  await page.evaluate(() => {
    const w=window as any; let once=true;
    w.__TEST_AFTER_DISPATCH__=async (r:any) => {if(r.op==='hidden_stories' && once) {once=false; w.__HELD__=true; await new Promise<void>(resolve=>w.__RELEASE__=resolve);}};
    window.dispatchEvent(new Event('data-changed'));
  });
  await expect.poll(() => page.evaluate(() => (window as any).__HELD__)).toBe(true);
  await page.evaluate(async () => {
    const w=window as any,s=w.__TEST_SNAPSHOT__(); s.retainedArticles[0].title='Remote imported hidden';
    let once=true;
    w.__TEST_BEFORE_DISPATCH__=async (r:any) => {if(r.op==='snapshot' && once) {once=false; w.__NEW_HELD__=true; await new Promise<void>(resolve=>w.__RELEASE_NEW__=resolve);}};
    await w.__NEWS_TEST_DISPATCH__({op:'import',data:JSON.stringify(s)});
    window.dispatchEvent(new Event('data-changed'));
  });
  await expect.poll(() => page.evaluate(() => (window as any).__NEW_HELD__)).toBe(true);
  // Old content is invalidated even while replacement snapshot readback is held.
  await expect(view.getByText('Original hidden',{exact:true})).toHaveCount(0);
  await page.evaluate(() => (window as any).__RELEASE_NEW__());
  // The fresh collection must not queue behind the obsolete hidden read.
  await expect(view.getByText('Remote imported hidden',{exact:true})).toBeVisible();
  await page.evaluate(async () => {(window as any).__RELEASE__(); await new Promise(requestAnimationFrame);});
  await expect(view.getByText('Remote imported hidden',{exact:true})).toBeVisible();
  await expect(view.getByText('Original hidden',{exact:true})).toHaveCount(0);
});
}

test('remote replacement cancels a held workspace intent with identical ids and revision zero', async ({page}) => {
  await fixture(page);
  await page.evaluate(() => {
    const w = window as any; let once = true;
    w.__TEST_AFTER_DISPATCH__ = async (r:any) => {
      if (r.op === 'workspace_get' && once) { once=false; w.__HELD__=true; await new Promise<void>(resolve => w.__RELEASE__=resolve); }
    };
  });
  await page.getByRole('button',{name:'Technology',exact:true}).click();
  await expect.poll(() => page.evaluate(() => (window as any).__HELD__)).toBe(true);
  await page.evaluate(async () => {
    const w=window as any, s=w.__TEST_SNAPSHOT__();
    s.workspace.tabs.push({id:'import-only',title:'Imported tab',topic:'',query:'',mode:'all'});
    await w.__NEWS_TEST_DISPATCH__({op:'import',data:JSON.stringify(s)});
    window.dispatchEvent(new Event('data-changed'));
  });
  await expect(page.getByRole('tab',{name:'Imported tab',exact:true})).toBeVisible();
  await page.evaluate(async () => { (window as any).__RELEASE__(); await new Promise(requestAnimationFrame); });
  await expect(page.getByRole('tab',{name:'Imported tab',exact:true})).toBeVisible();
  const state=await page.evaluate(() => ({s:(window as any).__TEST_SNAPSHOT__(),calls:(window as any).__TEST_CALLS__}));
  expect(state.s.workspace.tabs.map((t:any) => t.id)).toEqual(['home','import-only']);
  expect(state.s.workspace.tabs[0].topic).toBe('');
  expect(state.calls.filter((r:any) => r.op==='workspace_save')).toHaveLength(0);
});

for (const held of ['workspace_save', 'retry-read']) {
  test(`host rejects obsolete workspace intent at ${held} before replacement event delivery`, async ({page}) => {
    await fixture(page);
    await page.evaluate(held => {
      const w=window as any; let once=true, reads=0;
      w.__TEST_SUPPRESS_REPLACEMENT_EVENT__=true;
      w.__TEST_CONFLICT_ONCE__=held==='retry-read';
      w.__TEST_BEFORE_DISPATCH__=async (r:any) => {
        if(r.op==='workspace_get') reads++;
        if(once && (held==='workspace_save' ? r.op==='workspace_save' : r.op==='workspace_get' && reads===2)) {
          once=false; w.__HELD__=true; await new Promise<void>(resolve=>w.__RELEASE__=resolve);
        }
      };
    },held);
    await page.getByRole('button',{name:'Technology',exact:true}).click();
    await expect.poll(() => page.evaluate(() => (window as any).__HELD__)).toBe(true);
    await page.evaluate(async () => {
      const w=window as any,s=w.__TEST_SNAPSHOT__();
      s.workspace={revision:0,activeTabId:'home',tabs:[{id:'home',title:'Headlines',topic:'',query:'',mode:'all'},{id:'import-only',title:'Imported tab',topic:'',query:'',mode:'all'}]};
      await w.__NEWS_TEST_DISPATCH__({op:'import',data:JSON.stringify(s)});
      w.__RELEASE__(); await new Promise(requestAnimationFrame);
    });
    const state=await page.evaluate(() => ({s:(window as any).__TEST_SNAPSHOT__(),calls:(window as any).__TEST_CALLS__}));
    expect(state.s.workspace.tabs.map((t:any)=>t.id)).toEqual(['home','import-only']);
    expect(state.s.workspace.tabs[0].topic).toBe('');
    expect(state.s.workspace.revision).toBe(0);
    expect(state.calls.filter((r:any)=>r.op==='workspace_save')).toHaveLength(1);
    // No obsolete intent is retried, even when a normal CAS retry was underway.
    await page.evaluate(() => window.dispatchEvent(new Event('database-replaced')));
    await expect(page.getByRole('tab',{name:'Imported tab',exact:true})).toBeVisible();
  });
}
