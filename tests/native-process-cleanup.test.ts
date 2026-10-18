import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test, vi } from "vitest";
import { finalizeNativeEvidence, runNativeCommand, stopOwnedProcess, type NativeEvidence } from "../scripts/native-process-cleanup.mjs";

const owned = new Set<ChildProcess>();
const files = new Set<string>();
const root = fileURLToPath(new URL("../", import.meta.url));
const alive = (child: ChildProcess) => child.exitCode === null && child.signalCode === null;

async function fixture() {
  const child = spawn(process.execPath, ["-e", `
    process.on('message', ({ code, delay = 0 }) => setTimeout(() => process.exit(code), delay));
    process.send('ready');
  `], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  owned.add(child);
  await once(child, "message");
  return child;
}

afterEach(async () => {
  for (const child of owned) {
    if (alive(child)) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
    expect(alive(child), `Owned fixture ${child.pid} must be stopped`).toBe(false);
  }
  owned.clear();
  for (const file of files) rmSync(file, { force: true });
  files.clear();
});

function evidence(count = 10): NativeEvidence {
  return { checks: Array.from({ length: count }, (_, index) => ({ name: `fixture check ${index}`, passed: true })),
    pageErrors: [], consoleErrors: [] };
}

const closeFixture = (child: ChildProcess, code = 0, delay = 0) => async () => {
  child.send({ code, delay });
  return [{ pid: child.pid, title: "Owned regression fixture", closeRequested: true }];
};

const forceFixture = async (child: ChildProcess) => {
  child.kill("SIGKILL");
  return { status: 0, stdout: "Owned fixture force requested", stderr: "" };
};

test("rejects the recorded CI force attempt even when every feature check and the eventual app exit pass", () => {
  const report = evidence();
  const termination = { pid: 5628, status: 255, forced: true, exitCode: 0 };
  expect(finalizeNativeEvidence(report, 10, [termination])).toBe(1);
  expect(report.passed).toBe(false);
});

test("observes a real owned graceful exit before final acceptance", async () => {
  const child = await fixture();
  const force = vi.fn(forceFixture);
  const result = await stopOwnedProcess(child, { requestClose: closeFixture(child), gracefulTimeout: 1000, force });
  expect(result).toMatchObject({ pid: child.pid, passed: true, forced: false, forceKilled: false, exitCode: 0, signalCode: null });
  expect(result.exitObservedAt).toBeTruthy();
  expect(force).not.toHaveBeenCalled();
  const report = evidence();
  expect(finalizeNativeEvidence(report, 10, [result])).toBe(0);
});

test("an asynchronous close helper allows the app exit event to arrive while that helper is still running", async () => {
  const child = await fixture();
  let observed = false;
  child.once("exit", () => { observed = true; });
  const force = vi.fn(forceFixture);
  const result = await stopOwnedProcess(child, {
    requestClose: async () => {
      child.send({ code: 0, delay: 20 });
      const command = await runNativeCommand(process.execPath, ["-e", "setTimeout(() => {}, 150)"], { timeout: 1000 });
      expect(command.status).toBe(0);
      expect(observed, "The command must not block delivery of the app exit event").toBe(true);
      return [{ pid: child.pid, closeRequested: true }];
    },
    gracefulTimeout: 1000, force,
  });
  expect(result.passed).toBe(true);
  expect(force).not.toHaveBeenCalled();
});

test("a delayed code-zero exit and failed force command remain a failed graceful outcome", async () => {
  const child = await fixture();
  const result = await stopOwnedProcess(child, {
    requestClose: closeFixture(child, 0, 80), gracefulTimeout: 20, forceTimeout: 1500,
    force: async () => runNativeCommand(process.execPath, ["-e", `
      setTimeout(() => { process.stdout.write('owned command diagnostic'); process.stderr.write('injected status 255'); process.exitCode=255; }, 150);
    `], { timeout: 1000 }),
  });
  expect(result).toMatchObject({ passed: false, gracefulTimedOut: true, forced: true, exitCode: 0,
    taskkill: { status: 255, stdout: "owned command diagnostic", stderr: "injected status 255" } });
  expect(result.error).toContain("force cleanup was attempted");
  expect(result.exitObservedAt).toBeTruthy();
  expect(finalizeNativeEvidence(evidence(), 10, [result])).toBe(1);
});

test("a failed force command cannot report success while the owned app remains alive", async () => {
  const child = await fixture();
  const result = await stopOwnedProcess(child, {
    requestClose: async () => [{ pid: child.pid, closeRequested: true }], gracefulTimeout: 20, forceTimeout: 40,
    force: async () => ({ status: 255, stdout: "", stderr: "injected force failure" }),
  });
  expect(result).toMatchObject({ passed: false, forced: true, exitCode: null });
  expect(result.error).toContain("remains alive after bounded force cleanup");
  expect(alive(child)).toBe(true);
});

test("a rejected close request remains failed after owned fallback cleanup", async () => {
  const child = await fixture();
  const result = await stopOwnedProcess(child, {
    requestClose: async () => { throw Error("PostMessageW rejected the owned window"); },
    gracefulTimeout: 1000, forceTimeout: 1000, force: forceFixture,
  });
  expect(result.passed).toBe(false);
  expect(result.error).toContain("PostMessageW rejected");
  expect(result.forced).toBe(true);
  expect(alive(child)).toBe(false);
});

test("an app that already exited does not trigger window or force commands", async () => {
  const child = await fixture();
  const exited = once(child, "exit");
  child.send({ code: 0 });
  await exited;
  const requestClose = vi.fn();
  const force = vi.fn(forceFixture);
  const result = await stopOwnedProcess(child, { requestClose, gracefulTimeout: 1000, force });
  expect(result).toMatchObject({ passed: false, appAliveAtStart: false, forced: false, exitCode: 0 });
  expect(requestClose).not.toHaveBeenCalled();
  expect(force).not.toHaveBeenCalled();
});

test("a nonzero normal exit rejects acceptance without claiming force was used", async () => {
  const child = await fixture();
  const result = await stopOwnedProcess(child, { requestClose: closeFixture(child, 7), gracefulTimeout: 1000, force: forceFixture });
  expect(result).toMatchObject({ passed: false, forced: false, exitCode: 7, signalCode: null });
  expect(finalizeNativeEvidence(evidence(), 10, [result])).toBe(1);
});

test("daily acceptance requires both launches to finish successfully", () => {
  const clean = { passed: true, forced: false, forceKilled: false, exitCode: 0, signalCode: null, appAliveAtStart: true };
  const forced = { ...clean, passed: false, forced: true, forceKilled: true };
  expect(finalizeNativeEvidence(evidence(13), 13, [clean, clean], 2)).toBe(0);
  expect(finalizeNativeEvidence(evidence(13), 13, [clean, forced], 2)).toBe(1);
  expect(finalizeNativeEvidence(evidence(13), 13, [clean], 2)).toBe(1);
});

test("a command that does not finish is bounded and preserves failure diagnostics", async () => {
  const result = await runNativeCommand(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeout: 80 });
  expect(result.status).not.toBe(0);
  expect(result.error).toBeTruthy();
});

