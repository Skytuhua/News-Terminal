// Synthetic browser benchmark only. No native DB, feed, AI or user profile access.
// Usage: node scripts/daily-performance-probe.mjs [--sizes=500,2000,5000] [--trials=3] [--port=4179] [--output=docs/evidence/daily-performance-after.json]
import { build } from 'vite';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(v => v.replace(/^--/, '').split('=')));
const sizes = (args.sizes || '500,2000,5000').split(',').map(Number);
const trials = Number(args.trials || 3), port = Number(args.port || 4179);
assert(sizes.every(n => Number.isInteger(n) && n >= 10 && n <= 5000));
assert(Number.isInteger(trials) && trials >= 1 && trials <= 20);
const output = resolve(root, args.output || 'docs/evidence/daily-performance-after.json');
assert(!existsSync(output), 'Evidence is immutable: choose a new --output path, never overwrite a baseline or prior run');
assert(relative(root, output).replaceAll('\\', '/').startsWith('docs/evidence/daily-performance-'), 'Output must stay in owned evidence prefix');
const hashFiles = ['src/Briefing.tsx', 'src/SectorSummary.tsx', 'src/types.ts', 'src/HeadlineRow.tsx', 'src/EmptyHeadlines.tsx', 'src/coalescedRead.ts', 'src/usePaneWidths.ts', 'src/PaneDivider.tsx', 'src/daily-use.css', 'src/App.tsx', 'src/model.ts', 'src/ipc.ts', 'src/LiveDiscussion.tsx', 'src/styles.css', 'src-tauri/src/db.rs', 'src-tauri/src/lib.rs', 'package-lock.json'];
async function fingerprints() {
  return Object.fromEntries(await Promise.all(hashFiles.map(async name => [name, createHash('sha256').update(await readFile(resolve(root, name))).digest('hex')])));
}
const startedAt = new Date().toISOString();
const initialHashes = await fingerprints();
// Production React/minification, MODE=test solely to retain the existing injection seam.
// Build is in memory; never changes dist, source, existing tests or package manifests.
const built = await build({ root, mode: 'test', logLevel: 'warn', build: { write: false, sourcemap: false } });
const assets = new Map(built.output.map(a => ['/' + a.fileName, a.type === 'asset' ? a.source : a.code]));
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const content = assets.get(path === '/' ? '/index.html' : path);
  if (content === undefined) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.end(content);
});
await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', ok); });
const base = `http://127.0.0.1:${port}`;
assert.equal((await fetch(base)).status, 200, 'Dedicated server health check');
const result = {
  schemaVersion: 2, rowPolicy: '100 mounted headline rows maximum; total count and final-page reachability are asserted separately', startedAt, kind: 'synthetic browser fixture, not native Tauri/SQLite/feed/AI latency',
  environment: { platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0].model.trim(), logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(), freeMemoryBytesAtStart: os.freemem(), node: process.version, gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), viewport: { width: 1440, height: 1000 }, cpuThrottle: 'none', mode: 'Vite build MODE=test, production React, minified, in-memory HTTP server', port },
  sourceHashesAtStart: initialHashes,
  sizes, trials, samples: [], pollSamples: [], microbenchmarks: [], errors: [],
};
await mkdir(dirname(output), { recursive: true });
const save = async () => writeFile(output, JSON.stringify(result, null, 2) + '\n');

