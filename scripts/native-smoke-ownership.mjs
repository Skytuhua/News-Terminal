// Bind a loopback CDP listener to one freshly spawned native fixture before IPC.
import assert from 'node:assert/strict';
import { win32 } from 'node:path';
import { nativeCommandJson } from './native-process-cleanup.mjs';

const processTime = value => {
  assert.match(String(value), /^[0-9]{15,20}$/, 'Invalid native process creation time');
  return BigInt(value);
};
const live = child => child?.pid > 0 && child.exitCode === null && child.signalCode === null;

export function assertNativeEndpointSnapshot(snapshot, expected) {
  const root = snapshot.root;
  assert.ok(root?.pid === expected.pid && root.parentPid === expected.parentPid
    && typeof root.executable === 'string'
    && win32.resolve(root.executable).toLowerCase() === win32.resolve(expected.executable).toLowerCase(),
  'Debug listener does not belong to the owned application');
  processTime(root.createdAt);
  if (expected.rootCreatedAt) assert.equal(root.createdAt, expected.rootCreatedAt, 'Owned application PID was reused');
  const listener = snapshot.listener;
  if (!listener) {
    const error = Error('Owned debug listener is not ready');
    error.code = 'NATIVE_ENDPOINT_PENDING';
    throw error;
  }
  assert.ok(listener.addresses?.length > 0 && listener.addresses.every(address => ['127.0.0.1', '::1'].includes(address)),
    'Native debug listener must bind only to loopback');
  let nextPid = listener.pid, previousTime;
  const seen = new Set();
  for (const process of listener.ancestors || []) {
    assert.ok(process.pid === nextPid && !seen.has(process.pid), 'Debug listener ancestry is invalid');
    seen.add(process.pid);
    const createdAt = processTime(process.createdAt);
    assert.ok(previousTime === undefined || previousTime >= createdAt, 'Debug listener ancestry contains a reused parent PID');
    previousTime = createdAt;
    if (process.pid === root.pid) {
      assert.equal(process.createdAt, root.createdAt, 'Debug listener ancestry contains a reused root PID');
      const identity = { rootCreatedAt: root.createdAt, listenerPid: listener.pid,
        listenerCreatedAt: listener.ancestors[0].createdAt };
      if (expected.listenerPid !== undefined) {
        assert.equal(identity.listenerPid, expected.listenerPid, 'Debug listener changed during connection');
        assert.equal(identity.listenerCreatedAt, expected.listenerCreatedAt, 'Debug listener PID was reused');
      }
      return identity;
    }
    nextPid = process.parentPid;
  }
  throw Error('Debug listener does not belong to the owned application');
}

const probeScript = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$rootId = [int]$env:NEWS_TERMINAL_OWNER_PID
$portNumber = [int]$env:NEWS_TERMINAL_OWNER_PORT
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $portNumber -ErrorAction SilentlyContinue)
$processes = @{}
foreach ($entry in Get-CimInstance Win32_Process) { $processes[[int]$entry.ProcessId] = $entry }
function Record($entry) {
  if (-not $entry) { return $null }
  @{ pid = [int]$entry.ProcessId; parentPid = [int]$entry.ParentProcessId
     createdAt = $entry.CreationDate.ToUniversalTime().ToFileTimeUtc().ToString() }
}
$root = Record $processes[$rootId]
if ($root) { $root.executable = $processes[$rootId].ExecutablePath }
$listener = $null
if ($listeners.Count) {
  $owners = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
  if ($owners.Count -ne 1) { throw 'More than one process owns the selected debug port.' }
  $nextId = [int]$owners[0]; $ancestors = @(); $seen = @{}
  while ($nextId -gt 0 -and $ancestors.Count -lt 16 -and -not $seen.ContainsKey($nextId)) {
    $seen[$nextId] = $true
    $entry = $processes[$nextId]
    if (-not $entry) { break }
    $ancestors += (Record $entry)
    if ($nextId -eq $rootId) { break }
    $nextId = [int]$entry.ParentProcessId
  }
  $listener = @{ pid = [int]$owners[0]; addresses = @($listeners | Select-Object -ExpandProperty LocalAddress -Unique)
                 ancestors = @($ancestors) }
}
@{ root = $root; listener = $listener } | ConvertTo-Json -Depth 5 -Compress
`;

export async function assertOwnedNativeEndpoint(child, { port, executable, rootCreatedAt, listenerPid,
  listenerCreatedAt, probe = nativeCommandJson } = {}) {
  assert.ok(live(child), 'Owned application is not running');
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, 'Invalid native debug port');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['PSMODULEPATH', 'NEWS_TERMINAL_OWNER_PID', 'NEWS_TERMINAL_OWNER_PORT'].includes(key.toUpperCase())));
  env.NEWS_TERMINAL_OWNER_PID = String(child.pid);
  env.NEWS_TERMINAL_OWNER_PORT = String(port);
  const snapshot = await probe('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', probeScript], { env, timeout: 10000 });
  assert.ok(live(child), 'Owned application exited during endpoint verification');
  return assertNativeEndpointSnapshot(snapshot, { pid: child.pid, parentPid: process.pid, executable,
    rootCreatedAt, listenerPid, listenerCreatedAt });
}
