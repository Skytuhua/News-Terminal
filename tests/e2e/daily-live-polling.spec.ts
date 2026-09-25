import { test, expect, type Page } from "@playwright/test";
import { fixture } from "./fixture";

async function openLive(page: Page, connected = false, itemCount = 1) {
  await fixture(page, { v02: true });
  if (connected) await page.evaluate(async itemCount => {
    const current = await window.__NEWS_TEST_DISPATCH__!({ op: "live_set", enabled: true }) as any;
    (window as any).__LIVE_ITEMS__ = Array.from({ length: itemCount - 1 }, (_, index) => ({
      ...current.items[0], id: `extra-${index}`, title: `Additional discussion ${index}`,
    }));
  }, itemCount);
  await page.getByRole("button", { name: "Live discussion", exact: true }).click();
  await expect(page.getByText(connected ? "Stream connected" : "Stream off", { exact: true })).toBeVisible();
}

const statusCalls = (page: Page) => page.evaluate(() =>
  (window as any).__TEST_CALLS__.filter((request: any) => request.op === "live_status").length);

async function visibility(page: Page, state: "hidden" | "visible") {
  await page.evaluate(state => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

// Real elapsed browser time, excluding the mount read; no native CPU/battery inference.
test("visible off: bounded status reads still detect a remote connect", async ({ page }, info) => {
  await openLive(page);
  const before = await statusCalls(page);
  const started = performance.now();
  await page.waitForTimeout(5200);
  const calls = await statusCalls(page) - before;
  const measurement = { state: "off", windows: 1, elapsedMs: performance.now() - started, calls };
  console.log(JSON.stringify(measurement));
  await info.attach("visible-off-calls", { body: JSON.stringify(measurement), contentType: "application/json" });
  expect(calls).toBe(1);
  await page.evaluate(() => window.__NEWS_TEST_DISPATCH__!({ op: "live_set", enabled: true }));
  await expect(page.getByText("Stream connected", { exact: true })).toBeVisible({ timeout: 6000 });
  await expect(page.locator(".live-row")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /received items · Show latest/ })).toHaveCount(0);
});

for (const trigger of ["visibility", "focus"] as const) {
  test(`${trigger} restoration rechecks an off stream immediately`, async ({ page }) => {
    await openLive(page);
    if (trigger === "visibility") await visibility(page, "hidden");
    await page.evaluate(() => window.__NEWS_TEST_DISPATCH__!({ op: "live_set", enabled: true }));
    const before = await statusCalls(page);
    if (trigger === "visibility") await visibility(page, "visible");
    else await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    expect(await statusCalls(page)).toBe(before + 1);
    await expect(page.getByText("Stream connected", { exact: true })).toBeVisible();
    await expect(page.locator(".live-row")).toHaveCount(1);
  });
}

test("unchanged items skip row formatting while metadata, removal and deferred arrivals stay live", async ({ page }) => {
  await openLive(page, true);
  await page.evaluate(async () => {
    const w = window as any;
    const current = await window.__NEWS_TEST_DISPATCH__!({ op: "live_status" }) as any;
    const published = Date.parse(current.items[0].publishedAt);
    const original = Date.prototype.toLocaleString;
    w.__ROW_FORMATS__ = 0;
    Date.prototype.toLocaleString = function (...args: Parameters<Date["toLocaleString"]>) {
      if (this.getTime() === published) ++w.__ROW_FORMATS__;
      return original.apply(this, args);
    };
  });
  const before = await statusCalls(page);
  await expect.poll(() => statusCalls(page)).toBeGreaterThan(before);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => (window as any).__ROW_FORMATS__)).toBe(0);

  await page.evaluate(async () => {
    const current = await window.__NEWS_TEST_DISPATCH__!({ op: "live_status" }) as any;
    (window as any).__LIVE_ITEMS__ = [{ ...current.items[0], id: "later", title: "Later discussion" }];
  });
  const latest = page.getByRole("button", { name: "1 received items · Show latest", exact: true });
  await expect(latest).toBeVisible();
  await expect(page.locator(".live-row")).toHaveCount(1);
  await latest.click();
  await expect(page.locator(".live-row")).toHaveCount(2);
  await page.evaluate(() => {
    (window as any).__LIVE_ITEMS__ = [{ ...(window as any).__LIVE_ITEMS__[0],
      title: "Corrected discussion", by: "updated-author", score: 99,
      url: "https://example.org/corrected", discussionUrl: "https://news.ycombinator.com/item?id=2",
      publishedAt: null, receivedAt: "2026-09-24T10:00:00Z",
    }];
  });
  const changed = page.locator(".live-row").filter({ hasText: "Corrected discussion" });
  await expect(changed).toContainText("updated-author · 99 points");
  await expect(changed).toContainText("Published Time unavailable");
  await changed.getByRole("button", { name: "Open linked original" }).click();
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) => r.op === "open_original").at(-1).url)).toBe("https://example.org/corrected");
  await page.evaluate(() => { (window as any).__LIVE_ITEMS__ = []; });
  await expect(page.locator(".live-row")).toHaveCount(1);
});

