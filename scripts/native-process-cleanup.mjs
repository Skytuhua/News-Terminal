// Owned native fixture lifecycle only. Never discover or stop an unrelated app.
import { execFile } from 'node:child_process';
import assert from 'node:assert/strict';

const stamp = () => new Date().toISOString();
const tail = value => String(value || '').slice(-3000);
const running = child => child.exitCode === null && child.signalCode === null;

export function runNativeCommand(file, args, { timeout = 15000, env = process.env } = {}) {
  return new Promise(resolve => {
    execFile(file, args, { env, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => {
      resolve({ status: error ? (typeof error.code === 'number' ? error.code : null) : 0,
        signal: error?.signal ?? null, error: error ? tail(error.message) : undefined,
        stdout: tail(stdout), stderr: tail(stderr) });
    });
  });
}

export async function nativeCommandJson(file, args, options) {
  const result = await runNativeCommand(file, args, options);
  if (result.status !== 0 || result.error) throw Error(`${file} failed: ${JSON.stringify(result)}`);
  try { return JSON.parse(result.stdout.replace(/^\uFEFF/, '')); }
  catch (error) { throw Error(`${file} returned invalid JSON: ${error}; ${JSON.stringify(result)}`); }
}

const windowsPython = String.raw`
import ctypes as c, ctypes.wintypes as w, json, sys
u=c.WinDLL('user32',use_last_error=True)
u.GetWindowThreadProcessId.argtypes=[w.HWND,c.POINTER(w.DWORD)]
u.GetWindowThreadProcessId.restype=w.DWORD
u.IsWindowVisible.argtypes=[w.HWND]
u.IsWindowVisible.restype=w.BOOL
u.GetWindowTextW.argtypes=[w.HWND,w.LPWSTR,c.c_int]
u.PostMessageW.argtypes=[w.HWND,w.UINT,w.WPARAM,w.LPARAM]
u.PostMessageW.restype=w.BOOL
a=json.loads(sys.argv[1]); windows=[]
callback=c.WINFUNCTYPE(w.BOOL,w.HWND,w.LPARAM)
@callback
def collect(h,p):
    pid=w.DWORD();u.GetWindowThreadProcessId(h,c.byref(pid))
    if pid.value==a['pid'] and u.IsWindowVisible(h):
        title=c.create_unicode_buffer(512);u.GetWindowTextW(h,title,512)
        if title.value:windows.append(dict(hwnd=int(h),pid=pid.value,title=title.value,visible=True))
    return True
u.EnumWindows.argtypes=[callback,w.LPARAM]
u.EnumWindows.restype=w.BOOL
if not u.EnumWindows(collect,0):raise c.WinError(c.get_last_error())
if a['close']:
    main=[item for item in windows if item['title']=='News Terminal']
    if len(main)!=1:raise RuntimeError('Expected one owned main window for WM_CLOSE; found '+str(len(main)))
    item=main[0];pid=w.DWORD()
    u.GetWindowThreadProcessId(item['hwnd'],c.byref(pid))
    if pid.value!=a['pid']:raise RuntimeError('Main window no longer belongs to the owned process')
    if not u.PostMessageW(item['hwnd'],16,0,0):raise c.WinError(c.get_last_error())
    item['closeRequested']=True
print(json.dumps(windows))
`;

export async function ownedNativeWindows(pid, { close = false, python = 'python' } = {}) {
  assert.ok(Number.isInteger(pid) && pid > 0, 'An owned child PID is required');
  return nativeCommandJson(python, ['-c', windowsPython, JSON.stringify({ pid, close })], { timeout: 15000 });
}

function waitForExit(child, timeout) {
  if (!running(child)) return Promise.resolve(true);
  return new Promise(resolve => {
    let timer;
    const finish = exited => { clearTimeout(timer); child.off('exit', onExit); resolve(exited); };
    const onExit = () => finish(true);
    child.once('exit', onExit);
    timer = setTimeout(() => finish(!running(child)), Math.max(0, timeout));
    if (!running(child)) finish(true);
  });
}

async function forceOwnedProcess(child, timeout) {
  assert.equal(process.platform, 'win32', 'Native force cleanup requires Windows');
  return runNativeCommand('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeout });
}

export async function disconnectNativeBrowser(browser) {
  if (!browser) return;
  let timer;
  try {
    await Promise.race([browser.close(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('Owned CDP connection did not close within 5000ms')), 5000);
    })]);
  } finally { clearTimeout(timer); }
}

