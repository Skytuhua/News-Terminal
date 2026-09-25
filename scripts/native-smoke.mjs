// Real Windows/WebView2 smoke test. No fixture IPC, no production data directory.
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const executable = resolve(process.argv[2] || 'src-tauri/target/release/news-terminal.exe');
assert.ok(existsSync(executable), `Build the actual Windows executable first: ${executable}`);
const dataDirectory = mkdtempSync(join(tmpdir(), 'news-terminal-native-'));
const evidenceDirectory = resolve('docs/evidence');
mkdirSync(evidenceDirectory, { recursive: true });
const port = 9227;
const evidence = { executable, dataDirectory, checks: [], startedAt: new Date().toISOString() };
let app, browser;
const delay = ms => new Promise(r => setTimeout(r, ms));
function cdpBrowserArgs(port) {
  return `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`;
}
async function launch() {
  const started = performance.now();
  app = spawn(executable, [], { env: { ...process.env, NEWS_TERMINAL_DATA_DIR: dataDirectory, NEWS_TERMINAL_CDP_PORT: String(port), NEWS_TERMINAL_WEBVIEW_DATA_DIR: join(dataDirectory, 'webview'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: cdpBrowserArgs(port) }, stdio: 'pipe' });
  let stderr = '';
  app.stderr.on('data', b => { stderr += b.toString(); });
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (app.exitCode !== null) throw new Error(`App exited ${app.exitCode}: ${stderr.slice(-1000)}`);
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }); break; } catch { await delay(250); }
  }
  assert.ok(browser, 'Native WebView2 debugging endpoint did not start');
  let page;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const candidate of context.pages()) {
        try {
          await candidate.waitForFunction(() => Boolean(window.__TAURI_INTERNALS__?.invoke), { timeout: 1000 });
          const ctx = await invoke(candidate, { op: 'window_context' });
          if (ctx.label === 'main') { page = candidate; break; }
        } catch { /* Webview may still be initializing. */ }
      }
    }
    if (page) break;
    await delay(250);
  }
  assert.ok(page, 'Main native IPC page did not become ready');
  await page.getByRole('tablist', { name: 'Workspace tabs' }).waitFor({ timeout: 20000 });
  evidence.checks.push({ name: 'native launch to IPC+reader ready', milliseconds: Math.round(performance.now() - started) });
  return page;
}
async function invoke(page, request) {
  return page.evaluate(request => window.__TAURI_INTERNALS__.invoke('dispatch', { request }), request);
}
function terminate() {
  if (app?.pid && app.exitCode === null) {
    try { execFileSync('taskkill.exe', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already exited */ }
  }
  app = null;
  browser = null;
}
try {
  let page = await launch();
  let snapshot = await invoke(page, { op: 'snapshot', profileId: 'default' });
  assert.ok(snapshot.profiles.some(p => p.id === 'default'));
  assert.ok(snapshot.sources.length > 0, 'Real source catalog missing');
  let refreshed;
  const refreshDeadline = Date.now() + 120000;
  while (Date.now() < refreshDeadline) {
    try { refreshed = await invoke(page, { op: 'refresh' }); break; }
    catch (error) { if (!String(error).includes('refresh is already running')) throw error; await delay(500); }
  }
  assert.ok(refreshed, 'Startup refresh did not finish within two minutes');
  snapshot = await invoke(page, { op: 'snapshot', profileId: 'default' });
  assert.ok(snapshot.articles.length > 0, 'No actual live feed article fetched');
  evidence.checks.push({ name: 'native live feed refresh', result: refreshed, articles: snapshot.articles.length, sources: snapshot.sources.map(s => ({ id: s.id, status: s.status })) });
  const story = snapshot.articles[0];
  const showLatest = page.getByRole('button', { name: /new stor.*Show latest/ });
  if (await showLatest.isVisible()) await showLatest.click();
  await page.getByTestId('story-row').first().click();
  await page.getByRole('button', { name: /Open original/ }).waitFor({ state: 'visible' });
  await page.screenshot({ path: join(evidenceDirectory, 'native-reader.png') });
  evidence.checks.push({ name: 'real article visible and selectable in native UI', passed: true });
  const benchmarkStart = performance.now();
  for (let i = 0; i < 20; i++) await invoke(page, { op: 'search', profileId: 'default', query: 'science' });
  evidence.checks.push({ name: 'cached FTS IPC benchmark', iterations: 20, meanMilliseconds: (performance.now() - benchmarkStart) / 20, note: 'Small live cache, local test machine; not a universal latency guarantee.' });
  const beforeStress = await invoke(page, { op: 'snapshot', profileId: 'default' });
  const manyTabs = Array.from({ length: 49 }, (_, i) => ({ id: `stress-${i}`, title: `Desk ${i + 1}`, topic: '', query: '', mode: 'all' }));
  await invoke(page, { op: 'workspace_save', profileId: 'default', replacementToken: beforeStress.replacementToken, expectedRevision: beforeStress.workspace.revision, workspace: { ...beforeStress.workspace, tabs: [beforeStress.workspace.tabs[0], ...manyTabs] } });
  const afterStress = await invoke(page, { op: 'snapshot', profileId: 'default' });
  assert.equal(afterStress.workspace.tabs.length, 50);
  const ps = `$all=Get-CimInstance Win32_Process; $ids=@(${app.pid}); do {$next=@($all | Where-Object {$_.ParentProcessId -in $ids -and $_.ProcessId -notin $ids} | Select-Object -ExpandProperty ProcessId); $ids+=$next} while($next.Count -gt 0); @(Get-Process -Id $ids -ErrorAction SilentlyContinue | Select-Object ProcessName,Id,WorkingSet64,CPU) | ConvertTo-Json -Compress`;
  const processes = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }));
  evidence.checks.push({ name: '50 persisted tabs and process-tree working set', tabs: 50, workingSetBytes: processes.reduce((n, p) => n + p.WorkingSet64, 0), processes, note: 'Working sets may double-count shared pages; includes WebView2 and the smoke-test debug endpoint.' });
  await invoke(page, { op: 'workspace_save', profileId: 'default', replacementToken: afterStress.replacementToken, expectedRevision: afterStress.workspace.revision, workspace: { ...beforeStress.workspace, revision: afterStress.workspace.revision } });
  await invoke(page, { op: 'article_state', profileId: 'default', articleId: story.id, replacementToken: afterStress.replacementToken, saved: true, read: true });
  const second = await invoke(page, { op: 'profile_create', name: 'Native isolation check' });
  const isolated = await invoke(page, { op: 'snapshot', profileId: second.id });
  assert.equal(isolated.articles.find(a => a.id === story.id)?.saved, false);
  evidence.checks.push({ name: 'profile save/read isolation', passed: true });
  const found = await invoke(page, { op: 'search', profileId: 'default', query: story.title.split(/\s+/).find(s => s.length > 3) || story.title });
  assert.ok(Array.isArray(found), 'FTS search must return article list');
  snapshot = await invoke(page, { op: 'snapshot', profileId: 'default' });
  const tab = { id: 'native-smoke-tab', title: 'Native monitor check', topic: '', query: '', mode: 'all', selectedId: story.id };
  const workspace = { ...snapshot.workspace, tabs: [...snapshot.workspace.tabs, tab], activeTabId: tab.id };
  await invoke(page, { op: 'workspace_save', profileId: 'default', replacementToken: snapshot.replacementToken, expectedRevision: snapshot.workspace.revision, workspace });
  await invoke(page, { op: 'detach_tab', profileId: 'default', tabId: tab.id });
  let detached;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && !detached) {
    for (const context of browser.contexts()) for (const candidate of context.pages()) {
      try {
        const ctx = await invoke(candidate, { op: 'window_context' });
        if (ctx.detached && ctx.tabId === tab.id) detached = candidate;
      } catch { /* native target initializing */ }
    }
    if (!detached) await delay(200);
  }
  assert.ok(detached, 'Detach did not create real native webview target');
  await detached.waitForSelector('main', { timeout: 20000 });
  await detached.screenshot({ path: join(evidenceDirectory, 'native-detached.png') });
  await page.screenshot({ path: join(evidenceDirectory, 'native-main.png') });
  evidence.checks.push({ name: 'real native detached target', passed: true });
  for (const context of browser.contexts()) await context.setOffline(true);
  snapshot = await invoke(page, { op: 'snapshot', profileId: 'default' });
  assert.ok(snapshot.articles.find(a => a.id === story.id)?.saved, 'Saved story lost offline');
  evidence.checks.push({ name: 'offline cached snapshot', passed: true, note: 'Browser offline does not disable Rust network; no refresh invoked here.' });
  for (const source of snapshot.sources.filter(s => s.enabled)) {
    await invoke(page, { op: 'source_update', sourceId: source.id, enabled: false });
  }
  const failedSource = await invoke(page, { op: 'source_add', name: 'Unavailable smoke source', url: 'https://news-terminal-smoke.invalid/feed', homepage: 'https://news-terminal-smoke.invalid', termsUrl: 'https://news-terminal-smoke.invalid/terms', topics: [], region: 'world', language: 'en', kind: 'reporting', storage: 'metadata' });
  const failedRefresh = await invoke(page, { op: 'refresh' });
  assert.equal(failedRefresh.failed, 1, 'Unavailable source must report failure');
  snapshot = await invoke(page, { op: 'snapshot', profileId: 'default' });
  assert.ok(snapshot.articles.find(a => a.id === story.id)?.saved, 'Source failure erased saved content');
  await invoke(page, { op: 'source_update', sourceId: failedSource.id, enabled: false });
  evidence.checks.push({ name: 'failed source preserves cache; all sources disabled before restart', passed: true });
  await invoke(page, { op: 'watchlist_save', profileId: second.id, watchlist: { name: 'Native notification check', keywords: [story.title], topics: [], sources: [story.sourceId], alerts: true } });
  await invoke(page, { op: 'profile_update', profileId: second.id, alertsEnabled: true, quietHours: { enabled: true, start: '00:00', end: '00:00' } });
  await invoke(page, { op: 'refresh' });
  const quietBackup = JSON.parse(await invoke(page, { op: 'export' }));
  assert.equal(quietBackup.alerts.filter(a => a.profileId === second.id).length, 0, 'Quiet hours leaked a native notification');
  await invoke(page, { op: 'profile_update', profileId: second.id, quietHours: { enabled: false, start: '00:00', end: '00:00' } });
  await invoke(page, { op: 'refresh' });
  const notificationBackup = JSON.parse(await invoke(page, { op: 'export' }));
  const delivered = notificationBackup.alerts.filter(a => a.profileId === second.id).length;
  await invoke(page, { op: 'refresh' });
  const dedupBackup = JSON.parse(await invoke(page, { op: 'export' }));
  assert.equal(dedupBackup.alerts.filter(a => a.profileId === second.id).length, delivered);
  await invoke(page, { op: 'profile_update', profileId: second.id, alertsEnabled: false });
  evidence.checks.push({ name: 'native quiet-hours and notification delivery/dedup path', quietHoursSuppressed: true, successfulWindowsApiReceipts: delivered, dedupPassed: true, note: delivered ? 'Windows API accepted delivery; visible banner not independently observed.' : 'No successful OS receipt; notifications may be unavailable on this Windows configuration.' });
  await page.getByRole('combobox', { name: 'Reading profile' }).selectOption(second.id);
  await page.waitForFunction(async id => (await window.__TAURI_INTERNALS__.invoke('dispatch', { request: { op: 'window_context' } })).profileId === id, second.id);
  assert.equal((await invoke(page, { op: 'window_context' })).profileId, second.id);
  terminate();
  const windowFile = join(dataDirectory, 'workspace-windows.json');
  const savedLayout = JSON.parse(readFileSync(windowFile, 'utf8'));
  for (const placement of [savedLayout.main, ...Object.values(savedLayout.windows)]) {
    placement.x = 50000; placement.y = 50000;
  }
  writeFileSync(windowFile, JSON.stringify(savedLayout));
  page = await launch();
  const restoredPosition = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|outer_position', { label: 'main' }));
  assert.ok(restoredPosition.x < 50000 && restoredPosition.y < 50000, 'Missing-monitor layout did not recover');
  evidence.checks.push({ name: 'actual native missing-monitor position recovery', passed: true, position: restoredPosition });
  snapshot = await invoke(page, { op: 'snapshot', profileId: 'default' });
  assert.ok(snapshot.articles.find(a => a.id === story.id)?.saved, 'Saved story lost after process restart');
  const context = await invoke(page, { op: 'window_context' });
  assert.ok(context.detachedTabs.some(t => t.tabId === tab.id), 'Detached layout lost after restart');
  assert.equal(context.profileId, second.id, 'Main profile lost after restart');
  assert.equal(await page.getByRole('combobox', { name: 'Reading profile' }).inputValue(), second.id, 'Reader UI failed to restore the selected profile');
  evidence.checks.push({ name: 'main-window profile persists across process restart', passed: true });
  await invoke(page, { op: 'reattach_tab', profileId: 'default', tabId: tab.id });
  const reattached = await invoke(page, { op: 'window_context' });
  assert.ok(!reattached.detachedTabs.some(t => t.tabId === tab.id));
  evidence.checks.push({ name: 'crash/restart persistence and reattach', passed: true });
  await assert.rejects(invoke(page, { op: 'open_original', url: 'javascript:alert(1)' }));
  await assert.rejects(invoke(page, { op: 'summarize', profileId: 'default', articleId: story.id, requestId: 'no-consented-provider' }));
  evidence.checks.push({ name: 'unsafe opener and unconfigured AI fail safely', passed: true });
  const backup = await invoke(page, { op: 'export' });
  assert.equal(typeof backup, 'string');
  await assert.rejects(invoke(page, { op: 'import', data: '{broken' }));
  const after = await invoke(page, { op: 'snapshot', profileId: 'default' });
  assert.ok(after.articles.find(a => a.id === story.id)?.saved);
  evidence.checks.push({ name: 'backup export and rejected import preserves data', passed: true });
  const temporaryProfile = await invoke(page, { op: 'profile_create', name: 'Import orphan regression' });
  const temporarySnapshot = await invoke(page, { op: 'snapshot', profileId: temporaryProfile.id });
  await invoke(page, { op: 'window_set_profile', profileId: temporaryProfile.id });
  await invoke(page, { op: 'detach_tab', profileId: temporaryProfile.id, tabId: temporarySnapshot.workspace.tabs[0].id });
  const orphanContext = await invoke(page, { op: 'window_context' });
  const orphan = orphanContext.detachedTabs.find(t => t.profileId === temporaryProfile.id);
  assert.ok(orphan, 'Regression setup did not detach the temporary profile');
  await invoke(page, { op: 'import', data: backup });
  const reconciled = await invoke(page, { op: 'window_context' });
  assert.equal(reconciled.profileId, 'default', 'Import left main window owned by deleted profile');
  assert.ok(!reconciled.detachedTabs.some(t => t.profileId === temporaryProfile.id), 'Import retained orphan detached ownership');
  terminate();
  page = await launch();
  const afterImportRestart = await invoke(page, { op: 'window_context' });
  assert.equal(afterImportRestart.profileId, 'default');
  assert.ok(!afterImportRestart.detachedTabs.some(t => t.profileId === temporaryProfile.id), 'Restart resurrected orphan window');
  await assert.rejects(invoke(page, { op: 'window_set_profile', profileId: temporaryProfile.id }));
  evidence.checks.push({ name: 'import prunes orphan windows and profile ownership durably', passed: true });
  const monitors = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|available_monitors'));
  evidence.checks.push({ name: 'actual connected monitor configuration', monitors });
  for (const monitor of monitors) {
    terminate();
    const layout = JSON.parse(readFileSync(windowFile, 'utf8'));
    const area = monitor.workArea || { position: monitor.position, size: monitor.size };
    layout.main.x = area.position.x + 20;
    layout.main.y = area.position.y + 20;
    layout.main.width = Math.min(1200, area.size.width - 40);
    layout.main.height = Math.min(800, area.size.height - 40);
    layout.main.maximized = false;
    writeFileSync(windowFile, JSON.stringify(layout));
    page = await launch();
    const location = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|outer_position', { label: 'main' }));
    assert.ok(location.x >= area.position.x && location.x < area.position.x + area.size.width);
    assert.ok(location.y >= area.position.y && location.y < area.position.y + area.size.height);
    await page.screenshot({ path: join(evidenceDirectory, `native-monitor-${monitors.indexOf(monitor)}.png`) });
    evidence.checks.push({ name: 'native restore on physical monitor', monitor: monitor.name, scaleFactor: monitor.scaleFactor, location, passed: true });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 720, height: 500, deviceScaleFactor: 2, mobile: false });
  await page.getByRole('tablist', { name: 'Workspace tabs' }).waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false, 'Reader overflows at simulated 200% scaling');
  await page.screenshot({ path: join(evidenceDirectory, 'native-simulated-200-percent.png') });
  evidence.checks.push({ name: 'simulated 200% scaling and reduced-motion layout', passed: true, note: 'WebView CDP emulation, not a change to Windows display settings.' });
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  const idleSample = () => {
    const script = `$all=Get-CimInstance Win32_Process; $ids=@(${app.pid}); do {$next=@($all | Where-Object {$_.ParentProcessId -in $ids -and $_.ProcessId -notin $ids} | Select-Object -ExpandProperty ProcessId); $ids+=$next} while($next.Count -gt 0); @{processes=@(Get-Process -Id $ids -ErrorAction SilentlyContinue | Select-Object ProcessName,Id,CPU,PrivateMemorySize64,WorkingSet64); connections=@(Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object {$_.OwningProcess -in $ids} | Select-Object LocalAddress,RemoteAddress,RemotePort,State)} | ConvertTo-Json -Compress -Depth 4`;
    return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }));
  };
  const beforeIdle = idleSample();
  const idleStart = performance.now();
  await delay(5000);
  const afterIdle = idleSample();
  const idleSeconds = (performance.now() - idleStart) / 1000;
  const cpuDelta = afterIdle.processes.reduce((n,p) => n + (p.CPU || 0),0) - beforeIdle.processes.reduce((n,p) => n + (p.CPU || 0),0);
  evidence.checks.push({ name: 'idle process-tree sample with sources disabled', seconds: idleSeconds, cpuSeconds: cpuDelta, singleCorePercent: cpuDelta / idleSeconds * 100, privateBytes: afterIdle.processes.reduce((n,p) => n + p.PrivateMemorySize64,0), connections: afterIdle.connections.map(c => ({ destination: ['127.0.0.1', '::1'].includes(c.RemoteAddress) ? 'loopback' : ['0.0.0.0', '::'].includes(c.RemoteAddress) ? 'unspecified' : 'external', remotePort: c.RemotePort, state: c.State })), note: 'Short local baseline with debug connection; socket inventory is not a packet-capture proof of zero network bytes.' });
  evidence.passed = true;
} catch (error) {
  evidence.passed = false;
  evidence.error = String(error);
  process.exitCode = 1;
} finally {
  terminate();
  evidence.finishedAt = new Date().toISOString();
  writeFileSync(join(evidenceDirectory, 'native-smoke.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
