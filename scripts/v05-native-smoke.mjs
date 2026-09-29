// Windows/WebView2 + real Rust host acceptance for the 0.5 features.
// SYNTHETIC fixtures via the validated native import only.
// node scripts/v05-native-smoke.mjs [--exe src-tauri/target/release/news-terminal.exe] [--prefix v05-native]
// Does NOT build, modify production data, mock IPC, start servers or models, or
// stop unowned processes. Owns and terminates only the process it starts.
//
// Purpose: the 0.5 browser tests exercise the renderer against a fixture
// dispatch, which never reaches Rust. The two new host operations -
// article_state_many and alert_receipts - therefore have no native evidence at
// all until this runs. This script is that evidence.
import { chromium, expect } from '@playwright/test';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: {
  exe: { type: 'string', default: 'src-tauri/target/release/news-terminal.exe' },
  prefix: { type: 'string', default: `v05-native-${new Date().toISOString().replace(/[^0-9]/g, '')}` },
} });
assert.match(values.prefix, /^v05-native-[\w-]+$/);
const base = resolve(root, 'docs/evidence', values.prefix);
mkdirSync(resolve(root, 'docs/evidence'), { recursive: true });
const sha = (b) => createHash('sha256').update(b).digest('hex');
const FIXTURE_COUNT = 6;
const evidence = { startedAt: new Date().toISOString(), executable: resolve(root, values.exe),
  fixtureLabel: 'SYNTHETIC 0.5 FIXTURE — not real news', fixtureCount: FIXTURE_COUNT,
  checks: [], launches: [], screenshots: [], pageErrors: [], consoleErrors: [], limitations: [
    'Only the recorded executable hash is accepted. No build or claim of source-to-binary freshness is made.',
    `${FIXTURE_COUNT} explicitly synthetic stories imported through the real validated native backup API into a newly-created temporary appdata directory. IPC and DOM are not mocked.`,
    'Covers the 0.5 features only. The 0.3-era daily workflow is covered by scripts/daily-native-smoke.mjs.',
    'The detached-window check is deliberately excluded: a window created after startup does not register a CDP target, so the harness cannot observe it. See docs/v05-native-acceptance.md.',
    'No network/AI/feed quality, installer, physical DPI, or Windows notification toast acceptance is implied.',
  ] };
let app, browser, main, dataDirectory;
const save = () => writeFileSync(`${base}.json`, JSON.stringify(evidence, null, 2));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, message = 'Condition did not settle', timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await delay(150); }
  throw Error(message);
}
const invoke = (page, request) =>
  page.evaluate((r) => window.__TAURI_INTERNALS__.invoke('dispatch', { request: r }), request);
const snapshot = (page = main) => invoke(page, { op: 'snapshot', profileId: 'default' });
const rows = (page = main) => page.getByTestId('story-row');
const state = (a) => ({ read: a.read, saved: a.saved, hidden: a.hidden });
function osWindows() {
  // Visible windows with a non-empty title only. Without those two filters the
  // enumeration also returns IME helper windows owned by the same process,
  // which made a correct single-window launch look like four.
  const osPython = String.raw`
import ctypes as c, ctypes.wintypes as w, json, sys
u=c.windll.user32
u.GetWindowThreadProcessId.argtypes=[w.HWND,c.POINTER(w.DWORD)]
u.IsWindowVisible.argtypes=[w.HWND]
u.GetWindowTextW.argtypes=[w.HWND,w.LPWSTR,c.c_int]
a=json.loads(sys.argv[1]); windows=[]
@c.WINFUNCTYPE(w.BOOL,w.HWND,w.LPARAM)
def cb(h,p):
    pid=w.DWORD();u.GetWindowThreadProcessId(h,c.byref(pid))
    if pid.value==a['pid'] and u.IsWindowVisible(h):
        t=c.create_unicode_buffer(512);u.GetWindowTextW(h,t,512)
        if t.value: windows.append(dict(hwnd=int(h),pid=pid.value,title=t.value,visible=True))
    return True
u.EnumWindows(cb,0)
print(json.dumps(windows))`;
  return JSON.parse(execFileSync(process.env.V05_NATIVE_PYTHON || 'python',
    ['-c', osPython, JSON.stringify({ pid: app.pid })], { encoding: 'utf8', timeout: 15000 }));
}
async function ready(page) {
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => evidence.pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') evidence.consoleErrors.push(m.text()); });
  await page.getByRole('tablist', { name: 'Workspace tabs' }).waitFor();
  assert.match(page.url(), /^https?:\/\/tauri\.localhost/, 'Requires embedded executable, not a Vite/browser fixture');
}
async function check(name, fn, opts = {}) {
  const startedAt = new Date().toISOString();
  try { const detail = await fn(); evidence.checks.push({ name, passed: true, detail, startedAt, finishedAt: new Date().toISOString() }); save();
    console.log(`PASS ${name}`); }
  catch (error) { evidence.checks.push({ name, passed: false, error: String(error).slice(0, 1500), startedAt, finishedAt: new Date().toISOString() }); save();
    console.log(`FAIL ${name}`); if (opts.required) throw error; }
}
const shot = async (name, page = main) => {
  const file = `${base}-${name}.png`;
  await page.screenshot({ path: file });
  evidence.screenshots.push(file);
};