export function releaseFailedChildHandles(child) {
  // The report still names any surviving owned PID, and CI retains its block
  // when OS cleanup fails. Do not let its pipes hide the harness failure exit.
  if (!child || !running(child)) return;
  child.stdin?.destroy();
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
}

export async function stopOwnedProcess(child, { requestClose, gracefulTimeout, forceTimeout = 10000,
  force = forceOwnedProcess } = {}) {
  assert.ok(Number.isInteger(child?.pid) && child.pid > 0, 'An owned child PID is required');
  assert.ok(Number.isFinite(gracefulTimeout) && gracefulTimeout > 0, 'A bounded graceful deadline is required');
  assert.ok(Number.isFinite(forceTimeout) && forceTimeout > 0, 'A bounded force deadline is required');
  const result = { pid: child.pid, requestedGraceful: true, forced: false, forceKilled: false,
    appAliveAtStart: running(child), startedAt: stamp() };
  const errors = [];
  const recordExit = (code, signal) => { result.exitObservedAt = stamp(); result.exitCode = code; result.signalCode = signal; };
  child.once('exit', recordExit);
  try {
    if (!result.appAliveAtStart) {
      errors.push('Owned process exited before graceful cleanup began');
    } else {
      try {
        result.closeRequestStartedAt = stamp();
        result.windows = await requestClose();
        result.closeRequestFinishedAt = stamp();
        if (!await waitForExit(child, gracefulTimeout)) {
          result.gracefulTimedOut = true;
          errors.push(`Owned process did not exit within the ${gracefulTimeout}ms graceful deadline`);
        }
      } catch (error) { errors.push(`Graceful close request failed: ${tail(error)}`); }
      if (running(child)) {
        // These compatibility flags record a force ATTEMPT, not proof that it killed the app.
        result.forced = result.forceKilled = true;
        result.forceAttemptedAt = stamp();
        const deadline = Date.now() + forceTimeout;
        try { result.taskkill = await force(child, forceTimeout); }
        catch (error) { result.taskkill = { status: null, error: tail(error) }; }
        result.status = result.taskkill.status;
        if (!await waitForExit(child, deadline - Date.now())) errors.push('Owned process remains alive after bounded force cleanup');
        if (result.taskkill.status !== 0 || result.taskkill.error) errors.push('Owned force command failed; inspect taskkill diagnostics');
      }
    }
    result.exitCode = child.exitCode;
    result.signalCode = child.signalCode;
    if (result.exitCode !== 0 || result.signalCode !== null) errors.push('Owned process did not exit normally with code 0');
    if (result.forced) errors.push('Graceful acceptance failed because force cleanup was attempted');
    result.passed = errors.length === 0;
    if (errors.length) result.error = errors.join('; ');
    result.finishedAt = stamp();
    return result;
  } finally { child.off('exit', recordExit); }
}

export function finalizeNativeEvidence(evidence, expectedChecks, terminations, expectedLaunches = 1) {
  evidence.finishedAt = stamp();
  evidence.summary = { checks: evidence.checks.length, passed: evidence.checks.filter(check => check.passed).length,
    failed: evidence.checks.filter(check => !check.passed).length };
  evidence.pageErrorCount = evidence.pageErrors.length;
  evidence.consoleErrorCount = evidence.consoleErrors.length;
  evidence.passed = evidence.summary.checks === expectedChecks && evidence.summary.failed === 0
    && evidence.pageErrorCount === 0 && !evidence.fatalError && !evidence.cleanupError
    && terminations.length === expectedLaunches && terminations.every(result => result?.passed === true
      && result.appAliveAtStart === true && !result.forced && !result.forceKilled
      && result.exitCode === 0 && result.signalCode === null && !result.error);
  return evidence.passed ? 0 : 1;
}
