import { beforeEach, expect, test, vi } from 'vitest';
const ipc = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock('../src/ipc', () => ipc);
beforeEach(() => { vi.resetModules(); ipc.dispatch.mockReset(); });
const image = { kind: 'image', mimeType: 'image/png', bytes: 1, dataUrl: 'data:image/png;base64,AA==' };
const request = { op:'media_load', profileId:'default', replacementToken:'epoch', articleId:'a', index:0, automatic:true };
test('shares an in-flight identity and only cancels the final observer', async () => {
  let finish!: (result:unknown) => void;
  ipc.dispatch.mockImplementation((r:any) => r.op === 'media_load' ? new Promise(resolve => {finish = resolve;}) : Promise.resolve({cancelled:true}));
  const { loadMedia } = await import('../src/mediaLoader');
  const first = loadMedia(request), second = loadMedia(request);
  expect(ipc.dispatch.mock.calls.filter(([r]) => r.op === 'media_load')).toHaveLength(1);
  void first.promise.catch(() => {});
  first.cancel();
  expect(ipc.dispatch.mock.calls.filter(([r]) => r.op === 'media_cancel')).toHaveLength(0);
  finish(image);
  await expect(second.promise).resolves.toEqual(image);
});
test('a new observer after delivery never joins an already resolved job', async () => {
  ipc.dispatch.mockResolvedValue(image);
  const { loadMedia } = await import('../src/mediaLoader');
  const first = loadMedia(request);
  const second = await first.promise.then(() => loadMedia(request));
  await expect(Promise.race([second.promise, new Promise(resolve => setTimeout(() => resolve('stuck'), 20))])).resolves.toEqual(image);
});
test('caps transfers at two, removes queued cancellations and rejects overflow', async () => {
  const pending: ((result:unknown) => void)[] = [];
  ipc.dispatch.mockImplementation((r:any) => r.op === 'media_load' ? new Promise(resolve => pending.push(resolve)) : Promise.resolve({cancelled:true}));
  const { loadMedia } = await import('../src/mediaLoader');
  const tasks = Array.from({length:35}, (_,index) => loadMedia({...request, articleId:String(index)}));
  tasks.forEach(task => { void task.promise.catch(() => {}); });
  expect(pending).toHaveLength(2);
  await expect(tasks[34].promise).rejects.toThrow('queue full');
  tasks.slice(2).forEach(task => task.cancel());
  pending.forEach(resolve => resolve(image));
  await Promise.all(tasks.slice(0,2).map(task => task.promise));
  await new Promise(resolve => setTimeout(resolve,0));
  expect(pending).toHaveLength(2);
});
