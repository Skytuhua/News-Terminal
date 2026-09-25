import { test, expect, type Page } from "@playwright/test";
import { fixture } from "./fixture";

test("review: an open reader clears generated output and loaded media on authoritative corrections", async ({ page }, info) => {
  await fixture(page, { v02: true });
  await enableProvider(page);
  await page.getByRole("button", { name: "Researchers map a new lunar water reserve", exact: true }).click();
  await page.getByRole("button", { name: "Load image 1", exact: true }).click();
  await expect(page.getByAltText("Fixture lunar image")).toBeVisible();
  await page.getByRole("button", { name: "Summarize excerpt", exact: true }).click();
  await expect(page.getByText("Fixture summary of the lunar observations.")).toBeVisible();
  await page.evaluate(() => {
    const w = window as any;
    const s = w.__TEST_SNAPSHOT__();
    // Revisions can share a timestamp; compare actual inputs, not only updatedAt.
    w.__TEST_PATCH__({
      articles: s.articles.map((a: any) => ({ ...a, excerpt: "Corrected publisher input." })),
      sources: s.sources.map((s: any) => ({ ...s, mediaAllowed: false })),
    });
    window.dispatchEvent(new Event("data-changed"));
  });
  await expect(page.getByText("Corrected publisher input.", { exact: true })).toBeVisible();
  await expect(page.getByText("Fixture summary of the lunar observations.")).toHaveCount(0);
  await expect(page.getByAltText("Fixture lunar image")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Load image 1", exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("reader-corrected.png"), fullPage: true });
});

for (const delay of ["before-write", "after-write"] as const) {
  test(`review: profile switches serialize ${delay} and reconcile native scope`, async ({ page }, info) => {
    await fixture(page, { v02: true, savedProfile: true });
    await expect(page.getByLabel("Reading profile")).toHaveValue("desk-b");
    await page.evaluate(delay => {
      const w = window as any;
      const hold = async (r: any) => {
        if (r.op === "window_set_profile" && r.profileId === "default")
          await new Promise<void>(resolve => { w.__RELEASE_PROFILE__ = resolve; });
      };
      if (delay === "before-write") w.__TEST_BEFORE_DISPATCH__ = hold;
      else w.__TEST_AFTER_PROFILE_WRITE__ = hold;
    }, delay);
    await page.getByLabel("Reading profile").selectOption("default");
    await expect.poll(() => page.evaluate(() => typeof (window as any).__RELEASE_PROFILE__)).toBe("function");
    await expect(page.getByLabel("Reading profile")).toBeDisabled();
    // Even a queued/synthetic change cannot start an overlapping native write.
    await page.getByLabel("Reading profile").evaluate((select: HTMLSelectElement) => {
      select.value = "desk-b";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) => r.op === "window_set_profile").map((r: any) => r.profileId))).toEqual(["default"]);
    await page.evaluate(() => (window as any).__RELEASE_PROFILE__());
    await expect(page.getByLabel("Reading profile")).toBeEnabled();
    await expect(page.getByLabel("Reading profile")).toHaveValue("default");
    await page.getByLabel("Reading profile").selectOption("desk-b");
    await expect(page.getByLabel("Reading profile")).toBeEnabled();
    await expect(page.getByLabel("Reading profile")).toHaveValue("desk-b");
    await page.getByRole("button", { name: "Researchers map a new lunar water reserve", exact: true }).click();
    await page.getByRole("button", { name: "Save story", exact: true }).click();
    await expect(page.getByRole("button", { name: "Unsave story", exact: true })).toBeVisible();
    const final = await page.evaluate(async () => {
      const w = window as any;
      return { host: await w.__NEWS_TEST_DISPATCH__({ op: "window_context" }),
        snapshot: w.__TEST_SNAPSHOT__().profile.id,
        mutation: w.__TEST_CALLS__.filter((r: any) => r.op === "article_state").at(-1).profileId,
        persisted: localStorage.getItem("fixture-main-profile") };
    });
    expect([final.host.profileId, final.snapshot, final.mutation, final.persisted]).toEqual(["desk-b", "desk-b", "desk-b", "desk-b"]);
    await page.screenshot({ path: info.outputPath("profile-reconciled.png"), fullPage: true });
    await page.reload();
    await expect(page.getByLabel("Reading profile")).toHaveValue("desk-b");
  });
}

