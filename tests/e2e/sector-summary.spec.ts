import { test, expect, type Page } from "@playwright/test";
import { fixture } from "./fixture";

const combined = (page: Page) => page.getByRole("region", { name: "Science source quotations", exact: true });
async function openBriefing(page: Page, ready = true, savedProfile = false) {
  await fixture(page, { v02: true, savedProfile });
  if (ready) await page.evaluate(() => {
    const w = window as any;
    const s = w.__TEST_SNAPSHOT__();
    w.__TEST_PATCH__({ providers: s.providers.map((p: any) => ({ ...p, enabled: true, consented: true })) });
    window.dispatchEvent(new Event("data-changed"));
  });
  await page.getByRole("button", { name: "Daily briefing", exact: true }).click();
}

test("sector quotation disclosure explains selection without implying verified facts", async ({ page }) => {
  await openBriefing(page);
  const panel = combined(page);
  await expect(panel.getByText("AI selects exact passages from individual source inputs; it does not combine them into a paraphrase or verify facts.", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Generate sector summary", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "AI-selected source quotations · unverified", exact: true })).toBeVisible();
  await expect(panel.getByText(/not factual entailment, context or truth/)).toBeVisible();
  const bullets = panel.locator(".sector-summary-bullets > li");
  await expect(bullets).toHaveCount(2);
  await expect(bullets.nth(0).locator("q")).toHaveText("A research team has published its observations of water near the lunar south pole.");
  await expect(bullets.nth(1).locator("q")).toHaveText("What lunar water observations can tell us");
  for (let i = 0; i < 2; i++) {
    await expect(bullets.nth(i).locator("q")).toHaveCount(1);
    await expect(bullets.nth(i).getByRole("link", { name: new RegExp(`^S${i + 1} ·`) })).toHaveCount(1);
  }
});

test("sector generation renders cited bullets and host-owned originals with agency notices", async ({ page }, info) => {
  await openBriefing(page);
  const panel = combined(page);
  await panel.getByRole("button", { name: "Generate sector summary", exact: true }).click();
  await expect(panel.locator(".sector-summary-bullets").getByText("A research team has published its observations of water near the lunar south pole.", { exact: true })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "AI-selected source quotations · unverified" })).toBeVisible();
  await expect(panel.getByText("AI-selected quotations, unverified. Exact text and source IDs were checked mechanically, not factual entailment, context or truth. Excerpts may be incomplete. Check the original sources.")).toBeVisible();
  for (const id of ["S1", "S2"]) {
    await expect(panel.getByRole("link", { name: new RegExp(`^${id} ·`) })).toBeVisible();
  }
  await panel.getByRole("link", { name: /^S2 ·/ }).click();
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) => r.op === "open_original").at(-1)?.url)).toBe("https://example.org/moon-review");
  await expect(panel.getByText("Headline-only input", { exact: true })).toBeVisible();
  await expect(panel.getByText("Feed excerpt input", { exact: true })).toBeVisible();
  await expect(panel.getByText("Fixture source attribution", { exact: true })).toHaveCount(2);
  await expect(panel.getByText("Fixture generated analysis; not an official agency product.", { exact: true })).toHaveCount(2);
  await expect(panel.getByRole("link", { name: "https://example.org/moon", exact: true })).toBeVisible();
  const request = await page.evaluate(() => (window as any).__TEST_CALLS__.find((r: any) => r.op === "sector_summarize"));
  expect(request).toMatchObject({ profileId: "default", date: "2026-09-23", sectorId: "science" });
  expect(request.fingerprint).toContain("fixture:default:2026-09-23:");
  expect(request.requestId).toBeTruthy();
  expect(request).not.toHaveProperty("sources");
  await panel.screenshot({ path: info.outputPath("combined-generated.png") });
});