// Match the existing test fixture shape, with independent deterministic bounded data.
function installFixture({ size, mode = 'all', liveEnabled = true }) {
  const at = 1790184000;
  const profile = { id: 'default', name: 'Synthetic desk', preferences: { topics: [], regions: [], languages: [], sources: [], keywords: [], excludeKeywords: [], diversityCap: 0.5 }, quietHours: { enabled: false, start: '22:00', end: '07:00' }, alertsEnabled: false, lastVisit: at, previousVisit: at - 86400 };
  const sources = Array.from({ length: 19 }, (_, i) => ({ id: `s${i}`, name: `Synthetic source ${i}`, url: `https://example.org/feed/${i}`, homepage: 'https://example.org', kind: 'reporting', topics: ['science'], region: 'world', language: 'en', enabled: true, status: 'Healthy', lastSuccess: at, termsUrl: 'https://example.org/terms', storage: 'excerpt', aiAllowed: false, mediaAllowed: false }));
  const articles = Array.from({ length: size }, (_, i) => ({ id: `a${i}`, sourceId: sources[i % 19].id, sourceName: sources[i % 19].name, title: `Synthetic ${i % 10 === 0 ? 'needle' : 'report'} ${i}: daily science and technology coverage`, url: `https://example.org/story/${i}`, excerpt: 'Synthetic permitted feed excerpt for repeatable browser measurements. '.repeat(4), publishedAt: at - i * 60, firstSeen: at - i * 60, updatedAt: at, topics: [i % 2 ? 'technology' : 'science'], region: 'world', language: 'en', kind: i % 4 ? 'reporting' : 'opinion', read: false, saved: i % 20 === 0, hidden: false, groupId: `g${Math.floor(i / 3)}`, reasons: ['Synthetic fixture', 'Recent report'], score: 1, history: [], aiAllowed: false, media: [] }));
  const replacementToken = crypto.randomUUID();
  const snapshot = { replacementToken, profiles: [profile], profile, sources, articles, watchlists: [], workspace: { tabs: [{ id: 'home', title: mode === 'live' ? 'Live discussion' : 'Headlines', topic: '', query: '', mode }], activeTabId: 'home', revision: 0 }, providers: [], lastRefresh: at };
  const live = { enabled: liveEnabled, state: liveEnabled ? 'connected' : 'off', lastEventAt: null, lastItemAt: null, message: 'Synthetic local status only', items: liveEnabled ? Array.from({ length: 100 }, (_, i) => ({ id: `live${i}`, title: `Synthetic discussion ${i}`, url: `https://example.org/${i}`, discussionUrl: `https://news.ycombinator.com/item?id=${i}`, by: 'fixture', publishedAt: '2026-09-23T09:00:00Z', receivedAt: '2026-09-23T09:01:00Z', score: i })) : [] };
  const calls = [], longTasks = [];
  new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })))).observe({ type: 'longtask', buffered: true });
  window.__PERF__ = { snapshot, calls, longTasks, snapshotBytes: new TextEncoder().encode(JSON.stringify(snapshot)).length, liveBytes: new TextEncoder().encode(JSON.stringify(live)).length };
  const changed = () => window.dispatchEvent(new Event('data-changed'));
  window.__NEWS_TEST_DISPATCH__ = async r => {
    const start = performance.now();
    if (['workspace_save','article_state'].includes(r.op) && r.replacementToken !== replacementToken) throw new Error('Database replaced: reload before making a new change');
    let value;
    if (r.op === 'window_context') value = { label: 'main', detached: false, profileId: 'default', detachedTabs: [] };
    else if (r.op === 'visit') value = profile;
    else if (r.op === 'snapshot') value = structuredClone(snapshot);
    else if (r.op === 'workspace_get') value = {...structuredClone(snapshot.workspace), replacementToken};
    else if (r.op === 'search') value = structuredClone(articles.filter(a => (a.title + ' ' + a.excerpt).toLowerCase().includes(r.query.toLowerCase())));
    else if (r.op === 'workspace_save') {
      if (r.expectedRevision !== snapshot.workspace.revision) throw new Error('Workspace revision conflict');
      const {replacementToken: _token, ...workspace} = r.workspace;
      snapshot.workspace = { ...workspace, revision: snapshot.workspace.revision + 1 }; changed(); value = null;
    } else if (r.op === 'article_state') { Object.assign(articles.find(a => a.id === r.articleId), Object.fromEntries(['read', 'saved', 'hidden'].filter(k => k in r).map(k => [k, r[k]]))); changed(); value = null; }
    else if (r.op === 'refresh') { changed(); value = { updated: 0, failed: 0 }; }
    else if (r.op === 'live_status') value = structuredClone(live);
    else throw new Error(`Unexpected fixture operation: ${r.op}`);
    calls.push({ op: r.op, query: r.query, start, duration: performance.now() - start });
    return value;
  };
}
const painted = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())))));
const readyRows = (page, total) => page.waitForFunction(n =>
  document.querySelectorAll('[data-testid="story-row"]').length === Math.min(n, 100)
  && document.querySelector('.filters [role=status]')?.textContent === `${n} stories`, total);
