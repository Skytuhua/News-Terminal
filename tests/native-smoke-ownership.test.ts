import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';
import { expect, test } from 'vitest';
import { assertNativeEndpointSnapshot, assertOwnedNativeEndpoint, type NativeEndpointSnapshot } from '../scripts/native-smoke-ownership.mjs';
import type { ChildProcess } from 'node:child_process';

// Exercise the actual entry point's launch and IPC functions. Only Windows OS,
// child-process, and browser boundaries are replaced; no listener/app is started.
function harness(owned = true, changesDuringConnect = false) {
  const source = readFileSync(process.env.NATIVE_SMOKE_OWNERSHIP_SOURCE || new URL('../scripts/native-smoke.mjs', import.meta.url), 'utf8');
  const asyncCleanup = source.indexOf('async function terminate() {');
  const cleanup = asyncCleanup >= 0 ? asyncCleanup : source.indexOf('function terminate() {');
  const functions = source.slice(source.indexOf('async function launch() {'), cleanup);
  const requests: string[] = [];
  let currentOwner = owned;
  const page = { waitForFunction: async () => {}, getByRole: () => ({ waitFor: async () => {} }) };
  const child = { pid: 4242, exitCode: null as number | null, signalCode: null, stderr: { on() {} }, stdout: { on() {} }, on() {} };
  let connected = true;
  const browser = { contexts: () => [{ pages: () => [page] }], isConnected: () => connected };
  let probes = 0;
  const context = vm.createContext({ performance, assert, join, process: { env: {} }, Date,
    executable: 'original.exe', launchedExecutable: 'fresh-fixture/owned.exe', dataDirectory: 'fresh-fixture',
    port: 9227, app: null, browser: null, endpointIdentity: null,
    evidence: { checks: [], launches: [] }, delay: async () => {}, freePort: async () => 41001,
    spawn: () => child, cdpBrowserArgs: () => '',
    chromium: { connectOverCDP: async () => { if (changesDuringConnect) currentOwner = false; return browser; } },
    disconnectNativeBrowser: async () => { connected = false; },
    assertOwnedNativeEndpoint: async (_child: unknown, expected: object) => {
      probes++;
      const snapshot = ownerSnapshot();
      if (!currentOwner) snapshot.listener!.ancestors = [{ pid: 4343, parentPid: 9999, createdAt: '134058000000000200' }];
      return assertNativeEndpointSnapshot(snapshot, { pid: 4242, parentPid: 5000, ...expected, executable: 'fresh-fixture/owned.exe' });
    },
    invokeNative: async (_page: unknown, request: { op: string }) => {
      requests.push(request.op);
      return request.op === 'window_context' ? { label: 'main' } : { profiles: [] };
    },
  });
  vm.runInContext(functions, context);
  return { requests, context, page, child, browser, probeCount: () => probes, disconnect: () => { connected = false; },
    launch: () => vm.runInContext('launch()', context) as Promise<unknown>,
    invoke: (op: string) => { context.targetPage = page; context.request = { op };
      return vm.runInContext('invoke(targetPage, request)', context) as Promise<unknown>; } };
}

test('a wrong debug listener is rejected before reading or mutating any native state', async () => {
  const fixture = harness(false);
  await expect(fixture.launch()).rejects.toThrow('does not belong');
  expect(fixture.requests).toEqual([]);
});

test('the owned launch can read native context and use IPC', async () => {
  const fixture = harness();
  expect(await fixture.launch()).toBe(fixture.page);
  const probesAtConnection = fixture.probeCount();
  await fixture.invoke('snapshot');
  expect(fixture.probeCount()).toBe(probesAtConnection);
  expect(fixture.requests).toEqual(['window_context', 'snapshot']);
});

test('a child exit blocks subsequent mutation on the established browser connection', async () => {
  const fixture = harness();
  await fixture.launch();
  fixture.child.exitCode = 0;
  await expect(fixture.invoke('workspace_save')).rejects.toThrow('Owned application');
  expect(fixture.requests).toEqual(['window_context']);
});

test('a listener replacement while CDP connects is rejected before IPC', async () => {
  const fixture = harness(true, true);
  await expect(fixture.launch()).rejects.toThrow('does not belong');
  expect(fixture.requests).toEqual([]);
});

test('a disconnected browser blocks mutation instead of reconnecting to a different listener', async () => {
  const fixture = harness();
  await fixture.launch();
  fixture.disconnect();
  await expect(fixture.invoke('workspace_save')).rejects.toThrow('disconnected');
  expect(fixture.requests).toEqual(['window_context']);
});

function ownerSnapshot(): NativeEndpointSnapshot {
  return { root: { pid: 4242, parentPid: 5000, executable: 'fresh-fixture/owned.exe', createdAt: '134058000000000000' },
    listener: { pid: 4343, addresses: ['127.0.0.1'], ancestors: [
      { pid: 4343, parentPid: 4242, createdAt: '134058000000000200' },
      { pid: 4242, parentPid: 5000, createdAt: '134058000000000000' },
    ] } };
}
const expected = { pid: 4242, parentPid: 5000, executable: 'fresh-fixture/owned.exe' };

test('listener ownership requires the actual root executable and spawn parent', () => {
  for (const root of [{ ...ownerSnapshot().root!, executable: 'other/owned.exe' }, { ...ownerSnapshot().root!, parentPid: 99 }]) {
    expect(() => assertNativeEndpointSnapshot({ ...ownerSnapshot(), root }, expected)).toThrow('does not belong');
  }
});

