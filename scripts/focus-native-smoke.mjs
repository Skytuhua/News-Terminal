// Real Windows/WebView2 focus smoke. No fixture IPC and no production data.
// Usage: node scripts/focus-native-smoke.mjs [--exe src-tauri/target/release/news-terminal.exe] [--prefix focus-native-smoke]
import { chromium } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { parseArgs } from "node:util";
import assert from "node:assert/strict";

const { values } = parseArgs({
  options: {
    exe: { type: "string", default: "src-tauri/target/release/news-terminal.exe" },
    "images-only": { type: "boolean", default: false },
    prefix: { type: "string", default: `focus-native-smoke-${new Date().toISOString().replace(/[^0-9]/g, "")}` },
  },
});
assert.match(values.prefix, /^focus-native-smoke-[\w-]+$/);
const executable = resolve(values.exe);
assert.ok(existsSync(executable), `Build the native executable first: ${executable}`);

const evidenceDirectory = resolve("docs/evidence");
mkdirSync(evidenceDirectory, { recursive: true });
const evidencePath = join(evidenceDirectory, `${values.prefix}.json`);
const dataDirectory = join(tmpdir(), `${values.prefix}-data-${process.pid}`);
const webviewDirectory = join(tmpdir(), `${values.prefix}-webview-${process.pid}`);
mkdirSync(dataDirectory, { recursive: true });
mkdirSync(webviewDirectory, { recursive: true });

const evidence = {
  startedAt: new Date().toISOString(),
  executable,
  dataDirectory,
  checks: [],
  screenshots: [],
  limitations: [
    "Uses a fresh temporary app data directory and real Rust IPC; no browser fixture or mocked news data.",
    "Live feed/model/benchmark availability depends on current public endpoints and local network access.",
    "Pinned media articles may be absent from current feeds; this records absence as a blocker rather than fabricating thumbnails.",
  ],
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const save = () => writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n");

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolvePort(port));
    });
  });
}

let app;
let browser;

function terminate() {
  if (app?.pid && app.exitCode === null) {
    try { execFileSync("taskkill.exe", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
  }
}

async function invoke(page, request) {
  return page.evaluate(request => window.__TAURI_INTERNALS__.invoke("dispatch", { request }), request);
}

function cdpBrowserArgs(port) {
  return `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`;
}

async function launch() {
  const port = await freePort();
  const stderr = [];
  app = spawn(executable, [], {
    env: {
      ...process.env,
      NEWS_TERMINAL_DATA_DIR: dataDirectory,
      NEWS_TERMINAL_CDP_PORT: String(port),
      NEWS_TERMINAL_WEBVIEW_DATA_DIR: webviewDirectory,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: cdpBrowserArgs(port),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  app.stderr.on("data", chunk => {
    stderr.push(String(chunk));
    if (stderr.join("").length > 12000) stderr.shift();
  });

  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (app.exitCode !== null) throw new Error(`Native app exited ${app.exitCode}: ${stderr.join("").slice(-2000)}`);
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 });
      break;
    } catch {
      await delay(250);
    }
  }
  assert.ok(browser, "Native WebView2 debug endpoint did not become available");

  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        try {
          await page.waitForFunction(() => Boolean(window.__TAURI_INTERNALS__?.invoke), undefined, { timeout: 1000 });
          const ctx = await invoke(page, { op: "window_context" });
          if (ctx.label === "main") {
            await page.getByRole("tablist", { name: "Workspace tabs" }).waitFor({ timeout: 20000 });
            return page;
          }
        } catch {}
      }
    }
    await delay(250);
  }
  throw new Error("Main native page did not become IPC-ready");
}

async function screenshot(page, name) {
  const path = join(evidenceDirectory, `${values.prefix}-${name}.png`);
  await page.screenshot({ path, timeout: 15000 });
  evidence.screenshots.push(path);
  save();
}

async function record(name, fn, required = true) {
  const check = { name, startedAt: new Date().toISOString(), required };
  evidence.checks.push(check);
  save();
  try {
    check.details = await fn();
    check.passed = true;
  } catch (error) {
    check.passed = false;
    check.error = String(error.stack || error);
    if (required) throw error;
  } finally {
    check.finishedAt = new Date().toISOString();
    save();
  }
}