test("sector cancellation discards late delivery and allows an explicit retry", async ({ page }) => {
  await openBriefing(page);
  await page.evaluate(() => {
    const w = window as any;
    w.__TEST_BEFORE_DISPATCH__ = async (r: any) => {
      if (r.op === "sector_summarize") await new Promise<void>(resolve => { w.__RELEASE_SECTOR__ = resolve; });
    };
  });
  const panel = combined(page);
  await panel.getByRole("button", { name: "Generate sector summary", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Selecting source quotations…");
  await panel.getByRole("button", { name: "Cancel sector summary", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Sector summary cancelled. Any late result will be discarded.");
  const ids = await page.evaluate(() => {
    const calls = (window as any).__TEST_CALLS__;
    return [calls.find((r: any) => r.op === "sector_summarize").requestId, calls.find((r: any) => r.op === "summary_cancel")?.requestId];
  });
  expect(ids[1]).toBe(ids[0]);
  await page.evaluate(() => { const w = window as any; w.__TEST_BEFORE_DISPATCH__ = undefined; w.__RELEASE_SECTOR__(); });
  await expect(panel.locator(".sector-summary-bullets").getByText("A research team has published its observations of water near the lunar south pole.", { exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "Retry sector summary", exact: true }).click();
  await expect(panel.locator(".sector-summary-bullets").getByText("A research team has published its observations of water near the lunar south pole.", { exact: true })).toBeVisible();
});

test("sector preview permission gate overrides item flags and keeps insufficient coverage readable", async ({ page }) => {
  await openBriefing(page);
  await page.evaluate(() => { (window as any).__SECTOR_PREVIEW_PATCH__ = { selectedCount: 1, eligibleCount: 1, excludedCount: 1 }; });
  await page.getByRole("button", { name: "Reload briefing", exact: true }).click();
  const panel = combined(page);
  await expect(panel.getByText("1 source stories selected · 1 eligible · 1 excluded", { exact: true })).toBeVisible();
  await expect(panel.getByText("At least 2 permitted source stories are needed. Read the originals or use an available per-story summary below.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Generate sector summary", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Open Researchers map a new lunar water reserve" }).click();
  await page.getByText("Optional AI summaries · per story", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Summarize excerpt", exact: true })).toHaveCount(2);
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) => r.op === "sector_summarize"))).toEqual([]);
});

for (const change of ["date", "profile", "input", "permission", "provider", "unmount"] as const) {
  for (const pending of [true, false]) {
    test(`sector ${change} change clears ${pending ? "in-flight work" : "completed output"} before replacement readback`, async ({ page }) => {
      await openBriefing(page, true, change === "profile");
      await page.evaluate(pending => {
        const w = window as any;
        w.__TEST_BEFORE_DISPATCH__ = async (r: any) => {
          if (pending && r.op === "sector_summarize") await new Promise<void>(resolve => { w.__RELEASE_SECTOR__ = resolve; });
          if (r.op === "daily_brief" || (r.op === "sector_summary_preview" && w.__HOLD_PREVIEW__)) await new Promise<void>(resolve => { w.__RELEASE_BRIEF__ = resolve; });
        };
      }, pending);
      await combined(page).getByRole("button", { name: "Generate sector summary", exact: true }).click();
      if (pending) await expect(combined(page).getByRole("button", { name: "Cancel sector summary" })).toBeVisible();
      else await expect(page.locator(".sector-summary-bullets").getByText("A research team has published its observations of water near the lunar south pole.", { exact: true })).toBeVisible();
      if (change === "date") await page.getByLabel("Briefing date").fill("2026-09-22");
      else if (change === "profile") await page.getByLabel("Reading profile").selectOption("default");
      else if (change === "unmount") await page.getByRole("button", { name: "All headlines", exact: true }).click();
      else await page.evaluate(change => {
        const w = window as any, s = w.__TEST_SNAPSHOT__();
        if (change === "provider") {
          w.__HOLD_PREVIEW__ = true;
          w.__TEST_PATCH__({ providers: s.providers.map((p: any) => ({ ...p, consented: false })) });
        }
        else if (change === "permission") w.__TEST_PATCH__({ sources: s.sources.map((s: any) => ({ ...s, aiAllowed: false })) });
        else w.__TEST_PATCH__({ articles: s.articles.map((a: any) => ({ ...a, excerpt: "Corrected authoritative input." })) });
        window.dispatchEvent(new Event("data-changed"));
      }, change);
      await expect(page.locator(".sector-summary-bullets").getByText("A research team has published its observations of water near the lunar south pole.", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Cancel sector summary" })).toHaveCount(0);
      if (pending) {
        await expect.poll(() => page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) => r.op === "summary_cancel").length)).toBe(1);
        await page.evaluate(() => (window as any).__RELEASE_SECTOR__());
      }
      if (!["profile", "unmount"].includes(change)) {
        await expect.poll(() => page.evaluate(() => typeof (window as any).__RELEASE_BRIEF__)).toBe("function");
        await page.evaluate(() => (window as any).__RELEASE_BRIEF__());
        await expect(combined(page).getByRole("button", { name: "Generate sector summary" })).toBeVisible();
      }
      await expect(page.locator(".sector-summary-bullets").getByText("A research team has published its observations of water near the lunar south pole.", { exact: true })).toHaveCount(0);
    });
  }
}

test("sector preview failure can be retried without sending stories to AI", async ({ page }) => {
  await openBriefing(page);
  await page.evaluate(() => { (window as any).__FAIL_OP__ = "sector_summary_preview"; });
  await page.getByRole("button", { name: "Reload briefing" }).click();
  const panel = combined(page);
  await expect(panel.getByRole("alert")).toContainText("Source preview unavailable");
  await expect(panel.getByRole("button", { name: "Generate sector summary" })).toBeDisabled();
  await page.evaluate(() => { (window as any).__FAIL_OP__ = undefined; });
  await panel.getByRole("button", { name: "Retry source preview" }).click();
  await expect(panel.getByRole("button", { name: "Generate sector summary" })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) => r.op === "sector_summarize"))).toEqual([]);
});