test("review: unknown live status keeps an unconditional disconnect without false off claims", async ({ page }, info) => {
  await fixture(page, { v02: true });
  await page.getByRole("button", { name: "Live discussion", exact: true }).click();
  await page.getByRole("button", { name: "Connect HN stream" }).click();
  await expect(page.getByText("Stream connected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "All headlines", exact: true }).click();
  await expect(page.getByLabel("Search cached stories")).toBeVisible();
  await page.evaluate(() => {
    const w = window as any;
    w.__FAIL_OP__ = "live_status";
    w.__TEST_BEFORE_DISPATCH__ = (r: any) => {
      if (r.op === "live_set") throw new Error("Fixture stop failed");
    };
  });
  await page.getByRole("button", { name: "Live discussion", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Live status unavailable");
  await expect(page.getByText("Live stream is off", { exact: true })).toHaveCount(0);
  const stop = page.getByRole("button", { name: "Disconnect stream", exact: true });
  await expect(stop).toBeEnabled();
  await stop.click();
  await expect(page.getByText(/Action failed: Error: Fixture stop failed/)).toBeVisible();
  await expect(page.getByText("Live stream is off", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Stream status unknown", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("live-unknown-disconnect.png"), fullPage: true });
  await page.evaluate(() => { (window as any).__TEST_BEFORE_DISPATCH__ = undefined; });
  await stop.click();
  await expect(page.getByText("Live stream is off", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) => r.op === "live_set").at(-1).enabled)).toBe(false);
  // The mutation's returned snapshot confirms stop even if reads remain down.
  await page.evaluate(() => { (window as any).__FAIL_OP__ = undefined; });
  expect(await page.evaluate(async () => (await (window as any).__NEWS_TEST_DISPATCH__({ op: "live_status" })).enabled)).toBe(false);
});

for (const control of ["same-view", "remote-window"] as const) {
  test(`review: ${control} reconnect accepts its initial snapshot then defers new arrivals`, async ({ page }, info) => {
    await fixture(page, { v02: true });
    await page.getByRole("button", { name: "Live discussion", exact: true }).click();
    await page.getByRole("button", { name: "Connect HN stream" }).click();
    await expect(page.locator(".live-row")).toHaveCount(1);
    if (control === "same-view") await page.getByRole("button", { name: "Disconnect stream" }).click();
    else await page.evaluate(() => (window as any).__NEWS_TEST_DISPATCH__({ op: "live_set", enabled: false }));
    await expect(page.getByText("Live stream is off", { exact: true })).toBeVisible();
    await expect(page.locator(".live-row")).toHaveCount(0);
    if (control === "same-view") await page.getByRole("button", { name: "Connect HN stream" }).click();
    else await page.evaluate(() => (window as any).__NEWS_TEST_DISPATCH__({ op: "live_set", enabled: true }));
    await expect(page.getByText("Stream connected", { exact: true })).toBeVisible();
    await expect(page.locator(".live-row")).toHaveCount(1);
    await expect(page.getByText("Waiting for discussion items", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /received items · Show latest/ })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("live-reconnected.png"), fullPage: true });
    await page.evaluate(async () => {
      const w = window as any;
      const current = await w.__NEWS_TEST_DISPATCH__({ op: "live_status" });
      w.__LIVE_ITEMS__ = [{ ...current.items[0], id: "later", title: "Later fixture discussion" }];
    });
    const latest = page.getByRole("button", { name: "1 received items · Show latest", exact: true });
    await expect(latest).toBeVisible();
    await expect(page.locator(".live-row")).toHaveCount(1);
    await latest.click();
    await expect(page.locator(".live-row")).toHaveCount(2);
  });
}

test("review: workspace tabs have roving arrows panel relationships and close focus restoration", async ({ page }, info) => {
  await fixture(page, { v02: true });
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await page.getByRole("button", { name: "Others", exact: true }).click();
  await page.getByRole("button", { name: "Science", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Science", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await page.getByRole("button", { name: "Daily briefing", exact: true }).click();
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(3);
  const first = tabs.nth(0), second = tabs.nth(1), last = tabs.nth(2);
  await first.focus();
  await first.press("ArrowRight");
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[role=tab][tabindex="0"]')).toHaveCount(1);
  await expect(first).toHaveAttribute("tabindex", "-1");
  await second.press("End");
  await expect(last).toBeFocused();
  await expect(last).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Daily briefing", exact: true })).toBeVisible();
  await last.press("ArrowRight");
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute("aria-selected", "true");
  await first.press("ArrowLeft");
  await expect(last).toBeFocused();
  await expect(last).toHaveAttribute("aria-selected", "true");
  await last.press("Home");
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute("aria-selected", "true");
  const links = await tabs.evaluateAll(elements => elements.map(tab => {
    const panel = document.getElementById(tab.getAttribute("aria-controls") || "");
    return { exists: !!panel, role: panel?.getAttribute("role"), labelled: panel?.getAttribute("aria-labelledby") === tab.id };
  }));
  expect(links).toEqual(Array.from({ length: 3 }, () => ({ exists: true, role: "tabpanel", labelled: true })));
  await page.keyboard.press("Control+Tab");
  await expect(second).toHaveAttribute("aria-selected", "true");
  const close = page.getByRole("button", { name: "Close Science tab", exact: true });
  await close.focus();
  await close.press("Enter");
  await expect(tabs).toHaveCount(2);
  await expect(page.getByRole("tab", { selected: true })).toBeFocused();
  await expect(page.locator('[role=tab][tabindex="0"]')).toHaveCount(1);
  await expect(page.getByRole("tabpanel")).toHaveCount(1);
  await page.screenshot({ path: info.outputPath("tabs-keyboard.png"), fullPage: true });
});

test("review: reader and generated summary visibly cite literal original URLs through native open", async ({ page }, info) => {
  await fixture(page, { v02: true });
  await enableProvider(page);
  await page.getByRole("button", { name: "Researchers map a new lunar water reserve", exact: true }).click();
  const readerUrl = page.locator(".detail-body").getByRole("link", { name: "https://example.org/moon", exact: true });
  await expect(readerUrl).toBeVisible();
  await readerUrl.click();
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) => r.op === "open_original").at(-1)?.url)).toBe("https://example.org/moon");
  await page.getByRole("button", { name: "Summarize excerpt", exact: true }).click();
  const output = page.locator(".summary-output");
  await expect(output.getByRole("link", { name: "https://example.org/moon", exact: true })).toBeVisible();
  await expect(output.getByText("Fixture source attribution", { exact: true })).toBeVisible();
  await expect(output.getByText("Fixture generated analysis; not an official agency product.", { exact: true })).toBeVisible();
  await expect(output.getByText("Headline-only input — the feed does not contain the full statement.", { exact: true })).toBeVisible();
  await output.getByRole("link", { name: "https://example.org/moon", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) => r.op === "open_original").length)).toBe(2);
  await page.screenshot({ path: info.outputPath("reader-summary-visible-urls.png"), fullPage: true });
  await page.evaluate(() => {
    const w = window as any;
    const s = w.__TEST_SNAPSHOT__();
    w.__TEST_PATCH__({ articles: s.articles.map((a: any) => ({ ...a, aiAllowed: false })) });
    window.dispatchEvent(new Event("data-changed"));
  });
  await expect(page.getByText("This item is not eligible for AI processing under the current source and item permissions.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Summarize excerpt", exact: true })).toBeDisabled();
});