try {
  const page = await launch();
  await record("catalog and default AI workspace are present", async () => {
    const snapshot = await invoke(page, { op: "snapshot", profileId: "default" });
    assert.ok(snapshot.sources.length >= 45, "Focused catalog did not load");
    assert.ok(snapshot.sources.length <= 300, "Source cap exceeded");
    assert.equal(snapshot.workspace.tabs[0].section, "ai");
    return {
      sources: snapshot.sources.length,
      enabledSources: snapshot.sources.filter(s => s.enabled).length,
      imageSources: snapshot.sources.filter(s => s.imagesAvailable).map(s => s.id),
      providers: snapshot.providers.map(p => ({ id: p.id, kind: p.kind, enabled: p.enabled })),
    };
  });

  await record("live refresh and focus sections", async () => {
    let refreshed;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      try {
        refreshed = await invoke(page, { op: "refresh" });
        break;
      } catch (error) {
        if (!String(error).includes("refresh is already running")) throw error;
        await delay(500);
      }
    }
    assert.ok(refreshed, "Refresh did not finish");
    const snapshot = await invoke(page, { op: "snapshot", profileId: "default" });
    const counts = { ai: 0, technology: 0, stocks: 0, others: 0 };
    for (const article of snapshot.articles) for (const section of article.sections || ["others"]) counts[section] = (counts[section] || 0) + 1;
    assert.ok(snapshot.articles.length > 0, "No live articles fetched");
    for (const section of ["ai", "technology", "stocks"]) assert.ok(counts[section] > 0, `No live ${section} articles`);
    const working = snapshot.sources.filter(source => source.enabled && source.lastSuccess);
    const failing = snapshot.sources.filter(source => source.enabled && source.failures > 0);
    return { refreshed, articles: snapshot.articles.length, counts, workingSources: working.length, failingSources: failing.map(source => ({ id: source.id, failures: source.failures })) };
  });

  for (const section of ["AI", "Technology", "Stocks", "Others"]) {
    await page.getByRole("button", { name: section, exact: true }).click();
    await page.getByRole("heading", { name: section, exact: true }).waitFor();
    await screenshot(page, `section-${section.toLowerCase()}`);
  }

  if (!values["images-only"]) await record("model and benchmark metadata load without inference", async () => {
    await page.getByRole("button", { name: "AI", exact: true }).click();
    await page.getByRole("button", { name: "Models", exact: true }).click();
    await page.getByRole("heading", { name: "AI models", exact: true }).waitFor();
    const models = await invoke(page, { op: "model_catalog" });
    await screenshot(page, "models");
    await page.getByRole("button", { name: "Benchmarks", exact: true }).click();
    const benchmarks = await invoke(page, { op: "benchmark_catalog" });
    assert.ok(models.models.length > 0, "OpenRouter model metadata unavailable");
    assert.ok(models.huggingFace?.models.length > 0, "Selected Hugging Face metadata unavailable");
    assert.ok(benchmarks.panels.length >= 2, "Benchmark panels unavailable");
    for (const panel of benchmarks.panels) assert.ok(panel.rows.length > 0, `${panel.source} has no live rows`);
    await page.getByRole("table").first().waitFor();
    await screenshot(page, "benchmarks");
    await page.getByRole("button", { name: "News", exact: true }).click();
    return {
      modelSource: models.source,
      modelCount: models.models.length,
      huggingFaceCount: models.huggingFace.models.length,
      models: models.models.slice(0, 5).map(m => m.id),
      benchmarkPanels: benchmarks.panels.map(p => ({ source: p.source, license: p.license, rows: p.rows.length })),
      note: benchmarks.comparisonNote,
    };
  });

  await record("approved thumbnail availability is not fabricated", async () => {
    const snapshot = await invoke(page, { op: "snapshot", profileId: "default" });
    const articles = snapshot.articles.filter(a => a.media?.some(m => m.kind === "image" && m.playback === "inline"))
      .sort((a, b) => Number(b.sections?.some(s => ["ai", "technology", "stocks"].includes(s))) - Number(a.sections?.some(s => ["ai", "technology", "stocks"].includes(s))));
    if (!articles.length) throw new Error("No current live feed item matched the reviewed item-scoped media allowlist.");
    await page.getByRole("button", { name: "All headlines", exact: true }).click();
    await page.getByRole("heading", { name: "All headlines", exact: true }).waitFor();
    const latest = page.getByRole("button", { name: /Show latest/ });
    if (await latest.isVisible()) {
      await latest.click();
      await latest.waitFor({ state: "hidden" });
    }
    const rendered = [];
    for (const article of articles.filter((a, i) => articles.findIndex(b => b.sourceId === a.sourceId) === i)) {
      await page.getByLabel("Search cached stories").fill(article.title);
      const row = page.locator(`[data-article-id="${article.id}"]`);
      await row.waitFor().catch(async error => {
        await screenshot(page, "image-search-failure");
        throw new Error(`Image row missing for ${article.title}; search=${await page.getByLabel("Search cached stories").inputValue()}; ${error}`);
      });
      const enable = page.getByRole("button", { name: "Enable automatic images", exact: true });
      if (await enable.isVisible()) {
        assert.equal(await row.locator("img").count(), 0, "Images loaded before consent");
        await enable.click();
      }
      await row.locator("img").waitFor({ timeout: 30000 });
      await row.locator("img").evaluate(async img => {
        await img.decode();
        if (!img.complete || !img.naturalWidth) throw new Error("Preview did not decode");
      });
      await screenshot(page, `approved-image-${rendered.length + 1}`);
      await row.getByRole("button", { name: article.title, exact: true }).click();
      await page.getByRole("heading", { name: article.title, exact: true }).waitFor();
      const reader = page.locator(".reader-media");
      await reader.scrollIntoViewIfNeeded();
      const image = reader.locator("img").first();
      await image.waitFor({ timeout: 30000 });
      await image.evaluate(img => img.decode());
      const approved = article.media.find(m => m.kind === "image" && m.playback === "inline");
      if (approved.caption) await reader.getByText(approved.caption, { exact: true }).first().waitFor();
      await screenshot(page, `approved-reader-${rendered.length + 1}`);
      rendered.push({ articleId: article.id, sourceId: article.sourceId, sections: article.sections });
    }
    await page.getByRole("button", { name: "Compact", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector(".row-thumbnail"));
    await page.getByRole("button", { name: "Visual", exact: true }).click();
    await page.getByRole("button", { name: "Disable automatic images", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector(".row-thumbnail img"));
    const covered = new Set(rendered.flatMap(a => a.sections || []));
    const focusedPublishers = new Set(rendered.filter(a => a.sections?.some(s => ["ai", "technology", "stocks"].includes(s))).map(a => a.sourceId));
    evidence.thumbnailCoverageGatePassed = focusedPublishers.size >= 3 && ["ai", "technology", "stocks"].every(s => covered.has(s));
    return { mediaArticlePresent: true, rendered, thumbnailCoverageGatePassed: evidence.thumbnailCoverageGatePassed };
  }, false);

  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await screenshot(page, "connections-external-only");

  evidence.passed = evidence.checks.every(check => check.passed || !check.required);
  evidence.metadataSkipped = values["images-only"];
  evidence.releaseReady = !evidence.metadataSkipped && evidence.passed && evidence.thumbnailCoverageGatePassed === true;
} catch (error) {
  evidence.passed = false;
  evidence.fatalError = String(error.stack || error);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  terminate();
  evidence.finishedAt = new Date().toISOString();
  evidence.summary = {
    checks: evidence.checks.length,
    passed: evidence.checks.filter(c => c.passed).length,
    failed: evidence.checks.filter(c => c.passed === false).length,
  };
  save();
  console.log(JSON.stringify({ evidence: evidencePath, passed: evidence.passed, summary: evidence.summary, fatalError: evidence.fatalError }, null, 2));
}
