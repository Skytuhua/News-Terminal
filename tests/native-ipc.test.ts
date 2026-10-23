import { afterEach, expect, test, vi } from 'vitest';
import { invokeNative } from '../scripts/native-ipc.mjs';
import type { Page } from '@playwright/test';

afterEach(() => vi.unstubAllGlobals());

function host() {
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke: async (_: string, { request }: {request: Record<string, unknown>}) => {
    requests.push(request);
    if (request.op === 'workspace_get') return { replacementToken: 'current' };
    if (request.op === 'source_update' && request.replacementToken !== 'current') throw new Error('Database replaced');
    return { ok: true };
  } } });
  return { requests, page: { evaluate: (fn: (r: Record<string, unknown>) => unknown, request: Record<string, unknown>) => fn(request) } as unknown as Page };
}

test('native setup writes use the current token without changing the caller request', async () => {
  const { page, requests } = host();
  const request = { op: 'source_update', sourceId: 'feed', enabled: false };
  expect(await invokeNative(page, request)).toEqual({ ok: true });
  expect(requests.map(r => r.op)).toEqual(['workspace_get', 'source_update']);
  expect(requests[1].replacementToken).toBe('current');
  expect(request).not.toHaveProperty('replacementToken');
});

test('native setup preserves explicit stale tokens and keeps reads to one call', async () => {
  const { page, requests } = host();
  await expect(invokeNative(page, { op: 'source_update', replacementToken: 'old' })).rejects.toThrow('Database replaced');
  expect(requests).toHaveLength(1);
  expect(await invokeNative(page, { op: 'snapshot' })).toEqual({ ok: true });
  expect(requests).toHaveLength(2);
});
