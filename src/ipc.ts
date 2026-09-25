import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
export type Request = { op: string; [key: string]: unknown };
export type WindowContext = {
  label: string;
  detached: boolean;
  profileId?: string;
  tabId?: string;
  detachedTabs?: { profileId: string; tabId: string; label: string }[];
};
declare global {
  interface Window {
    __NEWS_TEST_DISPATCH__?: (request: Request) => Promise<unknown>;
  }
}
// The injection seam is compiled away in production; fixture data lives only in tests.
const testDispatch =
  import.meta.env.MODE === "test" ? window.__NEWS_TEST_DISPATCH__ : undefined;
export const runtimeAvailable = isTauri() || !!testDispatch;
export async function dispatch<T = unknown>(request: Request): Promise<T> {
  if (testDispatch) return (await testDispatch(request)) as T;
  if (!isTauri()) throw new Error("Desktop runtime required");
  return invoke<T>("dispatch", { request });
}
export async function subscribe(callback: (kind: "changed" | "replaced") => void) {
  const changed = () => callback("changed");
  const replaced = () => callback("replaced");
  if (testDispatch) {
    window.addEventListener("data-changed", changed);
    window.addEventListener("database-replaced", replaced);
    return () => { window.removeEventListener("data-changed", changed); window.removeEventListener("database-replaced", replaced); };
  }
  const stopReplacement = await listen("database-replaced", replaced);
  try {
    const stopChange = await listen("data-changed", changed);
    return () => { stopReplacement(); stopChange(); };
  } catch (error) { stopReplacement(); throw error; }
}
