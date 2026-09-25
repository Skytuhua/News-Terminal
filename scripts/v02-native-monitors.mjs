// Windows-only, real WebView2/native monitor acceptance. No fixture IPC or display changes.
// Build (Git Bash, embedded dist without dev server):
// TAURI_CONFIG='{"build":{"devUrl":null}}' cargo build --manifest-path src-tauri/Cargo.toml --features tauri/custom-protocol
// Run: node scripts/v02-native-monitors.mjs [alternate-executable] [evidence-prefix]
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const executable = resolve(process.argv[2] || 'src-tauri/target/debug/news-terminal.exe');
const prefix = process.argv[3] || 'v02-native-monitors';
assert.match(prefix, /^v02-native-monitors[\w-]*$/, 'Evidence prefix must stay inside the owned v02-native-monitors namespace');
const evidenceDirectory = resolve('docs/evidence');
mkdirSync(evidenceDirectory, { recursive: true });
const dataDirectory = mkdtempSync(join(tmpdir(), 'news-terminal-v02-monitors-'));
const evidence = { executable, dataDirectory, startedAt: new Date().toISOString(), checks: [], limitations: [], launches: [] };
const evidencePath = join(evidenceDirectory, `${prefix}.json`);
let app, browser, port;
const delay = ms => new Promise(r => setTimeout(r, ms));
const persist = () => writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
const errorText = e => String(e?.stack || e);
async function check(name, fn) {
  const entry = { name, startedAt: new Date().toISOString() };
  evidence.checks.push(entry);
  try { entry.details = await fn(); entry.passed = true; }
  catch (e) { entry.passed = false; entry.error = errorText(e); console.error(`FAIL ${name}: ${e}`); }
  persist();
  return entry;
}
async function invoke(page, request) {
  return page.evaluate(request => window.__TAURI_INTERNALS__.invoke('dispatch', { request }), request);
}
async function plugin(page, command, args = {}) {
  return page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(`plugin:window|${command}`, args), { command, args });
}
async function freePort() {
  return new Promise((done, reject) => { const s = createServer(); s.on('error', reject); s.listen(0, '127.0.0.1', () => { const n = s.address().port; s.close(() => done(n)); }); });
}
async function findPage(predicate, timeout = 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (const context of browser.contexts()) for (const page of context.pages()) {
      try { if (await predicate(await invoke(page, { op: 'window_context' }))) return page; } catch { /* initializing */ }
    }
    await delay(200);
  }
  const diagnostics = [];
  for (const context of browser.contexts()) for (const page of context.pages()) {
    let result;
    try { result = await invoke(page, { op: 'window_context' }); } catch (e) { result = String(e); }
    diagnostics.push({ url: page.url(), title: await page.title().catch(String), result, body: await page.locator('body').innerText().catch(String) });
  }
  evidence.targetDiagnostics = diagnostics;
  throw new Error(`Expected native WebView2 target did not become ready: ${JSON.stringify(diagnostics)}`);
}
async function launch() {
  port = await freePort();
  const run = { port, startedAt: new Date().toISOString(), stderr: '' };
  evidence.launches.push(run);
  app = spawn(executable, [], { env: { ...process.env, NEWS_TERMINAL_DATA_DIR: dataDirectory, NEWS_TERMINAL_CDP_PORT: String(port), NEWS_TERMINAL_WEBVIEW_DATA_DIR: join(dataDirectory, 'webview') }, stdio: 'pipe' });
  run.pid = app.pid;
  app.stderr.on('data', b => { run.stderr = (run.stderr + b).slice(-8000); });
  app.stdout.on('data', () => {});
  const end = Date.now() + 45000;
  while (Date.now() < end) {
    if (app.exitCode !== null) throw new Error(`Executable exited ${app.exitCode}: ${run.stderr}`);
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }); break; } catch { await delay(250); }
  }
  assert.ok(browser, 'Native debugging endpoint unavailable');
  browser.on('disconnected', () => {});
  const main = await findPage(c => c.label === 'main');
  await main.getByRole('tablist', { name: 'Workspace tabs' }).waitFor({ timeout: 30000 });
  run.url = main.url();
  assert.ok(!main.url().includes('fixture'), 'Fixture route is not real native evidence');
  persist();
  return main;
}
async function terminate(graceful = false) {
  const stopped = { pid: app?.pid, requestedGraceful: graceful, forceKilled: false };
  if (app?.pid && app.exitCode === null) {
    if (graceful) {
      try { osProbe({ action: 'close' }); } catch { /* fall through to owned tree cleanup */ }
      for (let i = 0; i < 40 && app.exitCode === null; i++) await delay(100);
    }
    if (app.exitCode === null) {
      stopped.forceKilled = true;
      try { execFileSync('taskkill.exe', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already exited */ }
    }
  }
  if (stopped.pid) {
    stopped.exitCode = app.exitCode;
    evidence.launches.at(-1).termination = stopped;
  }
  app = null;
  // The endpoint belongs only to our isolated subprocess, already stopped above.
  if (browser) { try { await browser.close(); } catch { /* target gone */ } }
  browser = null;
  await delay(300);
}

// Independent Win32 physical geometry: DPI-aware GetMonitorInfo/GetWindowRect,
// GetClientRect, DWM visible-frame bounds, and GetDpiForWindow. No screen emulation.
const osPython = String.raw`
import ctypes as c, ctypes.wintypes as w, json, sys
u=c.windll.user32; d=c.windll.dwmapi; sh=c.windll.shcore
u.SetThreadDpiAwarenessContext.argtypes=[c.c_void_p]
u.SetThreadDpiAwarenessContext.restype=c.c_void_p
u.SetThreadDpiAwarenessContext(c.c_void_p(-4))
class R(c.Structure): _fields_=[('left',w.LONG),('top',w.LONG),('right',w.LONG),('bottom',w.LONG)]
class MI(c.Structure): _fields_=[('cbSize',w.DWORD),('monitor',R),('work',R),('flags',w.DWORD),('device',w.WCHAR*32)]
def rect(r): return dict(x=r.left,y=r.top,width=r.right-r.left,height=r.bottom-r.top)
u.GetWindowRect.argtypes=[w.HWND,c.POINTER(R)]; u.GetClientRect.argtypes=[w.HWND,c.POINTER(R)]
u.GetWindowThreadProcessId.argtypes=[w.HWND,c.POINTER(w.DWORD)]
u.GetWindowTextW.argtypes=[w.HWND,w.LPWSTR,c.c_int]
u.IsWindowVisible.argtypes=[w.HWND]; u.IsZoomed.argtypes=[w.HWND]; u.IsIconic.argtypes=[w.HWND]
u.GetDpiForWindow.argtypes=[w.HWND]; u.GetDpiForWindow.restype=w.UINT
u.ShowWindow.argtypes=[w.HWND,c.c_int]; u.PostMessageW.argtypes=[w.HWND,w.UINT,w.WPARAM,w.LPARAM]
u.GetMonitorInfoW.argtypes=[w.HMONITOR,c.POINTER(MI)]
sh.GetScaleFactorForMonitor.argtypes=[w.HMONITOR,c.POINTER(c.c_int)]
d.DwmGetWindowAttribute.argtypes=[w.HWND,w.DWORD,c.c_void_p,w.DWORD]
args=json.loads(sys.argv[1]); monitors=[]; windows=[]
@c.WINFUNCTYPE(w.BOOL,w.HMONITOR,w.HDC,c.POINTER(R),w.LPARAM)
def monitor_cb(h,dc,r,p):
    info=MI(); info.cbSize=c.sizeof(info); u.GetMonitorInfoW(h,c.byref(info)); scale=c.c_int()
    result=sh.GetScaleFactorForMonitor(h,c.byref(scale))
    monitors.append(dict(name=info.device,monitor=rect(info.monitor),work=rect(info.work),primary=bool(info.flags&1),scaleFactor=scale.value/100 if result==0 else None))
    return True
u.EnumDisplayMonitors(None,None,monitor_cb,0)
@c.WINFUNCTYPE(w.BOOL,w.HWND,w.LPARAM)
def window_cb(h,p):
    pid=w.DWORD(); u.GetWindowThreadProcessId(h,c.byref(pid))
    if pid.value != args['pid'] or not u.IsWindowVisible(h): return True
    title=c.create_unicode_buffer(512); u.GetWindowTextW(h,title,512)
    if not title.value: return True
    outer=R(); inner=R(); visible=R()
    u.GetWindowRect(h,c.byref(outer)); u.GetClientRect(h,c.byref(inner))
    result=d.DwmGetWindowAttribute(h,9,c.byref(visible),c.sizeof(visible))
    windows.append(dict(hwnd=int(h),title=title.value,outer=rect(outer),inner=rect(inner),visibleFrame=rect(visible) if result==0 else None,dpi=u.GetDpiForWindow(h),maximized=bool(u.IsZoomed(h)),minimized=bool(u.IsIconic(h))))
    return True
u.EnumWindows(window_cb,0)
if args.get('action'):
    target=next((v for v in windows if v['hwnd']==args.get('hwnd')),None)
    if args['action']=='close':
        target=next((v for v in windows if v['title']=='News Terminal'),None)
        if target: u.PostMessageW(target['hwnd'],16,0,0)
    elif target: u.ShowWindow(target['hwnd'], {'minimize':6,'maximize':3,'restore':9}[args['action']])
    else: raise RuntimeError('Owned native window handle not found')
print(json.dumps(dict(monitors=monitors,windows=windows)))
`;
function osProbe(args = {}) {
  assert.ok(app?.pid, 'No owned application process');
  return JSON.parse(execFileSync(process.env.NATIVE_MONITOR_PYTHON || 'python', ['-c', osPython, JSON.stringify({ pid: app.pid, ...args })], { encoding: 'utf8', timeout: 15000 }));
}
async function measure(page) {
  const context = await invoke(page, { op: 'window_context' });
  const label = context.label;
  const position = await plugin(page, 'outer_position', { label });
  const outer = await plugin(page, 'outer_size', { label });
  const inner = await plugin(page, 'inner_size', { label });
  const scaleFactor = await plugin(page, 'scale_factor', { label });
  const maximized = await plugin(page, 'is_maximized', { label });
  const monitors = await invoke(page, { op: 'window_monitors' });
  const win32 = osProbe().windows.find(w => w.outer.x === position.x && w.outer.y === position.y && w.outer.width === outer.width && w.outer.height === outer.height);
  assert.ok(win32, `No independent Win32 window matches Tauri bounds for ${label}: ${JSON.stringify({ position, outer, os: osProbe() })}`);
  return { context, outer: { ...position, ...outer }, inner, scaleFactor, maximized, current: monitors.monitors.find(m => m.current)?.id, win32 };
}
const ownership = c => ({ label: c.label, profileId: c.profileId, tabId: c.tabId, detached: c.detached, detachedTabs: [...c.detachedTabs].sort((a, b) => String(a.tabId).localeCompare(String(b.tabId))) });
const stableGeometry = m => ({ outer: m.outer, inner: m.inner, scaleFactor: m.scaleFactor, maximized: m.maximized, current: m.current });
const inside = (b, a, epsilon = 0) => b.x >= a.x - epsilon && b.y >= a.y - epsilon && b.x + b.width <= a.x + a.width + epsilon && b.y + b.height <= a.y + a.height + epsilon;
function slot(m, layout) {
  const left = Math.floor(m.width / 2);
  return { x: m.x + (layout === 'right' ? left : 0), y: m.y, width: layout === 'full' ? m.width : layout === 'left' ? left : m.width - left, height: m.height };
}
async function screenshot(page, name) {
  const path = join(evidenceDirectory, `${prefix}-${name}.png`);
  await page.screenshot({ path, timeout: 15000 });
  return path;
}
async function openScreens(page) {
  if (!await page.getByRole('combobox', { name: 'Target monitor', exact: true }).isVisible()) await page.getByRole('button', { name: 'Screens', exact: true }).click();
  await page.getByRole('combobox', { name: 'Target monitor', exact: true }).waitFor();
}
async function closeScreens(page) {
  const close = page.getByRole('button', { name: /Close.*(settings|panel)|Close dialog/i });
  if (await close.count()) await close.first().click(); else await page.keyboard.press('Escape');
}
async function uiMove(page, monitor, layout) {
  await openScreens(page);
  await page.getByRole('combobox', { name: 'Target monitor', exact: true }).selectOption(monitor.id);
  await page.getByRole('combobox', { name: 'Window arrangement', exact: true }).selectOption(layout);
  await page.getByRole('button', { name: 'Move this window', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Move this window' && !b.disabled) && (document.querySelector('.form-error') || document.querySelector('.form-success')), undefined, { timeout: 20000 });
  const error = await page.locator('.form-error').allTextContents();
  return { error: error.join('\n') || null, success: await page.locator('.form-success').allTextContents() };
}
async function placement(page, other, monitor, layout, name, useUi = true, fromState) {
  return check(name, async () => {
    const before = await measure(page), otherBefore = await measure(other);
    const record = { monitor, layout, before, otherBefore, method: useUi ? 'Screens UI' : 'native dispatch', fromState };
    evidence.checks.at(-1).details = record;
    if (fromState) {
      osProbe({ action: fromState, hwnd: before.win32.hwnd });
      await delay(350);
      record.preMoveOs = osProbe();
      const state = record.preMoveOs.windows.find(w => w.hwnd === before.win32.hwnd);
      assert.ok(state?.[fromState === 'maximize' ? 'maximized' : 'minimized'], `Win32 did not establish ${fromState} precondition`);
    }
    let result;
    if (useUi) result = await uiMove(page, monitor, layout);
    else { try { await invoke(page, { op: 'window_move', monitorId: monitor.id, layout }); result = { error: null }; } catch (e) { result = { error: String(e) }; } }
    await delay(650);
    const after = await measure(page), otherAfter = await measure(other);
    Object.assign(record, { result, after, otherAfter, screenshot: await screenshot(page, name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()) });
    assert.deepEqual(stableGeometry(otherAfter), stableGeometry(otherBefore), 'Placement moved the other native window');
    assert.deepEqual(ownership(otherAfter.context), ownership(otherBefore.context), 'Placement changed other-window ownership');
    assert.deepEqual(ownership(after.context), ownership(before.context), 'Placement changed tab/profile ownership');
    const area = slot(monitor, layout);
    const certainlyTooSmall = area.width < Math.ceil(640 * monitor.scaleFactor) || area.height < Math.ceil(480 * monitor.scaleFactor);
    const currentFrame = { width: after.outer.width - after.inner.width, height: after.outer.height - after.inner.height };
    const frameTooSmall = area.width < Math.ceil(640 * monitor.scaleFactor) + currentFrame.width || area.height < Math.ceil(480 * monitor.scaleFactor) + currentFrame.height;
    if (result.error) {
      assert.ok(certainlyTooSmall || frameTooSmall, `Unexpected placement rejection: ${result.error}`);
      assert.deepEqual(stableGeometry(after), stableGeometry(before), 'Rejected too-small layout did not preserve previous bounds');
      record.expectedRejection = true;
      return record;
    }
    assert.ok(!certainlyTooSmall, 'Impossible split accepted');
    assert.equal(after.current, monitor.id, 'Wrong destination monitor');
    assert.equal(after.scaleFactor, monitor.scaleFactor, 'Destination DPI did not apply');
    assert.equal(after.win32.dpi / 96, monitor.scaleFactor, 'Win32 window DPI differs from destination');
    assert.ok(after.inner.width >= Math.ceil(640 * monitor.scaleFactor) && after.inner.height >= Math.ceil(480 * monitor.scaleFactor), 'Inner size below logical minimum');
    assert.equal(after.maximized, layout === 'full', 'Incorrect maximized state');
    assert.equal(after.win32.minimized, false, 'Window stayed minimized after placement');
    // Maximized GetWindowRect includes OS invisible resize borders outside the work area.
    // Report both rectangles; DWM visible frame must fit full, complete GetWindowRect must fit split.
    const checkedFrame = layout === 'full' ? after.win32.visibleFrame : after.outer;
    assert.ok(checkedFrame && inside(checkedFrame, area), `Frame overflows target slot: ${JSON.stringify({ checkedFrame, area, rawOuter: after.outer })}`);
    assert.deepEqual(checkedFrame, area, 'Window frame does not fill requested work-area slot exactly');
    if (layout !== 'full') { assert.equal(after.outer.x, area.x); assert.equal(after.outer.y, area.y); }
    record.checkedFrame = layout === 'full' ? 'DWM visible maximized frame (raw GetWindowRect also recorded)' : 'complete physical outer frame';
    return record;
  });
}
const windowFile = join(dataDirectory, 'workspace-windows.json');
try {
  assert.equal(process.platform, 'win32', 'This test requires real Windows displays');
  assert.ok(existsSync(executable), `Build executable first: ${executable}`);
  evidence.executableSha256 = createHash('sha256').update(readFileSync(executable)).digest('hex');
  let main = await launch();
  const native = await invoke(main, { op: 'window_monitors' });
  const os = osProbe();
  evidence.monitors = native.monitors;
  evidence.osMonitors = os.monitors;
  await check('physical monitor enumeration matches independent Win32', async () => {
    assert.ok(native.monitors.length);
    assert.equal(native.monitors.length, os.monitors.length);
    for (const m of native.monitors) {
      const actual = os.monitors.find(w => w.name === m.name);
      assert.ok(actual, `Native display not found by OS: ${m.name}`);
      assert.deepEqual({ x: m.x, y: m.y, width: m.width, height: m.height }, actual.work);
      assert.equal(m.scaleFactor, actual.scaleFactor);
    }
    return { native, os };
  });
  evidence.coverage = { negativeCoordinates: native.monitors.some(m => m.x < 0 || m.y < 0), abovePrimary: native.monitors.some(m => m.y < 0), physicalMixedDpi: new Set(native.monitors.map(m => m.scaleFactor)).size > 1 };
  for (const [key, covered] of Object.entries(evidence.coverage)) if (!covered) evidence.limitations.push(`${key}: not present in connected physical topology; no emulation substituted`);
  evidence.limitations.push('No physical hot-unplug/reorder performed. Unknown-ID rejection and off-screen saved-layout recovery are tested separately; neither establishes real hot-unplug behavior.');
  // All mutations remain in the new temporary application-data directory.
  let snap = await invoke(main, { op: 'snapshot', profileId: 'default' });
  for (const source of snap.sources.filter(s => s.enabled)) await invoke(main, { op: 'source_update', sourceId: source.id, enabled: false });
  const tab = { id: 'v02-native-monitor-tab', title: 'Native monitor acceptance', topic: '', query: '', mode: 'all' };
  await invoke(main, { op: 'workspace_save', profileId: 'default', replacementToken: snap.replacementToken, expectedRevision: snap.workspace.revision, workspace: { ...snap.workspace, tabs: [...snap.workspace.tabs, tab], activeTabId: tab.id } });
  await main.getByRole('button', { name: 'Detach tab', exact: true }).click();
  let detached = await findPage(c => c.detached && c.tabId === tab.id);
  await detached.getByRole('tablist', { name: 'Workspace tabs' }).waitFor();
  await check('actual detached native window and ownership', async () => ({ main: await measure(main), detached: await measure(detached) }));
  for (const [caller, page, other] of [['main', main, detached], ['detached', detached, main]]) {
    for (const [i, monitor] of native.monitors.entries()) {
      for (const layout of ['full', 'left', 'right']) await placement(page, other, monitor, layout, `${caller}-monitor-${i}-${layout}`);
    }
    const target = [...native.monitors].sort((a, b) => b.width / b.scaleFactor - a.width / a.scaleFactor)[0];
    await placement(page, other, target, 'left', `${caller}-from-maximized`, false, 'maximize');
    await placement(page, other, target, 'full', `${caller}-from-minimized`, false, 'minimize');
    await check(`${caller} rejects stale or unavailable monitor ID without moving`, async () => {
      const before = await measure(page);
      let rejection;
      try { await invoke(page, { op: 'window_move', monitorId: 'monitor-not-connected-v02-test', layout: 'left' }); } catch (e) { rejection = String(e); }
      assert.ok(rejection, 'Unavailable monitor ID accepted');
      assert.deepEqual(stableGeometry(await measure(page)), stableGeometry(before));
      return { rejection, before, after: await measure(page), note: 'Synthetic nonexistent ID, not a physical disconnect' };
    });
  }
  const usable = native.monitors.filter(m => m.width / 2 >= 640 * m.scaleFactor + 32 && m.height >= 480 * m.scaleFactor + 64);
  if (!evidence.checks.some(c => c.details?.expectedRejection)) evidence.limitations.push('No connected half-display was too small; impossible-split rollback needs smaller physical topology.');
  const mainMonitor = native.monitors[0], detachedMonitor = usable.find(m => m.id !== mainMonitor.id) || usable[0] || native.monitors.at(-1);
  await placement(main, detached, mainMonitor, 'full', 'restart-setup-main-full', false);
  await placement(detached, main, detachedMonitor, usable.length ? 'right' : 'full', 'restart-setup-detached', false);
  await closeScreens(main);
  const second = await invoke(main, { op: 'profile_create', name: 'Native monitor main profile' });
  await main.getByRole('combobox', { name: 'Reading profile', exact: true }).selectOption(second.id);
  await main.waitForFunction(async id => (await window.__TAURI_INTERNALS__.invoke('dispatch', { request: { op: 'window_context' } })).profileId === id, second.id);
  await delay(500);
  const beforeRestart = { main: await measure(main), detached: await measure(detached), savedLayout: JSON.parse(readFileSync(windowFile, 'utf8')) };
  evidence.beforeRestart = beforeRestart;
  await terminate(true);
  await check('main close exits owned application without forced termination', async () => {
    const termination = evidence.launches.at(-1).termination;
    assert.equal(termination.forceKilled, false, 'Main WM_CLOSE needed forced process termination');
    assert.equal(termination.exitCode, 0);
    return termination;
  });
  main = await launch();
  detached = await findPage(c => c.detached && c.tabId === tab.id);
  await detached.getByRole('tablist', { name: 'Workspace tabs' }).waitFor();
  await check('close/relaunch preserves measured bounds, maximization and UI profile/tab ownership', async () => {
    const after = { main: await measure(main), detached: await measure(detached), savedLayout: JSON.parse(readFileSync(windowFile, 'utf8')) };
    evidence.afterRestart = after;
    assert.deepEqual(stableGeometry(after.main), stableGeometry(beforeRestart.main), 'Main geometry changed on restart');
    assert.deepEqual(stableGeometry(after.detached), stableGeometry(beforeRestart.detached), 'Detached geometry changed on restart');
    assert.equal(after.main.context.profileId, second.id);
    assert.equal(await main.getByRole('combobox', { name: 'Reading profile', exact: true }).inputValue(), second.id);
    assert.equal(after.detached.context.profileId, 'default');
    assert.equal(after.detached.context.tabId, tab.id);
    return after;
  });
  await check('unmaximize after restart preserves normal restore bounds', async () => {
    const maximized = await measure(main);
    osProbe({ action: 'restore', hwnd: maximized.win32.hwnd });
    await delay(500);
    const actual = await measure(main), saved = beforeRestart.savedLayout.main;
    assert.equal(actual.maximized, false);
    assert.deepEqual(actual.outer, { x: saved.x, y: saved.y, width: saved.width + actual.outer.width - actual.inner.width, height: saved.height + actual.outer.height - actual.inner.height });
    return { saved, actual };
  });
  await terminate();
  const offscreen = JSON.parse(readFileSync(windowFile, 'utf8'));
  for (const p of [offscreen.main, ...Object.values(offscreen.windows)]) { p.x = 50000; p.y = 50000; p.maximized = false; }
  writeFileSync(windowFile, JSON.stringify(offscreen));
  main = await launch();
  detached = await findPage(c => c.detached && c.tabId === tab.id);
  await check('restart recovers both off-screen saved placements', async () => {
    const actual = { main: await measure(main), detached: await measure(detached) };
    for (const [name, m] of Object.entries(actual)) assert.ok(native.monitors.some(area => inside(m.outer, area)), `${name} restored outside connected work areas`);
    return { ...actual, note: 'Modified only isolated saved coordinates while owned app stopped; not hardware unplug.' };
  });
  await check('reattach closes real window and removes persisted ownership', async () => {
    await detached.getByRole('button', { name: /Reattach/i }).click();
    await detached.waitForEvent('close', { timeout: 10000 }).catch(() => assert.ok(detached.isClosed()));
    const context = await invoke(main, { op: 'window_context' });
    assert.ok(!context.detachedTabs.some(t => t.tabId === tab.id));
    const saved = JSON.parse(readFileSync(windowFile, 'utf8'));
    assert.ok(!Object.values(saved.windows).some(w => w.tabId === tab.id));
    return { context, saved };
  });
  await terminate(true);
  main = await launch();
  await check('reattached window does not resurrect after restart', async () => {
    const context = await invoke(main, { op: 'window_context' });
    assert.ok(!context.detachedTabs.some(t => t.tabId === tab.id));
    assert.equal(osProbe().windows.length, 1);
    return { context, os: osProbe(), screenshot: await screenshot(main, 'final-main') };
  });
  // Import a valid pre-profile backup, then prove temporary detached ownership is pruned.
  await check('import removing owning profile closes window and stays removed after restart', async () => {
    const backup = await invoke(main, { op: 'export' });
    const temporary = await invoke(main, { op: 'profile_create', name: 'Native monitor orphan acceptance' });
    const temporarySnap = await invoke(main, { op: 'snapshot', profileId: temporary.id });
    await invoke(main, { op: 'detach_tab', profileId: temporary.id, tabId: temporarySnap.workspace.tabs[0].id });
    const orphan = await findPage(c => c.detached && c.profileId === temporary.id);
    await invoke(main, { op: 'import', data: backup });
    for (let i = 0; i < 50 && !orphan.isClosed(); i++) await delay(100);
    assert.ok(orphan.isClosed(), 'Imported-away profile still owns a native window');
    const reconciled = await invoke(main, { op: 'window_context' });
    assert.ok(!reconciled.detachedTabs.some(t => t.profileId === temporary.id));
    await terminate(true); main = await launch();
    const restarted = await invoke(main, { op: 'window_context' });
    assert.ok(!restarted.detachedTabs.some(t => t.profileId === temporary.id));
    assert.equal(osProbe().windows.length, 1);
    return { reconciled, restarted };
  });
} catch (e) {
  evidence.fatalError = errorText(e);
  console.error(evidence.fatalError);
} finally {
  await terminate();
  evidence.finishedAt = new Date().toISOString();
  evidence.summary = { checks: evidence.checks.length, passed: evidence.checks.filter(c => c.passed).length, failed: evidence.checks.filter(c => !c.passed).length };
  evidence.passed = !evidence.fatalError && evidence.summary.failed === 0;
  persist();
  console.log(JSON.stringify({ evidencePath, summary: evidence.summary, passed: evidence.passed, fatalError: evidence.fatalError, coverage: evidence.coverage, limitations: evidence.limitations }, null, 2));
  if (!evidence.passed) process.exitCode = 1;
}
