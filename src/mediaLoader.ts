import { dispatch, type Request } from './ipc';
import type { MediaResult } from './types';

type Observer = { resolve: (value: MediaResult) => void; reject: (reason: Error) => void };
type Job = { key: string; request: Request; started: boolean; cancelled: boolean; observers: Set<Observer> };
const queue: Job[] = [];
const jobs = new Map<string, Job>();
let running = 0;
function remove(job: Job) { if (jobs.get(job.key) === job) jobs.delete(job.key); }
function pump() {
  while (running < 2 && queue.length) {
    const job = queue.shift()!;
    if (job.cancelled) continue;
    job.started = true; running++;
    void dispatch<MediaResult>(job.request).then(value => {
      if (job.cancelled) return;
      const valid = value.kind === 'image' ? /^image\/png$/ : /^video\/(mp4|webm)$/;
      if (!["image", "video"].includes(value.kind) || !valid.test(value.mimeType) || !value.dataUrl.startsWith(`data:${value.mimeType};base64,`)) throw new Error('Unsupported media response. Open original instead.');
      remove(job);
      job.observers.forEach(observer => observer.resolve(value));
    }).catch(e => { remove(job); if (!job.cancelled) job.observers.forEach(observer => observer.reject(new Error(String(e)))); }).finally(() => {
      job.observers.clear(); remove(job); running--; pump();
    });
  }
}
/** No completed-byte cache; two shared IPC transfers and 32 waiting intents per window. */
export function loadMedia(request: Request) {
  const key = JSON.stringify(request);
  let job = jobs.get(key);
  let observer: Observer;
  const promise = new Promise<MediaResult>((resolve, reject) => {
    observer = { resolve, reject };
    if (!job) {
      if (queue.length >= 32) { reject(new Error('Image queue full. Open original instead.')); return; }
      job = { key, request: { ...request, requestId: crypto.randomUUID() }, started: false, cancelled: false, observers: new Set() };
      jobs.set(key, job); queue.push(job);
    }
    job.observers.add(observer); pump();
  });
  return { promise, cancel: () => {
    if (!job || !job.observers.delete(observer)) return;
    observer.reject(new Error('Media load cancelled'));
    if (job.observers.size || job.cancelled) return;
    job.cancelled = true; remove(job);
    const index = queue.indexOf(job); if (index >= 0) queue.splice(index, 1);
    if (job.started) void dispatch({ op: 'media_cancel', requestId: job.request.requestId }).catch(() => {});
  } };
}