const counts = page => page.evaluate(() => Object.fromEntries([...new Set(window.__PERF__.calls.map(c => c.op))].map(op => [op, window.__PERF__.calls.filter(c => c.op === op).length])));
async function metric(page, label, action, ready) {
  const start = await page.evaluate(() => performance.now());
  const before = await counts(page);
  await action();
  if (ready) await ready();
  const end = await painted(page);
  return { label, ms: end - start, calls: Object.fromEntries(Object.entries(await counts(page)).map(([k, v]) => [k, v - (before[k] || 0)])), ...await page.evaluate(({ start, end }) => { const tasks = window.__PERF__.longTasks.filter(t => t.start >= start && t.start < end); return { longTasks: tasks.length, longTaskTotalMs: tasks.reduce((s, t) => s + t.duration, 0), longestTaskMs: Math.max(0, ...tasks.map(t => t.duration)) }; }, { start, end }) };
}
let browser;
try {
  for (const size of sizes) {
    for (let trial = 1; trial <= trials; trial++) {
      browser = await chromium.launch({ headless: true });
      result.environment.chromium = browser.version();
      const context = await browser.newContext({ viewport: result.environment.viewport, reducedMotion: 'reduce' });
      const page = await context.newPage();
      page.setDefaultTimeout(120000);
      page.on('pageerror', e => result.errors.push(String(e)));
      await page.addInitScript(installFixture, { size });
      const sample = { size, trial, metrics: [] };
      for (const cache of ['fresh-browser-context', 'same-context-reload']) {
        const start = performance.now();
        if (cache === 'same-context-reload') await page.reload({ waitUntil: 'domcontentloaded' });
        else await page.goto(base, { waitUntil: 'domcontentloaded' });
        await readyRows(page, size);
        const paintedAt = await painted(page);
        sample.metrics.push({ label: `startup-${cache}`, ms: performance.now() - start, navigationToTwoFramesMs: paintedAt, ...await page.evaluate(() => ({ calls: Object.fromEntries([...new Set(window.__PERF__.calls.map(c => c.op))].map(op => [op, window.__PERF__.calls.filter(c => c.op === op).length])), domNodes: document.querySelectorAll('*').length, rows: document.querySelectorAll('[data-testid="story-row"]').length, snapshotBytes: window.__PERF__.snapshotBytes, longTasks: window.__PERF__.longTasks.length, longestTaskMs: Math.max(0, ...window.__PERF__.longTasks.map(t => t.duration)), resources: performance.getEntriesByType('resource').map(r => ({ name: new URL(r.name).pathname, transferSize: r.transferSize, decodedBodySize: r.decodedBodySize })) })) });
      }
      sample.metrics.push(await metric(page, 'select-first-unread-story', () => page.locator('.headline').first().click(), () => page.locator('.detail h2').waitFor()));
      // Allow the app's queued writes and rerenders to finish before the next trial operation.
      await page.waitForTimeout(700);
      sample.metrics.push(await metric(page, 'content-type-opinion', () => page.getByLabel('Content type', { exact: true }).selectOption('opinion'), () => readyRows(page, Math.ceil(size / 4))));
      sample.metrics.push(await metric(page, 'content-type-reset', () => page.getByLabel('Content type', { exact: true }).selectOption(''), () => readyRows(page, size)));
      sample.metrics.push(await metric(page, 'search-first-results', () => page.getByRole('searchbox').fill('needle'), () => readyRows(page, Math.ceil(size / 10))));
      await page.waitForTimeout(1300);
      sample.afterSearchSettledCalls = await counts(page);
      sample.searchCalls = await page.evaluate(() => window.__PERF__.calls.filter(c => c.op === 'search'));
      sample.metrics.push(await metric(page, 'unchanged-data-event-with-search', () => page.evaluate(() => window.dispatchEvent(new Event('data-changed'))), () => page.waitForTimeout(700)));
      sample.metrics.push(await metric(page, 'clear-search-full-list', () => page.getByRole('searchbox').fill(''), () => readyRows(page, size)));
      await page.waitForTimeout(1000);
      sample.metrics.push(await metric(page, 'synthetic-noop-refresh', () => page.getByRole('button', { name: 'Refresh feeds', exact: true }).click(), () => page.getByText('Refresh complete · 0 updated · 0 source failures', { exact: true }).waitFor()));
      sample.fixtureDispatchDurations = await page.evaluate(() => window.__PERF__.calls);
      sample.finalRowCount = await page.locator('[data-testid="story-row"]').count();
      assert.equal(sample.finalRowCount, Math.min(size, 100), 'Mounted rows are explicitly page-bounded, not the full cache');
      assert.equal(await page.evaluate(() => window.__PERF__.snapshot.articles.length), size, 'Pagination never drops cached data');
      if (size > 100) await page.getByRole('button', { name: 'Last page', exact: true }).click();
      const final = page.locator(`[data-article-id="a${size - 1}"] .headline`);
      await final.waitFor();
      await final.click();
      await page.waitForFunction(id => document.querySelector('.detail h2')?.textContent === window.__PERF__.snapshot.articles.find(a => a.id === id).title, `a${size - 1}`);
      sample.reachability = { finalArticle: `a${size - 1}`, selected: true, cached: size, mountedOnLastPage: await page.locator('[data-testid="story-row"]').count() };
      // Search must find an off-first-page result from the complete cache too.
      await page.getByRole('searchbox').fill(` ${size - 1}:`);
      await readyRows(page, 1);
      assert.equal(await page.locator('[data-testid="story-row"]').getAttribute('data-article-id'), `a${size - 1}`);
      sample.reachability.searchable = true;
      result.samples.push(sample); await save();
      console.log(JSON.stringify({ size, trial, metrics: sample.metrics.map(m => ({ label: m.label, ms: Math.round(m.ms), calls: m.calls })) }));
      if (trial === 1) {
        // A/B only the actual related-group-count algorithm, not a modified app.
        result.microbenchmarks.push(await page.evaluate(() => {
          const articles = window.__PERF__.snapshot.articles;
          const one = fn => { const start = performance.now(); const value = fn(); return { ms: performance.now() - start, checksum: value }; };
          const old = () => articles.reduce((sum, a) => sum + (articles.filter(x => x.groupId === a.groupId).length > 1 ? articles.filter(x => x.groupId === a.groupId).length : 0), 0);
          const proposed = () => { const m = new Map(); for (const a of articles) m.set(a.groupId, (m.get(a.groupId) || 0) + 1); return articles.reduce((sum, a) => sum + (m.get(a.groupId) > 1 ? m.get(a.groupId) : 0), 0); };
          old(); proposed();
          return { size: articles.length, label: 'warm isolated synthetic group-count A/B; not an application speedup', original: Array.from({ length: 5 }, () => one(old)), map: Array.from({ length: 5 }, () => one(proposed)) };
        }));
        const m = result.microbenchmarks.at(-1); assert(m.original.every(v => v.checksum === m.map[0].checksum));
        await save();
      }
      await browser.close(); browser = undefined;
    }
  }
  browser = await chromium.launch({ headless: true });
  for (const enabled of [false, true]) for (const windows of [1, 3]) {
    const contexts = [], pages = [];
    for (let i = 0; i < windows; i++) {
      const context = await browser.newContext({ viewport: result.environment.viewport }); contexts.push(context);
      const page = await context.newPage(); page.on('pageerror', e => result.errors.push(String(e)));
      await page.addInitScript(installFixture, { size: 500, mode: 'live', liveEnabled: enabled });
      await page.goto(base); await page.locator('.live-status strong').waitFor(); pages.push(page);
    }
    const before = await Promise.all(pages.map(counts));
    const start = performance.now(); await new Promise(r => setTimeout(r, 5200));
    const perWindow = await Promise.all(pages.map(async (page, i) => ({ calls: (await counts(page)).live_status - (before[i].live_status || 0), ...await page.evaluate(() => ({ liveRows: document.querySelectorAll('.live-row').length, payloadBytes: window.__PERF__.liveBytes, pageVisibility: document.visibilityState, dispatchDurations: window.__PERF__.calls.filter(c => c.op === 'live_status').map(c => c.duration) })) })));
    result.pollSamples.push({ enabled, windows, observationMs: performance.now() - start, perWindow }); await save();
    for (const context of contexts) await context.close();
  }
  result.sourceHashesAtEnd = await fingerprints();
  result.changedDuringRun = hashFiles.filter(name => initialHashes[name] !== result.sourceHashesAtEnd[name]);
  result.finishedAt = new Date().toISOString();
  assert.equal(result.samples.length, sizes.length * trials);
  assert.equal(result.errors.length, 0, 'Browser page errors');
  await save();
  console.log(`Evidence: ${output}; ${result.samples.length} list samples, ${result.pollSamples.length} polling scenarios, ${result.errors.length} browser errors.`);
} catch (error) {
  result.failure = String(error.stack || error); await save(); throw error;
} finally {
  await browser?.close(); await new Promise(r => server.close(r));
}