test("sector host rejection refreshes stale preview before explicit retry", async ({ page }) => {
  await openBriefing(page);
  const panel = combined(page);
  await expect(panel.getByRole("button", { name: "Generate sector summary" })).toBeEnabled();
  await page.evaluate(() => {
    const w = window as any;
    w.__FAIL_OP__ = "sector_summarize";
    w.__SECTOR_PREVIEW_PATCH__ = { fingerprint: "fresh-host-selection" };
  });
  await panel.getByRole("button", { name: "Generate sector summary" }).click();
  await expect(panel.getByRole("alert")).toContainText("Original stories remain available");
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) => r.op === "sector_summary_preview").length)).toBe(2);
  await expect(panel.locator(".sector-summary-bullets").getByText("A research team has published its observations of water near the lunar south pole.", { exact: true })).toHaveCount(0);
  await page.evaluate(() => { (window as any).__FAIL_OP__ = undefined; });
  await panel.getByRole("button", { name: "Retry sector summary" }).click();
  await expect(panel.locator(".sector-summary-bullets").getByText("A research team has published its observations of water near the lunar south pole.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) => r.op === "sector_summarize").at(-1).fingerprint)).toBe("fresh-host-selection");
});

for (const invalid of ["missing evidence", "empty evidence", "mismatched quote", "mismatched evidence source", "multiple citations", "multiple evidence", "null evidence"] as const) {
  test(`sector response rejects ${invalid} without displaying partial quotations`, async ({ page }) => {
    await openBriefing(page);
    await page.evaluate(invalid => {
      const text = "A research team has published its observations of water near the lunar south pole.";
      const bullet: any = { text, citations: ["S1"], evidence: [{ sourceId: "S1", quote: text }] };
      if (invalid === "missing evidence") delete bullet.evidence;
      if (invalid === "empty evidence") bullet.evidence = [];
      if (invalid === "mismatched quote") bullet.evidence[0].quote = "A different quotation.";
      if (invalid === "mismatched evidence source") bullet.evidence[0].sourceId = "S2";
      if (invalid === "multiple citations") bullet.citations.push("S2");
      if (invalid === "multiple evidence") bullet.evidence.push({ sourceId: "S2", quote: text });
      if (invalid === "null evidence") bullet.evidence = [null];
      // A valid first bullet must not leak through when a later bullet fails.
      const quote = "What lunar water observations can tell us";
      (window as any).__SECTOR_RESULT_PATCH__ = { bullets: [
        { text: quote, citations: ["S2"], evidence: [{ sourceId: "S2", quote }] }, bullet,
      ] };
    }, invalid);
    const panel = combined(page);
    await panel.getByRole("button", { name: "Generate sector summary" }).click();
    await expect(panel.getByRole("alert")).toContainText("invalid or superseded");
    await expect(panel.locator(".sector-summary-output")).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Retry sector summary" })).toBeEnabled();
    expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) => r.op === "sector_summarize").length)).toBe(1);
    await page.evaluate(() => { (window as any).__SECTOR_RESULT_PATCH__ = undefined; });
    await panel.getByRole("button", { name: "Retry sector summary" }).click();
    await expect(panel.locator(".sector-summary-bullets q")).toHaveCount(2);
  });
}

for (const invalid of ["unknown citation", "empty citation", "stale identity"] as const) {
  test(`sector response rejects ${invalid} without displaying partial prose`, async ({ page }) => {
    await openBriefing(page);
    await page.evaluate(invalid => {
      (window as any).__SECTOR_RESULT_PATCH__ = invalid === "stale identity"
        ? { fingerprint: "superseded" }
        : { bullets: [{ text: "This must never be shown.", citations: invalid === "unknown citation" ? ["S99"] : [],
          evidence: [{ sourceId: invalid === "unknown citation" ? "S99" : "S1", quote: "This must never be shown." }] }] };
    }, invalid);
    const panel = combined(page);
    await panel.getByRole("button", { name: "Generate sector summary" }).click();
    await expect(panel.getByRole("alert")).toContainText("invalid or superseded");
    await expect(panel.getByText("This must never be shown.")).toHaveCount(0);
    await expect(panel.getByRole("heading", { name: "AI-selected source quotations · unverified" })).toHaveCount(0);
  });
}

