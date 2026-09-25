import { test, expect, type Page } from '@playwright/test';
import { fixture } from './fixture';

for (const failedRead of ['snapshot', 'window_context']) {
  test(`acknowledged Hide keeps Undo when ${failedRead} readback fails`, async ({page}) => {
    await fixture(page, {savedProfile:true});
    await page.locator('.headline').first().click();
    await page.getByLabel('Save story', {exact:true}).click();
    await page.getByLabel('Unsave story', {exact:true}).waitFor();
    await page.evaluate(failedRead => {
      const w = window as any;
      w.__TEST_BEFORE_DISPATCH__ = (r:any) => {
        if (r.op === failedRead && w.__TEST_CALLS__.some((call:any) => call.op === 'article_state' && call.hidden === true))
          throw new Error('Hide readback unavailable');
      };
    }, failedRead);
    await page.getByRole('button', {name:'Hide story',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('Hide readback unavailable');
    expect(await page.evaluate(() => (window as any).__TEST_SNAPSHOT__().articles[0])).toMatchObject({id:'a',saved:true,hidden:true});
    await expect(page.getByRole('button', {name:'Undo hide',exact:true})).toBeEnabled();
    await page.evaluate(() => { (window as any).__TEST_BEFORE_DISPATCH__ = undefined; });
    await page.getByRole('button', {name:'Refresh feeds',exact:true}).click();
    await expect(page.getByTestId('story-row')).toHaveCount(2);
    await expect(page.getByRole('button', {name:'Undo hide',exact:true})).toBeEnabled();
    await page.getByLabel('Reading profile',{exact:true}).selectOption('default');
    await expect(page.getByTestId('story-row')).toHaveCount(3);
    await expect(page.getByRole('button', {name:'Undo hide',exact:true})).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__TEST_SNAPSHOT__().articles[0])).toMatchObject({id:'a',saved:false,hidden:false});
    await page.getByLabel('Reading profile',{exact:true}).selectOption('desk-b');
    await expect(page.getByRole('button', {name:'Undo hide',exact:true})).toBeEnabled();
    await page.getByRole('button', {name:'Undo hide',exact:true}).click();
    await expect(page.getByTestId('story-row')).toHaveCount(3);
    expect(await page.evaluate(() => (window as any).__TEST_SNAPSHOT__().articles[0])).toMatchObject({id:'a',saved:true,hidden:false});
    expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r:any) => r.op === 'article_state' && 'hidden' in r))).toEqual([
      expect.objectContaining({profileId:'desk-b',articleId:'a',hidden:true}),
      expect.objectContaining({profileId:'desk-b',articleId:'a',hidden:false}),
    ]);
  });
}

async function importHiddenStory(page: Page) {
  const backup = await page.evaluate(() => {
    const backup = (window as any).__TEST_SNAPSHOT__();
    backup.articles[0].hidden = true;
    backup.articles[0].saved = true;
    backup.workspace.tabs[0].selectedId = 'b';
    return JSON.stringify(backup);
  });
  await page.getByRole('button', {name:'Settings',exact:true}).click();
  await page.getByRole('button', {name:'Backup',exact:true}).click();
  await page.getByLabel('Backup JSON').fill(backup);
  await page.getByLabel('I understand this replaces the current local data').check();
  await page.getByRole('button', {name:'Import backup',exact:true}).click();
}

async function expectImportedState(page: Page) {
  await expect(page.locator('.detail h2')).toHaveText('What lunar water observations can tell us');
  await expect(page.getByRole('button', {name:'Undo hide',exact:true})).toHaveCount(0);
  const state = await page.evaluate(() => {
    const w = window as any;
    const calls = w.__TEST_CALLS__;
    return {snapshot:w.__TEST_SNAPSHOT__(), postImport:calls.slice(calls.findIndex((r:any) => r.op === 'import') + 1)};
  });
  expect(state.snapshot.articles[0]).toMatchObject({id:'a',saved:true,hidden:true});
  expect(state.snapshot.workspace.tabs[0].selectedId).toBe('b');
  expect(state.postImport.filter((r:any) => r.op === 'workspace_save' || (r.op === 'article_state' && 'hidden' in r))).toEqual([]);
}

for (const operation of ['Hide', 'Undo']) {
  test(`import discards a delayed pre-import ${operation} acknowledgement`, async ({page}) => {
    await fixture(page);
    await page.locator('.headline').first().click();
    await page.getByLabel('Save story', {exact:true}).click();
    await page.getByLabel('Unsave story', {exact:true}).waitFor();
    if (operation === 'Undo') {
      await page.getByRole('button', {name:'Hide story',exact:true}).click();
      await expect(page.getByRole('button', {name:'Undo hide',exact:true})).toBeEnabled();
    }
    await page.evaluate(operation => {
      const w = window as any;
      w.__TEST_AFTER_DISPATCH__ = async (r:any) => {
        if (r.op === 'article_state' && r.hidden === (operation === 'Hide')) {
          w.__ACK_HELD__ = true;
          await new Promise<void>(resolve => { w.__RELEASE_ACK__ = resolve; });
        }
      };
    }, operation);
    await page.getByRole('button', {name:operation === 'Hide' ? 'Hide story' : 'Undo hide',exact:true}).click();
    await expect.poll(() => page.evaluate(() => (window as any).__ACK_HELD__)).toBe(true);
    await importHiddenStory(page);
    await expect(page.getByText('Backup imported.',{exact:true})).toBeVisible();
    await page.getByRole('button', {name:'Close settings',exact:true}).click();
    await expectImportedState(page);
    await page.evaluate(async () => {
      (window as any).__RELEASE_ACK__();
      await new Promise(requestAnimationFrame);
    });
    await expect(page.getByRole('button', {name:'Hide story',exact:true})).toBeEnabled();
    await expectImportedState(page);
    await expect(page.getByText('Hidden story restored',{exact:true})).toHaveCount(0);
  });
}

