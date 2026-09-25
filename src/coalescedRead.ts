// Requests in one task share a read. Requests arriving during a read form a
// dirty follow-up, never reuse a snapshot that may predate their mutation.
export function coalescedRead(run: (reset: boolean) => Promise<void>) {
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let pending: { reset: boolean; immediate: boolean; resolve: () => void; reject: (error: unknown) => void }[] = [];
  function schedule() {
    if (scheduled || running) return;
    scheduled = setTimeout(() => { void flush(); }, 0);
  }
  async function flush() {
    clearTimeout(scheduled);
    scheduled = undefined;
    running = true;
    const batch = pending;
    pending = [];
    try {
      await run(batch.some(request => request.reset));
      batch.forEach(request => request.resolve());
    } catch (error) { batch.forEach(request => request.reject(error)); }
    finally {
      running = false;
      if (pending.some(request => request.immediate)) void flush();
      else if (pending.length) schedule();
    }
  }
  return (reset: boolean, immediate = false) => new Promise<void>((resolve, reject) => {
    pending.push({ reset, immediate, resolve, reject });
    if (immediate && !running) void flush();
    else schedule();
  });
}