test("hidden connected view backs off without stopping the shared stream", async ({ page }, info) => {
  await openLive(page, true);
  await visibility(page, "hidden");
  const before = await statusCalls(page);
  const started = performance.now();
  await page.waitForTimeout(5200);
  const calls = await statusCalls(page) - before;
  const measurement = { state: "connected", visibility: "synthetic-hidden", elapsedMs: performance.now() - started, calls };
  console.log(JSON.stringify(measurement));
  await info.attach("hidden-calls", { body: JSON.stringify(measurement), contentType: "application/json" });
  expect(calls).toBe(1);
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) => r.op === "live_set"))).toEqual([{ op: "live_set", enabled: true, apiKey: undefined }]);
  await expect(page.getByText("Stream connected", { exact: true })).toBeVisible();
});

for (const scenario of [{ connected: false, windows: 3 }, { connected: true, windows: 1 }, { connected: true, windows: 3 }]) {
  test(`visible ${scenario.connected ? "connected" : "off"}: measured ${scenario.windows}-window polling`, async ({ browser }, info) => {
    const contexts = await Promise.all(Array.from({ length: scenario.windows }, () => browser.newContext({ baseURL: info.project.use.baseURL })));
    try {
      const pages = await Promise.all(contexts.map(context => context.newPage()));
      await Promise.all(pages.map(page => openLive(page, scenario.connected, 100)));
      expect(await Promise.all(pages.map(page => page.evaluate(() => document.visibilityState)))).toEqual(pages.map(() => "visible"));
      if (scenario.connected) await Promise.all(pages.map(page => expect(page.locator(".live-row")).toHaveCount(100)));
      const before = await Promise.all(pages.map(statusCalls));
      const started = performance.now();
      await pages[0].waitForTimeout(5200);
      const after = await Promise.all(pages.map(statusCalls));
      const callsPerWindow = after.map((count, index) => count - before[index]);
      const measurement = { state: scenario.connected ? "connected" : "off", windows: scenario.windows,
        rows: scenario.connected ? 100 : 0, elapsedMs: performance.now() - started, callsPerWindow,
        calls: callsPerWindow.reduce((sum, count) => sum + count, 0) };
      console.log(JSON.stringify(measurement));
      await info.attach("visible-calls", { body: JSON.stringify(measurement), contentType: "application/json" });
      for (const count of callsPerWindow) {
        if (scenario.connected) { expect(count).toBeGreaterThanOrEqual(4); expect(count).toBeLessThanOrEqual(6); }
        else expect(count).toBe(1);
      }
    } finally { await Promise.all(contexts.map(context => context.close())); }
  });
}

test("failed reads keep checked time and rows honest; focus recovers", async ({ page }) => {
  await openLive(page, true);
  const checked = page.locator(".live-status dl > div").filter({ hasText: "Local status checked" }).locator("dd");
  const before = await checked.textContent();
  await page.evaluate(() => { (window as any).__FAIL_OP__ = "live_status"; window.dispatchEvent(new Event("focus")); });
  await expect(page.getByRole("alert")).toContainText("Displayed items may be stale");
  await expect(checked).toHaveText(before!);
  await expect(page.locator(".live-row")).toHaveCount(1);
  await page.waitForTimeout(1100);
  await page.evaluate(() => { (window as any).__FAIL_OP__ = undefined; window.dispatchEvent(new Event("focus")); });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(checked).not.toHaveText(before!);
});

test("focus bursts do not overlap status reads and unmount removes wake listeners", async ({ page }) => {
  await openLive(page, true);
  const before = await statusCalls(page);
  await page.evaluate(() => {
    const w = window as any;
    let held = false;
    w.__TEST_BEFORE_DISPATCH__ = (request: any) => {
      if (request.op === "live_status" && !held) {
        held = true;
        return new Promise(resolve => { w.__RELEASE_LIVE__ = resolve; });
      }
    };
    for (let i = 0; i < 10; i++) window.dispatchEvent(new Event("focus"));
  });
  expect(await statusCalls(page)).toBe(before + 1);
  await page.getByRole("button", { name: "All headlines", exact: true }).click();
  await expect(page.getByLabel("Search cached stories")).toBeVisible();
  await page.evaluate(() => { (window as any).__RELEASE_LIVE__(); window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForTimeout(5200);
  expect(await statusCalls(page)).toBe(before + 1);
});
