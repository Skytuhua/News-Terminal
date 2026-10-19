import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { workspaceSubscription } from "../src/workspaceSubscription";

const native = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
let subscribe: typeof import("../src/ipc").subscribe;

beforeEach(async () => {
  native.listen.mockReset();
  vi.stubGlobal("window", {});
  vi.resetModules();
  // No fixture dispatcher: exercise the real two-listener native IPC branch.
  ({ subscribe } = await import("../src/ipc"));
});
afterEach(() => vi.unstubAllGlobals());

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("reports setup ready after both native listeners are installed and releases each once", async () => {
  const changeRegistration = deferred<() => void>();
  const stopReplacement = vi.fn(), stopChange = vi.fn();
  native.listen.mockResolvedValueOnce(stopReplacement).mockReturnValueOnce(changeRegistration.promise);
  const changed = vi.fn(), ready = vi.fn(), failed = vi.fn();
  const stop = workspaceSubscription(subscribe, changed, ready, failed);

  await vi.waitFor(() => expect(native.listen).toHaveBeenCalledTimes(2));
  expect(native.listen.mock.calls.map(([event]) => event)).toEqual(["database-replaced", "data-changed"]);
  expect(ready).not.toHaveBeenCalled();
  changeRegistration.resolve(stopChange);
  await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
  native.listen.mock.calls[0][1]();
  native.listen.mock.calls[1][1]();
  expect(changed.mock.calls).toEqual([["replaced"], ["changed"]]);

  stop();
  stop();
  expect(stopReplacement).toHaveBeenCalledOnce();
  expect(stopChange).toHaveBeenCalledOnce();
  native.listen.mock.calls[0][1]();
  native.listen.mock.calls[1][1]();
  expect(changed).toHaveBeenCalledTimes(2);
  expect(failed).not.toHaveBeenCalled();
});

test("a failed first registration reports the error without opening the workspace", async () => {
  const error = new Error("First listener unavailable");
  native.listen.mockRejectedValueOnce(error);
  const ready = vi.fn(), failed = vi.fn();
  const stop = workspaceSubscription(subscribe, vi.fn(), ready, failed);
  await vi.waitFor(() => expect(failed).toHaveBeenCalledExactlyOnceWith(error));
  expect(native.listen).toHaveBeenCalledOnce();
  expect(ready).not.toHaveBeenCalled();
  stop();
});

test("a failed second registration releases the first native listener", async () => {
  const error = new Error("Second listener unavailable");
  const stopReplacement = vi.fn();
  native.listen.mockResolvedValueOnce(stopReplacement).mockRejectedValueOnce(error);
  const ready = vi.fn(), failed = vi.fn();
  const stop = workspaceSubscription(subscribe, vi.fn(), ready, failed);
  await vi.waitFor(() => expect(failed).toHaveBeenCalledExactlyOnceWith(error));
  expect(stopReplacement).toHaveBeenCalledOnce();
  expect(ready).not.toHaveBeenCalled();
  stop();
  expect(stopReplacement).toHaveBeenCalledOnce();
});

test("registration finishing after disposal releases both listeners without reading", async () => {
  const registration = deferred<() => void>();
  const stopReplacement = vi.fn(), stopChange = vi.fn();
  native.listen.mockReturnValueOnce(registration.promise).mockResolvedValueOnce(stopChange);
  const changed = vi.fn(), ready = vi.fn(), failed = vi.fn();
  const stop = workspaceSubscription(subscribe, changed, ready, failed);
  stop();
  native.listen.mock.calls[0][1]();
  registration.resolve(stopReplacement);
  await vi.waitFor(() => expect(stopChange).toHaveBeenCalledOnce());
  expect(stopReplacement).toHaveBeenCalledOnce();
  expect(changed).not.toHaveBeenCalled();
  expect(ready).not.toHaveBeenCalled();
  expect(failed).not.toHaveBeenCalled();
  stop();
  expect(stopReplacement).toHaveBeenCalledOnce();
  expect(stopChange).toHaveBeenCalledOnce();
});

test("a superseded registration cannot overwrite recovery with a stale rejection", async () => {
  const oldRegistration = deferred<() => void>();
  const stopOldReplacement = vi.fn(), stopReplacement = vi.fn(), stopChange = vi.fn();
  native.listen
    .mockResolvedValueOnce(stopOldReplacement).mockReturnValueOnce(oldRegistration.promise)
    .mockResolvedValueOnce(stopReplacement).mockResolvedValueOnce(stopChange);
  const changed = vi.fn(), oldReady = vi.fn(), ready = vi.fn(), failed = vi.fn();
  const stopOld = workspaceSubscription(subscribe, changed, oldReady, failed);
  await vi.waitFor(() => expect(native.listen).toHaveBeenCalledTimes(2));
  stopOld();
  const stop = workspaceSubscription(subscribe, changed, ready, failed);
  await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());

  oldRegistration.reject(new Error("Stale registration failure"));
  await vi.waitFor(() => expect(stopOldReplacement).toHaveBeenCalledOnce());
  native.listen.mock.calls[0][1]();
  native.listen.mock.calls[1][1]();
  native.listen.mock.calls[2][1]();
  native.listen.mock.calls[3][1]();
  expect(changed.mock.calls).toEqual([["replaced"], ["changed"]]);
  expect(oldReady).not.toHaveBeenCalled();
  expect(failed).not.toHaveBeenCalled();
  expect(stopReplacement).not.toHaveBeenCalled();
  expect(stopChange).not.toHaveBeenCalled();
  stop();
  expect(stopReplacement).toHaveBeenCalledOnce();
  expect(stopChange).toHaveBeenCalledOnce();
});
