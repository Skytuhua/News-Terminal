import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hostedContext, assertFreshState, assertInstalledState, assertUninstalledState, assertFirstRunDefaults,
  nsisArguments, finalizeInstalledEvidence, runInstalledSteps, observeInstalledOperation,
  waitForInstalledState, snapshotApplicationData } from "../scripts/ci-installed-smoke.mjs";

const env = { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Windows",
  GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "2", GITHUB_SHA: "a".repeat(40),
  GITHUB_WORKSPACE: "D:\\a\\News-Terminal\\News-Terminal", RUNNER_TEMP: "D:\\a\\_temp",
  GITHUB_OUTPUT: "D:\\a\\_temp\\step-output" };

test("the actual entrypoint refuses both install and fallback cleanup with CI explicitly disabled", () => {
  const temporary = mkdtempSync(join(tmpdir(), "news-terminal-refused-install-"));
  try {
    for (const args of [[], ["--cleanup"]]) {
      const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/ci-installed-smoke.mjs", import.meta.url)), ...args], {
        cwd: temporary, env: { ...process.env, GITHUB_ACTIONS: "false", RUNNER_TEMP: temporary }, encoding: "utf8", timeout: 10000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/requires a disposable GitHub-hosted Windows x64 job/);
      expect(readdirSync(temporary)).toEqual([]);
    }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test("rejects local or unsupported execution before an owned installation can be allocated", () => {
  expect(() => hostedContext("linux", "x64", env, env.GITHUB_WORKSPACE)).toThrow(/hosted Windows/);
  expect(() => hostedContext("win32", "arm64", env, env.GITHUB_WORKSPACE)).toThrow(/hosted Windows/);
  expect(() => hostedContext("win32", "x64", { ...env, RUNNER_ENVIRONMENT: "self-hosted" }, env.GITHUB_WORKSPACE)).toThrow(/hosted Windows/);
});

test("rejects missing job identity and a checkout outside the hosted workspace", () => {
  expect(() => hostedContext("win32", "x64", { ...env, GITHUB_RUN_ID: "" }, env.GITHUB_WORKSPACE)).toThrow();
  expect(() => hostedContext("win32", "x64", env, "D:\\another-checkout")).toThrow();
});

test("rejects inherited data or WebView overrides instead of accepting a different first-run environment", () => {
  expect(() => hostedContext("win32", "x64", { ...env, news_terminal_data_dir: "D:\\old" }, env.GITHUB_WORKSPACE)).toThrow(/override/);
  expect(() => hostedContext("win32", "x64", { ...env, WEBVIEW2_BROWSER_EXECUTABLE_FOLDER: "D:\\preview" }, env.GITHUB_WORKSPACE)).toThrow(/override/);
});

test("a preexisting same-name process or saved data refuses setup even outside the planned install path", () => {
  const clean = { collisions: [], sameNameProcesses: [], runtime: [{ registryKey: "HKLM runtime", version: "155.0.1.0" }], interactive: true, sessionId: 1 };
  expect(() => assertFreshState(clean)).not.toThrow();
  expect(() => assertFreshState({ ...clean, sameNameProcesses: [{ pid: 18, path: "C:\\old\\news-terminal.exe" }] })).toThrow(/existing/);
  expect(() => assertFreshState({ ...clean, collisions: ["Roaming application data"] })).toThrow(/existing/);
  expect(() => assertFreshState({ ...clean, runtime: [] })).toThrow(/existing WebView2/);
});

test("NSIS receives a final raw directory argument with spaces and no control flags that skip prerequisites or shortcuts", () => {
  expect(nsisArguments("D:\\a\\_temp\\NewsTerminal install 123 2\\News Terminal", false)).toEqual([
    "/S", "/D=D:\\a\\_temp\\NewsTerminal install 123 2\\News Terminal",
  ]);
  expect(nsisArguments("D:\\a\\_temp\\NewsTerminal install 123 2\\News Terminal", true)).toEqual([
    "/S", "_?=D:\\a\\_temp\\NewsTerminal install 123 2\\News Terminal",
  ]);
  expect(() => nsisArguments("relative\\path", false)).toThrow();
  expect(() => nsisArguments('D:\\bad" /R', false)).toThrow();
});

function report() {
  return { checks: ["source and payload binding", "fresh disposable user state", "installed payload and registration",
    "first-run defaults and usable UI", "graceful installed-app shutdown", "uninstall preserves application data", "final source binding"]
    .map(name => ({ name, passed: true })), pageErrors: [], consoleErrors: [],
    install: { status: 0, forced: false }, uninstall: { status: 0, forced: false },
    termination: { passed: true, forced: false, forceKilled: false, exitCode: 0, signalCode: null, appAliveAtStart: true },
    cleanup: { passed: true, stoppedProcessIds: [], remainingProcessIds: [], ruleRemoved: true }, passed: false };
}

test("acceptance stays failed after a forced command or cleanup despite all UI and file checks passing", () => {
  const clean = report();
  expect(finalizeInstalledEvidence(clean)).toBe(0);
  expect(clean.passed).toBe(true);
  for (const partial of [
    { install: { status: 0, forced: true } },
    { uninstall: { status: 255, forced: false } },
    { termination: { ...report().termination, forced: true } },
    { cleanup: { ...report().cleanup, stoppedProcessIds: [18] } },
    { cleanup: { ...report().cleanup, passed: false } },
    { fatal: "source changed after launch" },
    { cleanupError: "owned rule remains" },
    { pageErrors: ["bootstrap rejected"] },
  ]) {
    const failed = { ...report(), ...partial };
    expect(finalizeInstalledEvidence(failed)).toBe(1);
    expect(failed.passed).toBe(false);
  }
});

test("missing or duplicated lifecycle evidence cannot substitute for the required stages", () => {
  const missing = report(); missing.checks.pop();
  expect(finalizeInstalledEvidence(missing)).toBe(1);
  const duplicated = report(); duplicated.checks[6] = duplicated.checks[0];
  expect(finalizeInstalledEvidence(duplicated)).toBe(1);
  expect(finalizeInstalledEvidence({ ...report(), termination: undefined })).toBe(1);
});

test("installed registration and both current-user shortcuts must point to the inspected installation", () => {
  const directory = "D:\\temporary install\\News Terminal";
  const state = { applicationExists: true, installDirectoryExists: true, sameNameProcesses: [],
    registration: { exists: true, displayName: "News Terminal", version: "0.4.0", publisher: "newsterminal",
      installLocation: '"' + directory + '"', uninstallString: '"' + directory + '\\uninstall.exe"', mainBinaryName: "news-terminal.exe" },
    manufacturerLocation: directory,
    shortcuts: [true, true, false, false].map(exists => ({ exists, target: exists ? directory + "\\news-terminal.exe" : null, arguments: exists ? "" : null })) };
  expect(() => assertInstalledState(state, directory, "0.4.0")).not.toThrow();
  expect(() => assertInstalledState({ ...state, registration: { ...state.registration, installLocation: '"C:\\old"' } }, directory, "0.4.0")).toThrow();
  expect(() => assertInstalledState({ ...state, shortcuts: [{ ...state.shortcuts[0], target: "C:\\old\\news-terminal.exe" }, ...state.shortcuts.slice(1)] }, directory, "0.4.0")).toThrow();
  expect(() => assertInstalledState({ ...state, shortcuts: [{ ...state.shortcuts[0], arguments: "--unexpected" }, ...state.shortcuts.slice(1)] }, directory, "0.4.0")).toThrow();
});

test("uninstall must remove program registration while preserving the template's install-location preference", () => {
  const directory = "D:\\temporary install\\News Terminal";
  const state = { applicationExists: false, installDirectoryExists: false, sameNameProcesses: [], registration: { exists: false },
    shortcuts: Array.from({ length: 4 }, () => ({ exists: false })), manufacturerLocation: directory, runtime: [{ version: "155.0.1.0" }] };
  expect(() => assertUninstalledState(state, directory)).not.toThrow();
  expect(() => assertUninstalledState({ ...state, applicationExists: true }, directory)).toThrow();
  expect(() => assertUninstalledState({ ...state, registration: { exists: true } }, directory)).toThrow();
  expect(() => assertUninstalledState({ ...state, manufacturerLocation: null }, directory)).toThrow();
  expect(() => assertUninstalledState({ ...state, runtime: [] }, directory)).toThrow();
});

function dataFixture() {
  const temporary = mkdtempSync(join(realpathSync(tmpdir()), "news-terminal-preserved-data-"));
  const directory = join(temporary, "application data");
  mkdirSync(directory);
  writeFileSync(join(directory, "news-terminal.sqlite3"), Buffer.alloc(4096));
  writeFileSync(join(directory, "workspace-windows.json"), '{"windows":{}}');
  return { temporary, directory };
}

test.each(["removed", "changed"])("application-data preservation detects %s SQLite WAL while main database and layout stay intact", async change => {
  const { temporary, directory } = dataFixture();
  try {
    const wal = join(directory, "news-terminal.sqlite3-wal");
    writeFileSync(wal, "committed rows one");
    const before = await snapshotApplicationData(directory);
    if (change === "removed") rmSync(wal);
    else writeFileSync(wal, "committed rows two");
    const after = await snapshotApplicationData(directory);
    expect(after["news-terminal.sqlite3"]).toEqual(before["news-terminal.sqlite3"]);
    expect(after["workspace-windows.json"]).toEqual(before["workspace-windows.json"]);
    expect(after).not.toEqual(before);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test("application-data snapshot records sidecars, nested binary files and empty files with stable relative paths", async () => {
  const { temporary, directory } = dataFixture();
  try {
    const files = { "news-terminal.sqlite3-wal": Buffer.from("committed rows"),
      "news-terminal.sqlite3-shm": Buffer.alloc(32), "saved queries/多言語.bin": Buffer.from([0, 255, 10, 128]),
      ".empty": Buffer.alloc(0) };
    for (const [name, bytes] of Object.entries(files)) {
      if (name.includes("/")) mkdirSync(join(directory, "saved queries"));
      writeFileSync(join(directory, name), bytes);
    }
    const snapshot = await snapshotApplicationData(directory);
    expect(Object.keys(snapshot)).toEqual([...Object.keys(files), "news-terminal.sqlite3", "workspace-windows.json"].sort());
    for (const [name, bytes] of Object.entries(files)) {
      expect(snapshot[name]).toEqual({ bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
    expect(await snapshotApplicationData(directory)).toEqual(snapshot);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test.each(["changed SHM", "removed nested file", "added nested file"])("application-data preservation detects a %s", async change => {
  const { temporary, directory } = dataFixture();
  try {
    mkdirSync(join(directory, "saved"));
    writeFileSync(join(directory, "saved", "query.json"), '{"query":"one"}');
    writeFileSync(join(directory, "news-terminal.sqlite3-shm"), "index one");
    const before = await snapshotApplicationData(directory);
    if (change === "changed SHM") writeFileSync(join(directory, "news-terminal.sqlite3-shm"), "index two");
    else if (change === "removed nested file") rmSync(join(directory, "saved", "query.json"));
    else writeFileSync(join(directory, "saved", "unexpected.json"), "new data");
    const after = await snapshotApplicationData(directory);
    expect(after["news-terminal.sqlite3"]).toEqual(before["news-terminal.sqlite3"]);
    expect(after["workspace-windows.json"]).toEqual(before["workspace-windows.json"]);
    expect(after).not.toEqual(before);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test.each(["news-terminal.sqlite3", "workspace-windows.json"])("application-data snapshot requires a nonempty %s", async name => {
  const { temporary, directory } = dataFixture();
  try {
    writeFileSync(join(directory, name), "");
    await expect(snapshotApplicationData(directory)).rejects.toThrow(name);
    rmSync(join(directory, name));
    await expect(snapshotApplicationData(directory)).rejects.toThrow(name);
    mkdirSync(join(directory, name));
    await expect(snapshotApplicationData(directory)).rejects.toThrow(name);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test("application-data snapshot permits absent failure-path data only when explicitly optional", async () => {
  const { temporary, directory } = dataFixture();
  try {
    rmSync(directory, { recursive: true });
    await expect(snapshotApplicationData(directory)).rejects.toThrow();
    expect(await snapshotApplicationData(directory, false)).toEqual({});
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test.each(["root", "ancestor", "nested"])("application-data snapshot refuses a %s directory link or Windows junction", async location => {
  const { temporary, directory } = dataFixture();
  try {
    const link = join(location === "nested" ? directory : temporary, "data link");
    symlinkSync(location === "ancestor" ? temporary : directory, link, process.platform === "win32" ? "junction" : "dir");
    const candidate = location === "nested" ? directory : location === "ancestor" ? join(link, "application data") : link;
    await expect(snapshotApplicationData(candidate)).rejects.toThrow(/symbolic link|reparse point/);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test.skipIf(process.platform === "win32")("application-data snapshot refuses an unsupported FIFO without opening it", async () => {
  const { temporary, directory } = dataFixture();
  try {
    const created = spawnSync("python", ["-I", "-c", "import os, sys; os.mkfifo(sys.argv[1])", join(directory, "unsupported-pipe")],
      { encoding: "utf8", timeout: 5000 });
    expect(created.error).toBeUndefined();
    expect(created.status, created.stderr).toBe(0);
    await expect(snapshotApplicationData(directory)).rejects.toThrow(/Unsupported application data entry/);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test("first run requires real default profile and disabled, unconsented providers before any UI edit", () => {
  const snapshot = { profiles: [{ id: "default" }], profile: { id: "default", name: "Global", alertsEnabled: false,
    quietHours: { enabled: false, start: "22:00", end: "08:00" },
    preferences: { topics: [], regions: [], languages: ["en"], sources: [], keywords: [], excludeKeywords: [], diversityCap: 0.5 } },
    workspace: { activeTabId: "home", tabs: [{ id: "home", title: "AI", section: "ai", topic: "", query: "", mode: "all" }] },
    providers: ["gemini", "groq", "ollama"].map(id => ({ id, enabled: false, consented: false, hasKey: false })), articles: [] };
  expect(() => assertFirstRunDefaults(snapshot, { automatic: false, mode: "visual" })).not.toThrow();
  expect(() => assertFirstRunDefaults({ ...snapshot, providers: [{ ...snapshot.providers[0], consented: true }, ...snapshot.providers.slice(1)] }, { automatic: false, mode: "visual" })).toThrow();
  expect(() => assertFirstRunDefaults({ ...snapshot, workspace: { ...snapshot.workspace, activeTabId: "old" } }, { automatic: false, mode: "visual" })).toThrow();
  expect(() => assertFirstRunDefaults(snapshot, { automatic: true, mode: "visual" })).toThrow();
});

test("an earlier stage failure retains its evidence, stops the acceptance stages, and still waits for cleanup", async () => {
  const evidence = report();
  const names = evidence.checks.map(check => check.name);
  const calls: string[] = [];
  const operations = Object.fromEntries(names.map(name => [name, async () => {
    calls.push(name);
    if (name === "installed payload and registration") throw Error("injected installed resource mismatch");
    return {};
  }]));
  operations.cleanup = async () => {
    await new Promise(resolve => setTimeout(resolve, 5));
    calls.push("cleanup finished");
    return report().cleanup;
  };
  expect(await runInstalledSteps(evidence, operations)).toBe(1);
  expect(calls).toEqual([...names.slice(0, 3), "cleanup finished"]);
  expect(evidence.checks.at(-1)).toMatchObject({ name: names[2], passed: false });
  expect(evidence.passed).toBe(false);
});

test("a late cleanup rejection cannot leave a passing summary after seven successful stages", async () => {
  const evidence = report();
  const operations = Object.fromEntries(evidence.checks.map(check => [check.name, async () => ({})]));
  operations.cleanup = async () => { throw Error("injected rule removal failure"); };
  expect(await runInstalledSteps(evidence, operations)).toBe(1);
  expect(evidence.checks.every(check => check.passed)).toBe(true);
  expect(evidence.passed).toBe(false);
});

test.each(["IPC request", "poll callback"])("a stalled %s fails its named stage and awaits cleanup without resuming later actions", async kind => {
  const evidence = report();
  const names = evidence.checks.map(check => check.name);
  const calls: string[] = [];
  let finishRequest!: (value: boolean) => void;
  const pending = new Promise<boolean>(resolve => { finishRequest = resolve; });
  const operations = Object.fromEntries(names.map(name => [name, async () => {
    calls.push(name);
    if (name === names[3]) {
      if (kind === "IPC request") await observeInstalledOperation("Injected native request", () => pending, 20);
      else await waitForInstalledState(() => pending, "Injected native probe", 20);
      calls.push("later UI action");
    }
    return {};
  }]));
  operations.cleanup = async () => {
    await new Promise(resolve => setTimeout(resolve, 5));
    calls.push("cleanup finished");
    return report().cleanup;
  };
  const result = await Promise.race([
    runInstalledSteps(evidence, operations),
    new Promise(resolve => setTimeout(() => resolve("outer test deadline"), 200)),
  ]);
  expect(result).toBe(1);
  expect(calls).toEqual([...names.slice(0, 4), "cleanup finished"]);
  expect(evidence.checks.at(-1)).toMatchObject({ name: names[3], passed: false, error: expect.stringMatching(/Injected native/) });
  expect(evidence.passed).toBe(false);
  finishRequest(true);
  await Promise.resolve();
  await Promise.resolve();
  expect(calls).not.toContain("later UI action");
});