test("missing cleanup, a fatal startup, or a cleanup failure cannot become a passing report", () => {
  const clean = { passed: true, forced: false, forceKilled: false, exitCode: 0, signalCode: null, appAliveAtStart: true };
  expect(finalizeNativeEvidence(evidence(), 10, [])).toBe(1);
  expect(finalizeNativeEvidence({ ...evidence(), fatalError: "before launch" }, 10, [clean])).toBe(1);
  expect(finalizeNativeEvidence({ ...evidence(), cleanupError: "firewall cleanup failed" }, 10, [clean])).toBe(1);
  expect(finalizeNativeEvidence(evidence(9), 10, [clean])).toBe(1);
});

test.each([["v05-native-smoke.mjs", "v05-native"], ["daily-native-smoke.mjs", "daily-native"]])(
  "the actual %s entry point fails before launch without native cleanup", async (script, label) => {
    const prefix = `${label}-cleanup-regression-${randomUUID()}`;
    const report = path.join(root, "docs/evidence", `${prefix}.json`);
    files.add(report);
    const result = await runNativeCommand(process.execPath, [path.join(root, "scripts", script),
      "--exe", path.join(root, "test-results", `${prefix}-missing.exe`), "--prefix", prefix], { timeout: 5000 });
    expect(result.status, result.stderr || result.error).toBe(1);
    const recorded = JSON.parse(readFileSync(report, "utf8"));
    expect(recorded.passed).toBe(false);
    expect(recorded.fatalError).toBeTruthy();
    expect(recorded.launches).toEqual([]);
    expect(recorded.cleanup).toBeUndefined();
    expect(recorded.ciFirewall).toBeUndefined();
    expect(JSON.parse(result.stdout!).passed).toBe(false);
  });