try {
  dataDirectory = mkdtempSync(join(tmpdir(), 'v05-native-'));
  mkdirSync(join(dataDirectory, 'webview'), { recursive: true });
  const port = await new Promise((done, reject) => { const s = createServer(); s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const n = s.address().port; s.close(() => done(n)); }); });
  const run = { port, startedAt: new Date().toISOString(), stderr: '' };
  evidence.launches.push(run);
  evidence.launchedExecutable = resolve(root, values.exe);
  app = spawn(evidence.launchedExecutable, [], { env: { ...process.env,
    NEWS_TERMINAL_DATA_DIR: dataDirectory, NEWS_TERMINAL_CDP_PORT: String(port),
    NEWS_TERMINAL_WEBVIEW_DATA_DIR: join(dataDirectory, 'webview') }, stdio: 'pipe' });
  run.pid = app.pid; let spawnError;
  app.on('error', (e) => { spawnError = e; });
  app.stderr.on('data', (b) => { run.stderr = (run.stderr + b).slice(-12000); });
  app.stdout.on('data', () => {});
  await until(async () => { if (spawnError) throw spawnError;
    if (app.exitCode !== null) throw Error(`Owned process exited ${app.exitCode}`);
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }); return true; } catch { return false; } },
  'CDP did not open', 45000);
  await until(async () => { for (const c of browser.contexts()) for (const p of c.pages())
    try { if ((await invoke(p, { op: 'window_context' })).label === 'main') { main = p; return true; } } catch {}
    return false; }, 'Native main window target not ready', 45000);
  await ready(main);
  // Track why the window disappears, so a silent exit is not mistaken for a
  // product failure with no evidence behind it.
  app.on('exit', (code, signal) => { evidence.appExit = { code, signal, at: new Date().toISOString() }; save(); });
  main.on('close', () => { evidence.mainPageClosed = new Date().toISOString(); save(); });
  main.on('crash', () => { evidence.mainPageCrashed = new Date().toISOString(); save(); });

  await check('actual native runtime and embedded assets', async () => {
    const session = await main.context().newCDPSession(main);
    await session.send('Page.enable');
    const { frameTree } = await session.send('Page.getResourceTree');
    const urls = await main.evaluate(() => [...document.querySelectorAll('script[src],link[rel="stylesheet"]')]
      .map((e) => e.src || e.href));
    const assets = [];
    for (const url of urls) { const r = await session.send('Page.getResourceContent', { frameId: frameTree.frame.id, url });
      assets.push({ url, sha256: sha(Buffer.from(r.content, r.base64Encoded ? 'base64' : 'utf8')) }); }
    await session.detach();
    assert.ok(assets.length >= 2);
    assert.equal(osWindows().length, 1);
    return { assets, windows: osWindows() };
  }, { required: true });

  await check('isolated validated synthetic import with exact count and no active sources', async () => {
    const start = await snapshot();
    for (const s of start.sources.filter((s) => s.enabled))
      await invoke(main, { op: 'source_update', sourceId: s.id, enabled: false });
    await until(async () => { try { await invoke(main, { op: 'refresh' }); return true; }
      catch (e) { if (String(e).includes('refresh is already running')) return false; throw e; } },
    'Startup native refresh did not drain', 180000);
    const backup = JSON.parse(await invoke(main, { op: 'export' }));
    for (const d of backup.documents) {
      if (d.kind === 'source') d.data.enabled = false;
      if (d.kind === 'provider') { d.data.enabled = false; d.data.consented = false; }
      if (d.kind === 'workspace' && d.id === 'default')
        d.data = { revision: d.data.revision, tabs: [{ id: 'home', title: 'Synthetic fixture headlines',
          topic: '', query: '', mode: 'all' }], activeTabId: 'home' };
    }
    const source = { id: 'v05-native-synthetic', name: 'SYNTHETIC TEST FIXTURE — not news',
      url: 'https://example.invalid/synthetic/feed', homepage: 'https://example.invalid/',
      termsUrl: 'https://example.invalid/synthetic', topics: ['science'], region: 'global', language: 'en',
      enabled: false, status: 'Synthetic offline fixture; never fetched', lastSuccess: null,
      storage: 'metadata', kind: 'reporting', aiAllowed: false, mediaAllowed: false };
    backup.documents.push({ kind: 'source', id: source.id, scope: '', data: source });
    const now = Math.floor(Date.now() / 1000);
    backup.articles = Array.from({ length: FIXTURE_COUNT }, (_, i) => ({ id: `v05-${String(i).padStart(3, '0')}`,
      sourceId: source.id, sourceName: source.name, title: `SYNTHETIC fixture report ${String(i).padStart(3, '0')} — not real news`,
      url: `https://example.invalid/synthetic/${i}`, excerpt: '', publishedAt: now - i * 60,
      firstSeen: now - i * 60, updatedAt: now - i * 60, topics: ['science'], region: 'global',
      language: 'en', kind: 'reporting', aiAllowed: false, read: false, saved: false, hidden: false,
      groupId: `v05-${String(i).padStart(3, '0')}`, reasons: [], score: 0, history: [] }));
    writeFileSync(`${base}-synthetic-backup.json`, JSON.stringify(backup, null, 2));
    await invoke(main, { op: 'import', data: JSON.stringify(backup) });
    const s = await snapshot();
    assert.equal(s.articles.length, FIXTURE_COUNT);
    assert.ok(s.articles.every((a) => a.title.startsWith('SYNTHETIC')));
    assert.ok(s.sources.every((x) => !x.enabled));
    await main.reload(); await ready(main);
    await expect(rows()).toHaveCount(FIXTURE_COUNT);
    await shot('imported');
    return { count: s.articles.length, replacementTokenPresent: !!s.replacementToken };
  }, { required: true });

  // --- 0.5: bulk triage, through the real host -----------------------
  await check('bulk triage writes through article_state_many and the real host', async () => {
    const before = await snapshot();
    const targets = before.articles.slice(0, 2);
    const cb = rows().getByRole('checkbox', { name: /^Select / });
    await expect(cb.first()).toBeVisible();
    // Select the first two rows through the real UI, then apply.
    const boxes = await cb.all();
    for (const b of boxes.slice(0, 2)) await b.click();
    await expect(main.getByRole('region', { name: 'Bulk actions' })).toBeVisible();
    await expect(main.getByRole('region', { name: 'Bulk actions' })).toContainText('2 selected');
    await main.getByRole('region', { name: 'Bulk actions' }).getByRole('button', { name: 'Save', exact: true }).click();
    await until(async () => { const s = await snapshot();
      return targets.every((t) => s.articles.find((a) => a.id === t.id)?.saved === true); },
    'Host did not record saved flags for both rows', 15000);
    const after = await snapshot();
    const result = targets.map((t) => ({ id: t.id, ...state(after.articles.find((a) => a.id === t.id)) }));
    assert.ok(result.every((r) => r.saved === true), 'bulk save did not reach the host');
    assert.ok(result.every((r) => r.hidden === false), 'bulk save must not change hidden');
    await shot('bulk-saved');
    return { targets: result };
  });

  await check('bulk hide applies to every selected row through the host', async () => {
    const before = await snapshot();
    const target = before.articles.find((a) => !a.hidden && a.saved);
    assert.ok(target, 'expected a saved row to hide');
    await main.getByRole('button', { name: 'Saved stories', exact: true }).click();
    await main.locator(`[data-article-id="${target.id}"] .triage-box`).click();
    await expect(main.getByRole('region', { name: 'Bulk actions' })).toContainText('1 selected');
    await main.getByRole('region', { name: 'Bulk actions' }).getByRole('button', { name: 'Hide', exact: true }).click();
    await until(async () => (await snapshot()).articles.find((a) => a.id === target.id)?.hidden === true,
      'Host did not record the bulk hide', 15000);
    const after = await snapshot();
    return { id: target.id, ...state(after.articles.find((a) => a.id === target.id)) };
  });

  // --- 0.5: keyboard shortcuts through the real window ---------------
  await check('X, M and Escape act on the real native window', async () => {
    // Return to the headline view first. The previous check leaves the window
    // on Saved stories, where the reading-status selector filters a different
    // collection entirely.
    await main.getByRole('button', { name: 'All headlines', exact: true }).click();
    await main.getByLabel('Reading status', { exact: true }).selectOption('all');
    // Pick a story that is actually on screen. Earlier checks hide and read
    // rows, so assuming articles[0] is visible makes this check fail for a
    // reason that has nothing to do with the keyboard.
    const targetId = await main.locator('[data-article-id]').first().getAttribute('data-article-id');
    assert.ok(targetId, 'no visible story to act on');
    await main.locator(`[data-article-id="${targetId}"] .headline`).click();
    await main.locator('.list-heading h2').click();
    await main.keyboard.press('x');
    await until(async () => (await snapshot()).articles.find((a) => a.id === targetId)?.hidden === true,
      'X did not hide through the native host', 15000);
    await main.keyboard.press('Escape');
    await expect(main.locator('.detail h2')).toHaveText('Select a story');
    const s1 = await snapshot();
    const next = s1.articles.find((a) => !a.hidden);
    assert.ok(next, 'expected a visible story for the M check');
    await main.locator(`[data-article-id="${next.id}"] .headline`).click();
    await main.locator('.list-heading h2').click();
    // Read the flag AFTER the click. Selecting a story marks it read, so a
    // value captured beforehand would be stale and the assertion would be
    // checking the wrong transition.
    const wasRead = (await snapshot()).articles.find((a) => a.id === next.id).read;
    await main.keyboard.press('m');
    await until(async () => (await snapshot()).articles.find((a) => a.id === next.id)?.read === !wasRead,
      'M did not toggle read through the native host', 15000);
    await shot('keyboard-shortcuts');
    const s2 = await snapshot();
    return { hiddenByX: targetId, toggledByM: next.id, read: s2.articles.find((a) => a.id === next.id).read };
  });

  // --- 0.5: reading status filter through the real host --------------
  await check('reading status selector filters the native list', async () => {
    await main.getByLabel('Reading status', { exact: true }).selectOption('unread');
    const s = await snapshot();
    // The list never shows hidden rows, so the host-side expectation must
    // exclude them too. Comparing against every unread article counted hidden
    // ones and failed by exactly the number of hidden stories.
    const unread = s.articles.filter((a) => !a.read && !a.hidden).length;
    const shown = await rows().count();
    assert.equal(shown, unread, `unread filter showed ${shown} but the host has ${unread} visible unread`);
    await main.getByLabel('Reading status', { exact: true }).selectOption('read');
    // Re-snapshot rather than reusing the earlier one: the previous check
    // toggled a read flag, so a stale snapshot makes the host look wrong.
    const fresh = await snapshot();
    const read = fresh.articles.filter((a) => a.read && !a.hidden).length;
    assert.equal(await rows().count(), read, 'read filter disagreed with the host');
    await main.getByLabel('Reading status', { exact: true }).selectOption('all');
    assert.equal(await rows().count(), fresh.articles.filter((a) => !a.hidden).length);
    return { unread, read, total: s.articles.length };
  });

  // --- 0.5: alert receipts through the real host ---------------------
  await check('alert_receipts is profile-scoped and explicit through the real host', async () => {
    const context = await invoke(main, { op: 'window_context' });
    assert.equal(context.profileId, 'default');
    // An explicit profileId is required; the host must not default.
    await assert.rejects(() => invoke(main, { op: 'alert_receipts' }), /profile/i,
      'host accepted alert_receipts without a profileId');
    const receipts = await invoke(main, { op: 'alert_receipts', profileId: 'default', limit: 50 });
    assert.ok(Array.isArray(receipts), 'alert_receipts did not return an array');
    for (const r of receipts) {
      assert.equal(r.profileId, 'default', 'a receipt leaked from another profile');
      assert.ok('articleId' in r && 'at' in r, 'receipt shape is wrong');
      assert.ok(r.title === null || typeof r.title === 'string', 'receipt title must be a string or null');
    }
    // The limit is honoured, and the newest receipt sorts first.
    const limited = await invoke(main, { op: 'alert_receipts', profileId: 'default', limit: 1 });
    assert.ok(limited.length <= 1, 'alert_receipts ignored its limit');
    if (receipts.length > 1)
      assert.ok(receipts[0].at >= receipts[receipts.length - 1].at, 'receipts are not newest-first');
    return { count: receipts.length, emptyBecauseNoWatchlistAlertsFired: receipts.length === 0 };
  });

  await check('Alert history view renders from real receipts without a blank row', async () => {
    await main.getByRole('button', { name: 'Alert history', exact: true }).first().click();
    const receipts = await invoke(main, { op: 'alert_receipts', profileId: 'default', limit: 50 });
    // Record what the view actually shows. A mismatch here should say what was
    // on screen, not only that an expected string was missing.
    await until(async () => (await main.locator('.alert-history').count()) > 0, 'Alert history view never rendered');
    const rendered = await main.locator('.alert-history').innerText();
    if (receipts.length === 0) {
      assert.match(rendered, /No alerts delivered yet/, `empty view said: ${rendered.slice(0, 200)}`);
    } else {
      const shown = await main.getByTestId('alert-receipt').count();
      assert.equal(shown, receipts.length, 'view disagreed with the host receipt count');
    }
    await shot('alert-history');
    return { hostReceipts: receipts.length };
  });

  // Each settings-based check opens the dialog itself and closes it afterwards.
  // Leaving it open made the next check match two elements and fail for a
  // reason unrelated to what it was testing.
  async function withSettings(panelName, fn) {
    if (await main.getByRole('dialog').count()) { await main.keyboard.press('Escape'); await delay(200); }
    await main.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await main.getByRole('dialog').waitFor();
    await main.getByRole('button', { name: panelName, exact: true }).first().click();
    try { return await fn(); }
    finally { await main.keyboard.press('Escape').catch(() => {}); await delay(200); }
  }

  // --- 0.5: source search and cache disclosure -----------------------
  await check('source search and filter narrow the native directory', async () => {
    const result = await withSettings('Sources & health', async () => {
      const total = await main.locator('.source-row').count();
      assert.ok(total > 0, 'source directory was empty');
      await main.getByLabel('Search sources', { exact: true }).fill('synthetic');
      const narrowed = await main.locator('.source-row').count();
      assert.ok(narrowed < total, 'search did not narrow the directory');
      await expect(main.getByText('sources shown', { exact: false })).toContainText(`${narrowed} of ${total}`);
      await shot('source-search');
      return { total, narrowed };
    });
    return result;
  });

  await check('cache disclosure states the real retention policy and live counts', async () => {
    return await withSettings('Storage & retention', async () => {
      const dialog = main.getByRole('dialog');
      await expect(dialog).toContainText('30 days');
      await expect(dialog).toContainText('5,000');
      await expect(dialog).toContainText('90 days');
      await expect(dialog.getByText('Saved stories are never pruned.')).toBeVisible();
      const s = await snapshot();
      await expect(main.getByLabel('Cached reading data')).toContainText(`${s.articles.length} stories cached`);
      const saved = s.articles.filter((a) => a.saved).length;
      await expect(main.getByLabel('Cached reading data')).toContainText(`${saved} saved`);
      await shot('cache-disclosure');
      return { cached: s.articles.length, saved, unread: s.articles.filter((a) => !a.read).length };
    });
  });

  const passed = evidence.checks.filter((c) => c.passed).length;
  const failed = evidence.checks.filter((c) => !c.passed).length;
  evidence.summary = { checks: evidence.checks.length, passed, failed };
  evidence.passed = failed === 0;
  evidence.pageErrorCount = evidence.pageErrors.length;
  evidence.consoleErrorCount = evidence.consoleErrors.length;
  save();
  console.log(JSON.stringify({ evidence: `${base}.json`, passed: evidence.passed, summary: evidence.summary,
    pageErrors: evidence.pageErrors, consoleErrors: evidence.consoleErrors }, null, 2));
  if (failed) process.exitCode = 1;
} catch (error) {
  evidence.fatalError = String(error).slice(0, 2000);
  save();
  console.log(JSON.stringify({ evidence: `${base}.json`, passed: false,
    summary: { checks: evidence.checks.length, passed: evidence.checks.filter((c) => c.passed).length,
      failed: evidence.checks.filter((c) => !c.passed).length },
    failures: evidence.checks.filter((c) => !c.passed).map((c) => ({ name: c.name, error: c.error })),
    fatalError: evidence.fatalError }, null, 2));
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } catch {}
  if (app && app.exitCode === null) {
    const r = spawnSync('taskkill.exe', ['/PID', String(app.pid), '/T', '/F'], { encoding: 'utf8' });
    evidence.cleanup = { pid: app.pid, status: r.status };
    save();
  }
}
