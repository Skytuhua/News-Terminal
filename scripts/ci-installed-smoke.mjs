// Executes setup only on a disposable GitHub-hosted Windows job. See the
// acceptance document for the existing-runtime and isolated-WebView limits.
import assert from 'node:assert/strict';
import { win32, join, resolve } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { appendFileSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { disconnectNativeBrowser, ownedNativeWindows, releaseFailedChildHandles, runNativeCommand,
  stopOwnedProcess } from './native-process-cleanup.mjs';

const CHECKS = ['source and payload binding', 'fresh disposable user state', 'installed payload and registration',
  'first-run defaults and usable UI', 'graceful installed-app shutdown', 'uninstall preserves application data', 'final source binding'];

export async function runInstalledSteps(report, operations, changed = () => {}) {
  report.passed = false;
  report.checks = [];
  try {
    for (const name of CHECKS) {
      const check = { name, passed: false, startedAt: new Date().toISOString() };
      report.checks.push(check);
      changed();
      try { check.details = await operations[name](); check.passed = true; }
      catch (error) { check.error = String(error.stack || error).slice(-6000); throw error; }
      finally { check.finishedAt = new Date().toISOString(); changed(); }
    }
  } catch (error) { report.fatal = String(error.stack || error).slice(-6000); }
  finally {
    report.cleanupStartedAt = new Date().toISOString();
    try { report.cleanup = await operations.cleanup(); }
    catch (error) { report.cleanupError = String(error.stack || error).slice(-6000); }
    report.cleanupFinishedAt = new Date().toISOString();
  }
  const status = finalizeInstalledEvidence(report);
  changed();
  return status;
}

const samePath = (a, b) => typeof a === 'string' && win32.resolve(a).toLowerCase() === win32.resolve(b).toLowerCase();
export function assertInstalledState(state, directory, version) {
  assert.equal(state.applicationExists, true);
  assert.equal(state.installDirectoryExists, true);
  assert.deepEqual(state.sameNameProcesses, [], 'NSIS must not encounter a same-name process');
  const registration = state.registration;
  assert.equal(registration?.exists, true);
  assert.equal(registration.displayName, 'News Terminal');
  assert.equal(registration.publisher, 'newsterminal');
  assert.equal(registration.version, version);
  assert.equal(registration.mainBinaryName, 'news-terminal.exe');
  assert.equal(registration.installLocation, '"' + directory + '"');
  assert.equal(registration.uninstallString, '"' + win32.join(directory, 'uninstall.exe') + '"');
  assert.ok(samePath(state.manufacturerLocation, directory), 'Incorrect retained install location');
  assert.equal(state.shortcuts?.length, 4);
  for (const [index, shortcut] of state.shortcuts.entries()) {
    assert.equal(shortcut.exists, index < 2, 'Expected only current-user Start menu and desktop shortcuts');
    if (shortcut.exists) {
      assert.ok(samePath(shortcut.target, win32.join(directory, 'news-terminal.exe')), 'Shortcut targets a different application');
      assert.equal(shortcut.arguments, '', 'Unexpected shortcut arguments');
    }
  }
}

export function assertUninstalledState(state, directory) {
  assert.equal(state.applicationExists, false);
  assert.equal(state.installDirectoryExists, false, 'Uninstaller must remove the installed files and directory');
  assert.equal(state.registration?.exists, false, 'Add/Remove Programs registration remains');
  assert.deepEqual(state.sameNameProcesses, []);
  assert.equal(state.shortcuts?.length, 4);
  assert.ok(state.shortcuts.every(shortcut => shortcut.exists === false), 'An owned shortcut remains');
  assert.ok(samePath(state.manufacturerLocation, directory), 'Silent uninstall must preserve the install-location preference');
  assert.ok(Array.isArray(state.runtime) && state.runtime.length > 0, 'The shared WebView2 Runtime must remain installed');
}

export function assertFirstRunDefaults(snapshot, media) {
  assert.deepEqual(snapshot.profiles.map(profile => profile.id), ['default']);
  assert.equal(snapshot.profile.id, 'default');
  assert.equal(snapshot.profile.name, 'Global');
  assert.equal(snapshot.profile.alertsEnabled, false);
  assert.deepEqual(snapshot.profile.quietHours, { enabled: false, start: '22:00', end: '08:00' });
  assert.deepEqual(snapshot.profile.preferences, { topics: [], regions: [], languages: ['en'], sources: [],
    keywords: [], excludeKeywords: [], diversityCap: 0.5 });
  assert.equal(snapshot.workspace.activeTabId, 'home');
  assert.equal(snapshot.workspace.tabs.length, 1);
  assert.deepEqual(snapshot.workspace.tabs[0], { id: 'home', title: 'AI', section: 'ai', topic: '', query: '', mode: 'all' });
  assert.deepEqual(snapshot.providers.map(provider => provider.id).sort(), ['gemini', 'groq', 'ollama']);
  assert.ok(snapshot.providers.every(provider => provider.enabled === false && provider.consented === false && provider.hasKey === false),
    'New application data must not enable AI, consent, or credentials');
  assert.deepEqual(snapshot.articles, [], 'A fresh blocked application must not show invented or fetched stories');
  assert.equal(media.automatic, false);
  assert.equal(media.mode, 'visual');
}

export function hostedContext(platform, architecture, env, root) {
  assert.ok(platform === 'win32' && architecture === 'x64' && env.GITHUB_ACTIONS === 'true'
    && env.RUNNER_ENVIRONMENT === 'github-hosted' && env.RUNNER_OS === 'Windows',
  'Installation acceptance requires a disposable GitHub-hosted Windows x64 job');
  assert.match(env.GITHUB_RUN_ID || '', /^\d+$/);
  assert.match(env.GITHUB_RUN_ATTEMPT || '', /^\d+$/);
  assert.match(env.GITHUB_SHA || '', /^[a-f0-9]{40}$/i);
  for (const key of ['RUNNER_TEMP', 'GITHUB_WORKSPACE', 'GITHUB_OUTPUT']) assert.ok(win32.isAbsolute(env[key] || ''), `Missing ${key}`);
  assert.equal(win32.resolve(root).toLowerCase(), win32.resolve(env.GITHUB_WORKSPACE).toLowerCase(), 'Requires the checked-out CI workspace');
  for (const key of Object.keys(env)) {
    assert.ok(!/^WEBVIEW2_/i.test(key) && !/^NEWS_TERMINAL_(DATA_DIR|WEBVIEW_DATA_DIR|CDP_PORT)$/i.test(key),
      `Inherited runtime/data override is unsupported: ${key}`);
  }
  const runDirectory = win32.join(env.RUNNER_TEMP, `NewsTerminal install ${env.GITHUB_RUN_ID} ${env.GITHUB_RUN_ATTEMPT}`);
  return { runDirectory, installDirectory: win32.join(runDirectory, 'News Terminal'),
    ruleName: `NewsTerminal-install-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}` };
}

export function assertFreshState(state) {
  assert.ok(Array.isArray(state.collisions) && state.collisions.length === 0, 'Refusing existing installation, registration, shortcuts, or application data');
  assert.ok(Array.isArray(state.sameNameProcesses) && state.sameNameProcesses.length === 0, 'Refusing existing same-name application processes');
  assert.ok(Array.isArray(state.runtime) && state.runtime.length > 0, 'This gate requires an existing WebView2 Runtime');
  assert.ok(state.interactive === true && Number.isInteger(state.sessionId) && state.sessionId > 0, 'Interactive Windows session is required');
}

export function nsisArguments(directory, uninstall) {
  assert.ok(win32.isAbsolute(directory) && !/["\r\n\0]/.test(directory), 'Invalid absolute NSIS directory');
  // Both NSIS switches consume the final raw remainder, including spaces.
  return ['/S', `${uninstall ? '_?=' : '/D='}${directory}`];
}

export function finalizeInstalledEvidence(report) {
  const commandPassed = command => command?.status === 0 && command.forced === false && !command.error;
  const stop = report.termination;
  const cleanup = report.cleanup;
  report.passed = !report.fatal && !report.cleanupError && !report.evidenceWriteError
    && Array.isArray(report.pageErrors) && report.pageErrors.length === 0
    && Array.isArray(report.consoleErrors) && report.consoleErrors.length === 0
    && Array.isArray(report.checks) && report.checks.length === CHECKS.length
    && report.checks.every((check, index) => check.name === CHECKS[index] && check.passed === true)
    && commandPassed(report.install) && commandPassed(report.uninstall)
    && stop?.passed === true && stop.appAliveAtStart === true && stop.forced === false && stop.forceKilled === false
    && stop.exitCode === 0 && stop.signalCode === null && !stop.error
    && cleanup?.passed === true && cleanup.ruleRemoved === true
    && Array.isArray(cleanup.stoppedProcessIds) && cleanup.stoppedProcessIds.length === 0
    && Array.isArray(cleanup.remainingProcessIds) && cleanup.remainingProcessIds.length === 0;
  report.finishedAt = new Date().toISOString();
  return report.passed ? 0 : 1;
}

const root = fileURLToPath(new URL('../', import.meta.url));
const stamp = () => new Date().toISOString();
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const alive = child => child && child.exitCode === null && child.signalCode === null;
const delay = ms => new Promise(done => setTimeout(done, ms));

export async function observeInstalledOperation(name, operation, milliseconds = 20000) {
  return await deadline(Promise.resolve().then(operation), milliseconds,
    name + ' did not complete within ' + milliseconds + 'ms');
}

export async function waitForInstalledState(fn, message, milliseconds = 20000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {
    const value = await observeInstalledOperation(message, fn, Math.max(1, end - Date.now()));
    if (value) return value;
    await delay(Math.max(0, Math.min(100, end - Date.now())));
  }
  throw Error(message);
}

function atomicJson(path, value) {
  const temporary = path + '.tmp';
  writeFileSync(temporary, JSON.stringify(value, null, 2), { flag: 'wx' });
  renameSync(temporary, path);
}

async function deadline(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(message)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

function jsonCommand(file, args) {
  // Valid JSON stays intact within a bounded buffer. Error diagnostics stay short.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH'));
  return new Promise((done, reject) => {
    execFile(file, args, { env, encoding: 'utf8', timeout: 30000, maxBuffer: 128 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(Error(file + ': ' + error.message + '; stdout=' + stdout.slice(-3000) + '; stderr=' + stderr.slice(-3000)));
      try { done(JSON.parse(stdout.replace(/^\uFEFF/, ''))); }
      catch (error) { reject(Error('Invalid helper JSON: ' + error + '; ' + stdout.slice(-3000))); }
    });
  });
}

const state = action => jsonCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-File',
  join(root, 'scripts/ci-installed-state.ps1'), '-Action', action]);

async function main() {
  // This precedes report creation, helper execution, or application state changes.
  const context = hostedContext(process.platform, process.arch, process.env, root);
  const { values } = parseArgs({ options: { cleanup: { type: 'boolean', default: false } } });
  if (values.cleanup) {
    const cleanup = await state('Cleanup');
    console.log(JSON.stringify(cleanup));
    return cleanup.passed === true ? 0 : 1;
  }
  const prefix = 'ci-installed-' + process.env.GITHUB_RUN_ID + '-' + process.env.GITHUB_RUN_ATTEMPT;
  const base = join(root, 'docs/evidence', prefix);
  assert.ok(!existsSync(base + '.json'), 'Refusing to overwrite prior installed-application evidence');
  mkdirSync(join(root, 'docs/evidence'), { recursive: true });
  const report = { startedAt: stamp(), passed: false, coverage: 'Existing WebView2 on a disposable hosted Windows x64 runner',
    checks: [], pageErrors: [], consoleErrors: [], screenshots: [], ...context, limitations: [
      'Executes the original inspected NSIS setup and the installed application in place. No fixture backup is imported.',
      'WebView2 must already be registered. Missing-runtime setup and a disconnected-machine installation are not exercised.',
      'The hosted runner normally has administrator privileges and UAC disabled. Standard-user installation is not established.',
      'NEWS_TERMINAL_DATA_DIR is absent. CDP uses an explicit isolated WebView profile, so its default profile location is not tested.',
      'The firewall rule covers the installed parent executable only, not WebView2 children or Edge Update services.',
      'Silent setup and uninstall are exercised. Setup completion-screen launch, Start menu activation, upgrade, and Delete app data UI are not exercised.',
      'Captured frontend diagnostics begin when CDP attaches. Bounded native stderr remains available for review.',
      'Preserved application data, the install-location preference, and the ownership journal remain until the disposable VM is discarded.',
    ] };
  const save = () => atomicJson(base + '.json', report);
  const saveEvent = () => { try { save(); } catch (error) { report.evidenceWriteError = String(error); } };
  save();
  const payloadPath = join(root, 'docs/evidence/ci-installer-payload.json');
  const bind = installed => jsonCommand('python', [join(root, 'scripts/ci-installed-payload.py'), '--payload', payloadPath,
    ...(installed ? ['--installed', context.installDirectory] : [])]);
  let owner, binding, preflight, app, browser, page;
  const ownerPath = join(context.runDirectory, 'owner.json');
  const saveOwner = () => atomicJson(ownerPath, owner);
  const application = join(context.installDirectory, 'news-terminal.exe');
  const installedUninstaller = join(context.installDirectory, 'uninstall.exe');
  const copiedUninstaller = join(context.runDirectory, 'owned-uninstall.exe');
  const webviewDirectory = join(context.runDirectory, 'webview');
  const invoke = request => observeInstalledOperation('Native ' + request.op,
    () => page.evaluate(request => window.__TAURI_INTERNALS__.invoke('dispatch', { request }), request));
  async function screenshot(label) {
    const path = base + '-' + label + '.png';
    await page.screenshot({ path, timeout: 15000 });
    report.screenshots.push(path);
    save();
  }
  async function nsis(kind, executable) {
    const expected = kind === 'install' ? binding.installerSha256 : binding.uninstallerSha256;
    assert.equal(sha(executable), expected, 'NSIS executable changed immediately before execution');
    const command = { path: executable, sha256: expected, args: nsisArguments(context.installDirectory, kind === 'uninstall'),
      startedAt: stamp(), status: null, forced: false, stdout: '', stderr: '' };
    report[kind] = command;
    const child = spawn(executable, command.args, { cwd: context.runDirectory, windowsVerbatimArguments: true,
      env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    command.pid = child.pid;
    const finished = new Promise(done => {
      child.on('error', error => { command.error = String(error); done(); });
      child.on('exit', (code, signal) => { command.status = code; command.signal = signal; command.exitObservedAt = stamp(); done(); });
    });
    child.stdout.on('data', bytes => { command.stdout = (command.stdout + bytes).slice(-12000); });
    child.stderr.on('data', bytes => { command.stderr = (command.stderr + bytes).slice(-12000); });
    owner.commandPid = child.pid || null;
    owner.commandKind = kind;
    try {
      saveOwner();
      await deadline(finished, 120000, kind + ' did not finish within 120000ms');
    } catch (error) {
      command.error = String(error);
      command.forced = true;
      command.forceAttemptedAt = stamp();
      if (child.pid && alive(child)) {
        command.taskkill = await runNativeCommand('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeout: 10000 });
        await deadline(finished, 10000, 'Owned NSIS command remained alive after force attempt').catch(error => {
          command.cleanupError = String(error);
        });
      }
    } finally {
      if (!alive(child)) { owner.commandPid = null; saveOwner(); }
      releaseFailedChildHandles(child);
      command.finishedAt = stamp();
      save();
    }
    assert.ok(command.status === 0 && command.forced === false && !command.error, 'NSIS command failed: ' + JSON.stringify(command));
    return command;
  }
  async function stopApplication() {
    if (!app) return;
    report.termination ??= await stopOwnedProcess(app, {
      requestClose: () => ownedNativeWindows(app.pid, { close: true, python: 'python' }), gracefulTimeout: 8000,
    });
    if (!alive(app)) { owner.appPid = null; saveOwner(); }
    save();
    assert.equal(report.termination.passed, true, report.termination.error || 'Installed application did not exit normally');
  }
  function dataHashes(required) {
    const files = {};
    for (const name of ['news-terminal.sqlite3', 'workspace-windows.json']) {
      const path = join(preflight.dataDirectory, name);
      if (required) assert.ok(existsSync(path) && statSync(path).isFile() && statSync(path).size > 0, 'Missing default application data: ' + name);
      if (existsSync(path)) files[name] = { sha256: sha(path), bytes: statSync(path).size };
    }
    return files;
  }
  async function uninstall(requiredData) {
    const before = await state('BeforeUninstall');
    report.beforeUninstallState = before;
    assertInstalledState(before, context.installDirectory, binding.version);
    const preserved = dataHashes(requiredData);
    report.preservedApplicationData = { directory: preflight.dataDirectory, files: preserved, byteIdenticalAfterUninstall: false };
    save();
    assert.equal(sha(installedUninstaller), binding.uninstallerSha256, 'Installed uninstaller changed');
    // The exact installed bytes run from the owned container. _?= prevents an
    // unobserved temporary relaunch and lets NSIS delete the installed original.
    copyFileSync(installedUninstaller, copiedUninstaller, constants.COPYFILE_EXCL);
    await nsis('uninstall', copiedUninstaller);
    const after = await state('Uninstalled');
    report.uninstalledState = after;
    assertUninstalledState(after, context.installDirectory);
    assert.deepEqual(dataHashes(requiredData), preserved, 'Uninstall changed preserved default application data');
    report.preservedApplicationData = { directory: preflight.dataDirectory, files: preserved, byteIdenticalAfterUninstall: true };
    return { ...report.preservedApplicationData, registrationRemoved: true, shortcutsRemoved: true,
      installedDirectoryRemoved: true, retainedManufacturerLocation: after.manufacturerLocation, runtimeAfter: after.runtime };
  }
  const operations = {
    'source and payload binding': async () => {
      binding = await bind(false);
      report.binding = binding;
      return { sourceHead: binding.sourceHead, sourceTree: binding.sourceTree, inputCount: binding.inputCount,
        inputMapSha256: binding.inputMapSha256, installerSha256: binding.installerSha256, packagedSha256: binding.packagedSha256 };
    },
    'fresh disposable user state': async () => {
      preflight = await state('Preflight');
      report.preflight = preflight;
      assertFreshState(preflight);
      assert.ok(samePath(preflight.installDirectory, context.installDirectory));
      mkdirSync(context.runDirectory);
      owner = { schemaVersion: 1, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
        sourceHead: binding.sourceHead, version: binding.version, runDirectory: context.runDirectory, preflightPassed: true,
        installerSha256: binding.installerSha256, applicationSha256: binding.packagedSha256,
        uninstallerSha256: binding.uninstallerSha256, appPid: null, commandPid: null, commandKind: null };
      saveOwner();
      report.ownershipJournal = ownerPath;
      save();
      // The always-running step may act only after this invocation acquired a
      // fresh run directory. A refused preflight must not adopt an older journal.
      appendFileSync(process.env.GITHUB_OUTPUT, 'ownership_created=true\n');
      return { existingRuntime: preflight.runtime, userSid: preflight.userSid, administrator: preflight.administrator,
        defaultDataDirectory: preflight.dataDirectory };
    },
    'installed payload and registration': async () => {
      assertFreshState(await state('BeforeInstall'));
      await nsis('install', binding.installer);
      const installed = await bind(true);
      report.installedPayload = { fileCount: installed.installedFileCount, fileMapSha256: installed.installedFileMapSha256 };
      const installedState = await state('Installed');
      report.installedState = installedState;
      assertInstalledState(installedState, context.installDirectory, binding.version);
      return { ...report.installedPayload, executable: application, executableSha256: sha(application), registration: installedState.registration };
    },
    'first-run defaults and usable UI': async () => {
      const { chromium, expect } = await import('@playwright/test');
      report.firewall = await state('Block');
      assert.equal(report.firewall.activeBeforeLaunch, true);
      assert.equal(sha(application), binding.packagedSha256, 'Installed executable changed before launch');
      mkdirSync(webviewDirectory);
      const port = await new Promise((done, reject) => {
        const server = createServer();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => done(port)); });
      });
      const env = { ...process.env, NEWS_TERMINAL_CDP_PORT: String(port), NEWS_TERMINAL_WEBVIEW_DATA_DIR: webviewDirectory };
      assert.ok(!Object.keys(env).some(key => key.toUpperCase() === 'NEWS_TERMINAL_DATA_DIR'));
      report.launch = { executable: application, sha256: sha(application), startedAt: stamp(), port,
        dataDirectoryOverride: null, webviewDirectory, stderr: '' };
      app = spawn(application, [], { cwd: context.installDirectory, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let launchError;
      app.on('error', error => { launchError = error; report.launch.error = String(error); saveEvent(); });
      app.on('exit', (code, signal) => { report.launch.appExit = { code, signal, at: stamp() }; saveEvent(); });
      app.stdout.on('data', () => {});
      app.stderr.on('data', bytes => { report.launch.stderr = (report.launch.stderr + bytes).slice(-12000); });
      owner.appPid = app.pid || null;
      report.launch.pid = app.pid;
      saveOwner();
      await waitForInstalledState(async () => {
        if (launchError) throw launchError;
        if (!alive(app)) throw Error('Installed application exited before CDP became ready');
        try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + port, { timeout: 1000 }); return true; }
        catch { return false; }
      }, 'Installed application CDP did not open', 45000);
      report.frontendObservationStartedAt = stamp();
      const observed = new WeakSet();
      const observe = candidate => {
        if (observed.has(candidate)) return;
        observed.add(candidate);
        candidate.on('pageerror', error => report.pageErrors.push(String(error)));
        candidate.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
      };
      for (const browserContext of browser.contexts()) {
        browserContext.on('page', observe);
        browserContext.pages().forEach(observe);
      }
      page = await waitForInstalledState(async () => {
        for (const browserContext of browser.contexts()) for (const candidate of browserContext.pages()) {
          const native = await observeInstalledOperation('Installed window context', () => candidate.evaluate(
            () => window.__TAURI_INTERNALS__.invoke('dispatch', { request: { op: 'window_context' } })).catch(() => null));
          if (native?.label === 'main') return candidate;
        }
        return null;
      }, 'Installed main window was not ready');
      page.setDefaultTimeout(20000);
      assert.match(page.url(), /^https?:\/\/tauri\.localhost(?:\/|$)/);
      await expect(page.getByRole('tablist', { name: 'Workspace tabs' })).toBeVisible();
      await expect(page.locator('#workspace-tab-home')).toHaveAttribute('aria-selected', 'true');
      const snapshot = await invoke({ op: 'snapshot', profileId: 'default' });
      const media = await invoke({ op: 'media_preferences', profileId: 'default' });
      report.firstRun = { profile: snapshot.profile, workspace: snapshot.workspace, providers: snapshot.providers,
        articleCount: snapshot.articles.length, sourceCount: snapshot.sources.length, media };
      assertFirstRunDefaults(snapshot, media);
      const windows = await ownedNativeWindows(app.pid);
      report.launch.windows = windows;
      assert.equal(windows.length, 1);
      assert.equal(windows[0].pid, app.pid);
      const session = await observeInstalledOperation('Open asset CDP session', () => page.context().newCDPSession(page));
      try {
        await observeInstalledOperation('Enable asset CDP session', () => session.send('Page.enable'));
        const { frameTree } = await observeInstalledOperation('Read embedded resource tree', () => session.send('Page.getResourceTree'));
        const urls = await observeInstalledOperation('Read embedded asset URLs', () => page.evaluate(
          () => [...document.querySelectorAll('script[src],link[rel="stylesheet"]')].map(item => item.src || item.href)));
        report.embeddedAssets = [];
        for (const url of urls) {
          const resource = await observeInstalledOperation('Read embedded asset content',
            () => session.send('Page.getResourceContent', { frameId: frameTree.frame.id, url }));
          const bytes = Buffer.from(resource.content, resource.base64Encoded ? 'base64' : 'utf8');
          report.embeddedAssets.push({ url, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
        }
        assert.ok(report.embeddedAssets.length >= 2, 'Embedded frontend assets were not observed');
      } finally { await observeInstalledOperation('Detach asset CDP session', () => session.detach()); }
      await screenshot('first-run');
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Preferences', exact: true })).toBeVisible();
      await screenshot('preferences');
      await page.getByRole('button', { name: 'Close settings', exact: true }).click();
      const query = 'installed application persistence';
      await page.getByRole('searchbox', { name: 'Search cached stories', exact: true }).fill(query);
      await waitForInstalledState(async () => {
        const workspace = await invoke({ op: 'workspace_get', profileId: 'default' });
        return workspace.tabs.find(tab => tab.id === 'home')?.query === query;
      }, 'A real UI query did not reach the default application database');
      report.persistedQuery = query;
      await screenshot('saved-query');
      return { ...report.firstRun, url: page.url(), ownedWindowPid: app.pid, persistedQuery: query };
    },
    'graceful installed-app shutdown': async () => {
      await stopApplication();
      await disconnectNativeBrowser(browser);
      browser = null;
      return report.termination;
    },
    'uninstall preserves application data': () => uninstall(true),
    'final source binding': async () => {
      const final = await bind(false);
      assert.deepEqual(final, binding, 'Source or inspected package changed during install acceptance');
      report.finalBinding = final;
      return { inputMapSha256: final.inputMapSha256, installerSha256: final.installerSha256, sourceHead: final.sourceHead };
    },
    cleanup: async () => {
      if (!owner) return { passed: true, ruleRemoved: true, stoppedProcessIds: [], remainingProcessIds: [],
        reason: 'This invocation did not acquire installation ownership' };
      const failures = [];
      if (report.fatal && page && !page.isClosed()) await screenshot('failure').catch(error => {
        report.failureScreenshotError = String(error);
      });
      try { await stopApplication(); } catch (error) { failures.push(String(error)); }
      try { await disconnectNativeBrowser(browser); } catch (error) { failures.push(String(error)); }
      browser = null;
      if (owner && !report.uninstall && existsSync(installedUninstaller)) {
        try { await uninstall(false); } catch (error) { failures.push('Failure-path uninstall: ' + error); }
      }
      let cleanup;
      try { cleanup = await state('Cleanup'); }
      finally { releaseFailedChildHandles(app); }
      if (failures.length) { report.cleanupError = failures.join('\n'); cleanup.passed = false; }
      return cleanup;
    },
  };
  const status = await runInstalledSteps(report, operations, save);
  console.log((report.passed ? 'PASSED' : 'FAILED') + ' installed application acceptance: '
    + report.checks.filter(check => check.passed).length + '/' + CHECKS.length + '; ' + base + '.json');
  return status;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = 1;
  try { process.exitCode = await main(); }
  catch (error) { console.error(String(error.stack || error)); }
}