test('root and intermediate parent PID reuse fail ownership validation', () => {
  expect(() => assertNativeEndpointSnapshot(ownerSnapshot(), { ...expected, rootCreatedAt: '134057999999999999' })).toThrow('reused');
  const snapshot = ownerSnapshot();
  snapshot.listener!.ancestors[1].createdAt = '134058000000000300';
  expect(() => assertNativeEndpointSnapshot(snapshot, expected)).toThrow('reused parent PID');
});

test('a listener PID reused while connecting cannot preserve the earlier identity', () => {
  expect(() => assertNativeEndpointSnapshot(ownerSnapshot(), { ...expected, listenerPid: 4343,
    listenerCreatedAt: '134058000000000100' })).toThrow('listener PID was reused');
});

test('a non-loopback or broken process ancestry is rejected', () => {
  const external = ownerSnapshot(); external.listener!.addresses = ['0.0.0.0'];
  expect(() => assertNativeEndpointSnapshot(external, expected)).toThrow('loopback');
  const broken = ownerSnapshot(); broken.listener!.ancestors[0].parentPid = 17;
  expect(() => assertNativeEndpointSnapshot(broken, expected)).toThrow('ancestry');
});

test('a not-yet-listening owned process is retryable without accepting an endpoint', () => {
  expect(() => assertNativeEndpointSnapshot({ ...ownerSnapshot(), listener: null }, expected)).toThrow('not ready');
  try { assertNativeEndpointSnapshot({ ...ownerSnapshot(), listener: null }, expected); }
  catch (error) { expect((error as { code: string }).code).toBe('NATIVE_ENDPOINT_PENDING'); }
});

test('an exit during the OS probe rejects an otherwise valid snapshot', async () => {
  const child = { pid: 4242, exitCode: null as number | null, signalCode: null };
  await expect(assertOwnedNativeEndpoint(child as ChildProcess, { port: 41001, executable: expected.executable,
    probe: async () => { child.exitCode = 0; return ownerSnapshot(); } })).rejects.toThrow('exited during');
});


test('the OS probe validates its live child and preserves the established listener identity', async () => {
  const child = { pid: 4242, exitCode: null, signalCode: null };
  const result = await assertOwnedNativeEndpoint(child as ChildProcess, { port: 41001, executable: expected.executable,
    probe: async (file, _args, options) => {
      expect(file).toBe('powershell.exe');
      expect(options.env.NEWS_TERMINAL_OWNER_PID).toBe('4242');
      expect(options.env.NEWS_TERMINAL_OWNER_PORT).toBe('41001');
      const snapshot = ownerSnapshot(); snapshot.root!.parentPid = process.pid;
      return snapshot;
    } });
  expect(result).toEqual({ rootCreatedAt: '134058000000000000', listenerPid: 4343, listenerCreatedAt: '134058000000000200' });
});

function v05Connection(owned = true, changesDuringConnect = false) {
  const source = readFileSync(new URL('../scripts/v05-native-smoke.mjs', import.meta.url), 'utf8');
  const readiness = source.slice(source.indexOf('  await until(async () => { if (spawnError)'), source.indexOf('  // Track why the window disappears'));
  let currentOwner = owned;
  const requests: string[] = [];
  const page = {};
  const browser = { contexts: () => [{ pages: () => [page] }] };
  const context = vm.createContext({ spawnError: undefined, app: { pid: 4242, exitCode: null, signalCode: null },
    browser: null, main: null, port: 41001, run: {}, evidence: { launchedExecutable: 'fresh-fixture/owned.exe' },
    until: async (condition: () => Promise<boolean>) => { if (!await condition()) throw Error('Fixture not ready'); },
    ready: async () => {}, disconnectNativeBrowser: async () => {},
    chromium: { connectOverCDP: async () => { if (changesDuringConnect) currentOwner = false; return browser; } },
    assertOwnedNativeEndpoint: async (_child: unknown, options: object) => {
      const snapshot = ownerSnapshot();
      if (!currentOwner) snapshot.listener!.ancestors = [{ pid: 4343, parentPid: 9999, createdAt: '134058000000000200' }];
      return assertNativeEndpointSnapshot(snapshot, { ...expected, ...options });
    },
    invoke: async (_page: unknown, request: { op: string }) => { requests.push(request.op); return { label: 'main' }; },
  });
  return { requests, page, context, run: () => vm.runInContext(`(async () => { ${readiness} })()`, context) as Promise<unknown> };
}

test('packaged v05 CI rejects a wrong listener before its first native context read', async () => {
  const fixture = v05Connection(false);
  await expect(fixture.run()).rejects.toThrow('does not belong');
  expect(fixture.requests).toEqual([]);
});

test('packaged v05 CI checks that ownership survives the CDP connection', async () => {
  const fixture = v05Connection(true, true);
  await expect(fixture.run()).rejects.toThrow('does not belong');
  expect(fixture.requests).toEqual([]);
});

test('packaged v05 CI proceeds to its existing context readiness with the owned listener', async () => {
  const fixture = v05Connection();
  await fixture.run();
  expect(fixture.context.main).toBe(fixture.page);
  expect(fixture.requests).toEqual(['window_context']);
});