test("sector preview identifies sampled inputs without claiming distinct publishers", async ({ page }) => {
  await openBriefing(page);
  await page.evaluate(() => {
    const w = window as any, s = w.__TEST_SNAPSHOT__();
    w.__TEST_PATCH__({ articles: s.articles.map((a: any) => ({ ...a, sourceName: "One publisher" })) });
    w.__SECTOR_PREVIEW_PATCH__ = { eligibleCount: 3, excludedCount: 2 };
  });
  await page.getByRole("button", { name: "Reload briefing" }).click();
  const panel = combined(page);
  await expect(panel.getByText("2 source stories selected · 3 eligible · 2 excluded", { exact: true })).toBeVisible();
  await expect(panel.getByText("Sampled input: 2 of 3 eligible stories selected.")).toBeVisible();
  await panel.getByText("Review selected source inputs", { exact: true }).click();
  await expect(panel.getByText("Headline-only input", { exact: true })).toBeVisible();
  await expect(panel.getByText("Feed excerpt input", { exact: true })).toBeVisible();
  await expect(panel.getByText("Fixture generated analysis; not an official agency product.", { exact: true })).toHaveCount(2);
  await expect(panel.getByText(/2 publishers/)).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Generate sector summary" })).toBeEnabled();
});

test("sector generated view stays usable across desktop narrow and zoomed layouts", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openBriefing(page);
  const panel = combined(page);
  const generate = panel.getByRole("button", { name: "Generate sector summary" });
  await generate.focus();
  await expect(generate).toBeFocused();
  await generate.press("Enter");
  await expect(panel.locator(".sector-summary-bullets").getByText("A research team has published its observations of water near the lunar south pole.", { exact: true })).toBeVisible();
  // Workspace-only refreshes must not discard generated work.
  await page.evaluate(() => window.dispatchEvent(new Event("data-changed")));
  await expect(panel.locator(".sector-summary-bullets").getByText("A research team has published its observations of water near the lunar south pole.", { exact: true })).toBeVisible();
  const metrics = [];
  for (const view of [
    { name: "desktop", width: 1440, height: 900, zoom: 1 },
    { name: "compact", width: 1024, height: 768, zoom: 1 },
    { name: "narrow", width: 480, height: 900, zoom: 1 },
    { name: "zoom-200", width: 1440, height: 1000, zoom: 2 },
  ]) {
    await page.setViewportSize({ width: view.width, height: view.height });
    await page.evaluate(zoom => { document.documentElement.style.zoom = String(zoom); }, view.zoom);
    await panel.getByRole("heading", { name: "AI-selected source quotations · unverified" }).scrollIntoViewIfNeeded();
    const metric = await page.evaluate(() => ({ title: document.title, lang: document.documentElement.lang,
      bodyWidth: document.body.scrollWidth, viewportWidth: window.innerWidth / Number(document.documentElement.style.zoom || 1),
      panelOverflow: [...document.querySelectorAll(".sector-summary, .sector-summary-output")].some(e => e.scrollWidth > e.clientWidth + 1),
      smallTargets: [...document.querySelectorAll(".sector-summary button")].filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 && r.height < 44; }).length,
    }));
    expect(metric.panelOverflow).toBe(false);
    expect(metric.bodyWidth).toBeLessThanOrEqual(metric.viewportWidth + 1);
    metrics.push({ view: view.name, ...metric });
    await page.screenshot({ path: info.outputPath(`sector-${view.name}.png`), fullPage: true });
    await panel.getByRole("link", { name: "https://example.org/moon-review", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`sector-${view.name}-sources.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
  await info.attach("sector-layout-metrics", { body: JSON.stringify({ errors, metrics }, null, 2), contentType: "application/json" });
});

test("sector preview discloses authoritative selection without generating", async ({ page }) => {
  await openBriefing(page, false);
  const panel = combined(page);
  await expect(panel.getByRole("heading", { name: "Sector source quotations" })).toBeVisible();
  await expect(panel.getByText("2 source stories selected · 2 eligible · 0 excluded", { exact: true })).toBeVisible();
  await expect(panel.getByText("Selected cached stories only; not exhaustive sector coverage.")).toBeVisible();
  await expect(panel.getByText(/Up to 12 stories/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Generate sector summary", exact: true })).toBeDisabled();
  await expect(panel.getByText("Enable a provider and give consent before generating.")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) => r.op === "sector_summarize"))).toEqual([]);
  await expect(page.getByRole("button", { name: "Open Researchers map a new lunar water reserve" })).toBeVisible();
});