test('import invalidates Hide waiting in a coalesced background readback', async ({page}) => {
  await fixture(page);
  await page.locator('.headline').first().click();
  await page.getByLabel('Save story', {exact:true}).click();
  await page.getByLabel('Unsave story', {exact:true}).waitFor();
  await page.evaluate(() => {
    const w = window as any;
    let hold = true;
    w.__TEST_AFTER_DISPATCH__ = async (r:any) => {
      if (r.op === 'import') w.__IMPORT_APPLIED__ = true;
      if (r.op === 'snapshot' && hold) {
        hold = false;
        w.__BACKGROUND_HELD__ = true;
        w.__SNAPSHOT_COUNT__ = w.__TEST_CALLS__.filter((r:any) => r.op === 'snapshot').length;
        await new Promise<void>(resolve => { w.__RELEASE_BACKGROUND__ = resolve; });
      }
    };
    window.dispatchEvent(new Event('data-changed'));
  });
  await expect.poll(() => page.evaluate(() => (window as any).__BACKGROUND_HELD__)).toBe(true);
  await page.getByRole('button', {name:'Hide story',exact:true}).click();
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_SNAPSHOT__().articles[0].hidden)).toBe(true);
  await importHiddenStory(page);
  await expect.poll(() => page.evaluate(() => (window as any).__IMPORT_APPLIED__)).toBe(true);
  // Replacement reads must bypass the old coordinator, not wait for its response.
  await expect(page.getByText('Backup imported.',{exact:true})).toBeVisible();
  expect(await page.evaluate(() => {
    const w = window as any;
    return w.__TEST_CALLS__.filter((r:any) => r.op === 'snapshot').length - w.__SNAPSHOT_COUNT__;
  })).toBe(1);
  await page.evaluate(async () => { (window as any).__RELEASE_BACKGROUND__(); await new Promise(requestAnimationFrame); });
  await page.getByRole('button', {name:'Close settings',exact:true}).click();
  await expectImportedState(page);
  expect(await page.evaluate(() => {
    const w = window as any;
    return w.__TEST_CALLS__.filter((r:any) => r.op === 'snapshot').length - w.__SNAPSHOT_COUNT__;
  })).toBe(1);
});

test('Close is not Hide; saved Hide can be undone, including after a failed Undo', async ({page}, info) => {
  await fixture(page);
  await page.locator('.headline').first().click();
  await page.getByLabel('Save story', {exact:true}).click();
  await page.getByLabel('Unsave story', {exact:true}).waitFor();
  await page.getByLabel('Close story', {exact:true}).click();
  await expect(page.getByTestId('story-row')).toHaveCount(3);
  expect(await page.evaluate(() => (window as any).__TEST_SNAPSHOT__().articles[0])).toMatchObject({hidden:false,saved:true});
  await page.getByRole('button', {name:'Saved stories',exact:true}).click();
  await page.locator('.headline').click();
  await page.evaluate(() => { (window as any).__FAIL_OP__ = 'article_state'; });
  await page.getByRole('button', {name:'Hide story',exact:true}).click();
  await expect(page.locator('.detail h2')).toContainText('Researchers');
  await expect(page.getByRole('alert')).toContainText('Fixture service unavailable');
  await page.evaluate(() => { (window as any).__FAIL_OP__ = ''; });
  await page.getByRole('button', {name:'Hide story',exact:true}).click();
  await expect(page.getByTestId('story-row')).toHaveCount(0);
  await expect(page.getByRole('heading', {name:'No visible saved stories',exact:true})).toBeVisible();
  await page.evaluate(() => { (window as any).__FAIL_OP__ = 'article_state'; });
  await page.getByRole('button', {name:'Undo hide',exact:true}).click();
  await expect(page.getByRole('button', {name:'Undo hide',exact:true})).toBeEnabled();
  await page.evaluate(() => { (window as any).__FAIL_OP__ = ''; });
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:info.outputPath('daily-narrow-undo.png')});
  await page.getByRole('button', {name:'Undo hide',exact:true}).click();
  await expect(page.getByTestId('story-row')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__TEST_SNAPSHOT__().articles[0])).toMatchObject({hidden:false,saved:true});
});

test('an Undo offer cannot mutate the same article ID in a different profile', async ({page}) => {
  await fixture(page, {savedProfile:true});
  await page.locator('.headline').first().click();
  await page.getByRole('button', {name:'Hide story',exact:true}).click();
  await expect(page.getByRole('button', {name:'Undo hide',exact:true})).toBeVisible();
  await page.getByLabel('Reading profile',{exact:true}).selectOption('default');
  await expect(page.getByTestId('story-row')).toHaveCount(3);
  await expect(page.getByRole('button', {name:'Undo hide',exact:true})).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r:any) => r.op === 'article_state' && r.hidden === false))).toEqual([]);
});