test("review: media status distinguishes explicit loading from loaded bytes", async ({ page }, info) => {
  await fixture(page, { v02: true });
  await page.getByRole("button", { name: "Researchers map a new lunar water reserve", exact: true }).click();
  const slot = page.locator(".media-slot").first();
  await expect(slot.locator(".media-label")).toContainText("Click to load");
  await page.evaluate(() => {
    const w = window as any;
    w.__TEST_BEFORE_DISPATCH__ = async (r: any) => {
      if (r.op === "media_load") await new Promise<void>(resolve => { w.__RELEASE_MEDIA__ = resolve; });
    };
  });
  await page.getByRole("button", { name: "Load image 1", exact: true }).click();
  await expect(slot.locator(".media-label")).toContainText("Loading…");
  await page.evaluate(() => (window as any).__RELEASE_MEDIA__());
  await expect(page.getByAltText("Fixture lunar image")).toBeVisible();
  await expect(slot.locator(".media-label")).toContainText("Loaded");
  await expect(slot.locator(".media-label")).not.toContainText("Click to load");
  await slot.screenshot({ path: info.outputPath("media-loaded.png") });
});

async function enableProvider(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    const s = w.__TEST_SNAPSHOT__();
    w.__TEST_PATCH__({ providers: s.providers.map((p: any) => ({ ...p, enabled: true, consented: true })) });
    window.dispatchEvent(new Event("data-changed"));
  });
}

test("review: briefing invalidates authoritative input and permission before delayed readback", async ({ page }, info) => {
  await fixture(page, { v02: true });
  await enableProvider(page);
  await page.getByRole("button", { name: "Daily briefing", exact: true }).click();
  await page.getByText("Optional AI summaries · per story", { exact: true }).click();
  await page.getByRole("button", { name: "Summarize excerpt", exact: true }).first().click();
  await expect(page.getByText("Fixture summary of the lunar observations.")).toBeVisible();
  // A workspace-only refresh must not remount the open summary or reload the brief.
  const calls = await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) => r.op === "daily_brief").length);
  await page.evaluate(() => window.dispatchEvent(new Event("data-changed")));
  await expect(page.getByText("Fixture summary of the lunar observations.")).toBeVisible();
  await page.evaluate(() => {
    const w = window as any;
    w.__TEST_BEFORE_DISPATCH__ = async (r: any) => {
      if (r.op === "daily_brief") await new Promise<void>(resolve => { w.__RELEASE_BRIEF__ = resolve; });
    };
    const s = w.__TEST_SNAPSHOT__();
    w.__TEST_PATCH__({ articles: s.articles.map((a: any) => ({ ...a, aiAllowed: false, excerpt: "", media: [] })) });
    window.dispatchEvent(new Event("data-changed"));
  });
  await expect(page.getByText("A research team has published its observations of water near the lunar south pole.", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Fixture summary of the lunar observations.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Summarize excerpt", exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => typeof (window as any).__RELEASE_BRIEF__)).toBe("function");
  await page.evaluate(() => (window as any).__RELEASE_BRIEF__());
  await expect(page.getByText("No stories in this sector have permission for AI processing.")).toBeAttached();
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) => r.op === "daily_brief").length)).toBe(calls + 1);
  await page.screenshot({ path: info.outputPath("briefing-revoked.png"), fullPage: true });
});
