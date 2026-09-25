// Actual Windows/WebView2 reader acceptance. No fixture, synthetic news, remote-src,
// IPC mock, DOM replacement, app source edit, or production data directory.
// Build embedded CURRENT dist (do not run while another worker is editing dist):
// TAURI_CONFIG='{"build":{"devUrl":null}}' cargo build --manifest-path src-tauri/Cargo.toml --features tauri/custom-protocol
// Run: node scripts/v02-reader-smoke.mjs [--exe path] [--prefix v02-reader-debug] [--live-wait-ms 45000]
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import assert from 'node:assert/strict';

const { values } = parseArgs({ options: { exe: { type: 'string', default: 'src-tauri/target/debug/news-terminal.exe' }, prefix: { type: 'string', default: 'v02-reader-debug' }, 'live-wait-ms': { type: 'string', default: '45000' } } });
const executable = resolve(values.exe), prefix = values.prefix;
assert.match(prefix, /^v02-reader[\w-]*$/, 'Evidence must stay in owned v02-reader namespace');
const liveWait = Number(values['live-wait-ms']);
assert.ok(Number.isFinite(liveWait) && liveWait >= 0 && liveWait <= 45000);
const dataDirectory = mkdtempSync(join(tmpdir(), 'news-terminal-v02-reader-'));
const evidenceDirectory = resolve('docs/evidence');
mkdirSync(evidenceDirectory, { recursive: true });
const evidencePath = join(evidenceDirectory, `${prefix}.json`);
const evidence = { executable, dataDirectory, startedAt: new Date().toISOString(), checks: [], screenshots: [], consoleErrors: [], limitations: [
  'Real network data is mutable; missing reviewed items, network errors, or unavailable local AI are failures, never replaced by fixtures.',
  'AI execution/output and required disclosures are checked, not semantic accuracy, factual correctness, or advice quality.',
  'This executable embeds the dist present at build time. Debug evidence is not final release acceptance; rerun against the parent-built release.',
  'Screenshots capture the real native WebView2 content, not Windows window chrome. No viewport emulation is used.',
] };
let app, browser, page, snapshot;
const delay = ms => new Promise(r => setTimeout(r, ms));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const persist = () => writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
const invoke = request => page.evaluate(request => window.__TAURI_INTERNALS__.invoke('dispatch', { request }), request);
async function until(fn, timeout = 30000, interval = 250) {
  const end = Date.now() + timeout;
  let value;
  while (Date.now() < end) { value = await fn(); if (value) return value; await delay(interval); }
  throw new Error(`Condition not met within ${timeout}ms; last=${JSON.stringify(value)}`);
}
async function shot(name, locator = page) {
  const path = join(evidenceDirectory, `${prefix}-${name}.png`);
  await locator.screenshot({ path, timeout: 15000 });
  evidence.screenshots.push(path); persist(); return path;
}
async function check(name, fn) {
  const entry = { name, startedAt: new Date().toISOString() }; evidence.checks.push(entry); persist();
  try { entry.details = await fn(entry); entry.passed = true; }
  catch (e) {
    entry.passed = false; entry.error = String(e.stack || e);
    if (page && !page.isClosed()) { entry.body = await page.locator('body').innerText().catch(String); await shot(`failure-${evidence.checks.length}`).catch(() => {}); }
    console.error(`FAIL ${name}: ${e}`);
  }
  persist(); return entry;
}
async function selectArticle(article) {
  assert.ok(article, 'Required real feed item was not retrieved');
  await page.getByRole('button', { name: 'All headlines', exact: true }).click();
  const search = page.getByPlaceholder('Search cached stories…');
  await search.fill(article.title.split(/\s+/).slice(0, 5).join(' '));
  await page.keyboard.press('Enter');
  const latest = page.getByRole('button', { name: /new stor.*Show latest/ });
  if (await latest.isVisible()) await latest.click();
  const row = page.getByTestId('story-row').filter({ hasText: article.title }).first();
  await row.waitFor({ timeout: 15000 }); await row.click();
  await page.locator('.detail h2').filter({ hasText: article.title }).waitFor({ timeout: 15000 });
}
async function refreshOnce() {
  return until(async () => {
    try { return await invoke({ op: 'refresh' }); }
    catch (e) { if (String(e).includes('refresh is already running')) return false; throw e; }
  }, 150000, 750);
}
const catalog = JSON.parse(readFileSync(resolve('resources/sources.json'), 'utf8'));
const nasaPolicy = catalog.find(s => s.id === 'nasa-technology');
const approvals = nasaPolicy.rightsPolicy.mediaAllowlist;
const sourceIds = ['nasa-technology', 'nhc-atlantic', 'fed-press_monetary', 'fed-press_all'];
let nasaArticle, aiArticle;
try {
  assert.equal(process.platform, 'win32', 'Actual Windows required');
  assert.ok(existsSync(executable), `Build executable first: ${executable}`);
  evidence.executableSha256 = sha256(readFileSync(executable));
  // Snapshot the built binary so parallel rebuilds neither replace our tested
  // artifact nor fail on a Windows executable lock.
  evidence.launchedExecutable = join(dataDirectory, 'reader-smoke-app.exe');
  copyFileSync(executable, evidence.launchedExecutable);
  assert.equal(sha256(readFileSync(evidence.launchedExecutable)), evidence.executableSha256);
  evidence.catalogSha256 = sha256(readFileSync(resolve('resources/sources.json')));
  evidence.dist = existsSync('dist/index.html') ? { indexSha256: sha256(readFileSync('dist/index.html')) } : { unavailable: true };
  const port = await new Promise((done, reject) => { const s = createServer(); s.on('error', reject); s.listen(0, '127.0.0.1', () => { const n = s.address().port; s.close(() => done(n)); }); });
  app = spawn(evidence.launchedExecutable, [], { env: { ...process.env, NEWS_TERMINAL_DATA_DIR: dataDirectory, NEWS_TERMINAL_CDP_PORT: String(port), NEWS_TERMINAL_WEBVIEW_DATA_DIR: join(dataDirectory, 'webview') }, stdio: 'pipe' });
  evidence.pid = app.pid; evidence.stderr = '';
  let spawnError; app.on('error', e => { spawnError = e; });
  app.stderr.on('data', b => { evidence.stderr = (evidence.stderr + b).slice(-8000); }); app.stdout.on('data', () => {});
  await until(async () => {
    if (spawnError) throw spawnError;
    if (app.exitCode !== null) throw new Error(`Owned app exited ${app.exitCode}: ${evidence.stderr}`);
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }); return true; } catch { return false; }
  }, 45000);
  await until(async () => {
    for (const c of browser.contexts()) for (const p of c.pages()) {
      try { const ctx = await p.evaluate(() => window.__TAURI_INTERNALS__.invoke('dispatch', { request: { op: 'window_context' } })); if (ctx.label === 'main') { page = p; return true; } evidence.targetDiagnostics = { url: p.url(), ctx }; } catch (e) { evidence.targetDiagnostics = { url: p.url(), error: String(e), body: await p.locator('body').innerText().catch(String) }; }
    }
    return false;
  });
  page.setDefaultTimeout(15000);
  page.on('pageerror', e => evidence.consoleErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') evidence.consoleErrors.push(m.text()); });
  await page.getByRole('tablist', { name: 'Workspace tabs' }).waitFor({ timeout: 30000 });
  assert.ok(!page.url().includes('fixture') && !page.url().includes(':1420'), 'Must use embedded native app, not dev server or fixture');
  evidence.nativeUrl = page.url();
  await check('isolated native launch and real catalog refresh', async entry => {
    snapshot = await invoke({ op: 'snapshot', profileId: 'default' });
    // Existing builds do not expose a refresh-pause API. Disable unwanted feeds
    // through public IPC immediately; preserve all source floors. Any startup
    // requests already begun are recorded, not claimed to have been prevented.
    evidence.startupSources = snapshot.sources.map(s => ({ id: s.id, enabled: s.enabled, status: s.status }));
    for (const s of snapshot.sources) if (s.enabled !== sourceIds.includes(s.id)) await invoke({ op: 'source_update', sourceId: s.id, enabled: sourceIds.includes(s.id) });
    const configured = await invoke({ op: 'snapshot', profileId: 'default' });
    assert.deepEqual(configured.sources.filter(s => s.enabled).map(s => s.id).sort(), [...sourceIds].sort());
    entry.details = { refresh: await refreshOnce() };
    snapshot = await invoke({ op: 'snapshot', profileId: 'default' });
    evidence.sources = snapshot.sources.filter(s => sourceIds.includes(s.id));
    evidence.articles = snapshot.articles.map(a => ({ id: a.id, sourceId: a.sourceId, title: a.title, url: a.url, publishedAt: a.publishedAt, firstSeen: a.firstSeen, aiAllowed: a.aiAllowed, media: a.media }));
    nasaArticle = snapshot.articles.find(a => a.sourceId === nasaPolicy.id && approvals.every(p => p.itemUrl === a.url) && a.media?.some(m => m.kind === 'image') && a.media?.some(m => m.kind === 'video'));
    aiArticle = snapshot.articles.find(a => a.sourceId === 'nhc-atlantic' && a.aiAllowed) || snapshot.articles.find(a => a.sourceId.startsWith('fed-press_') && a.aiAllowed);
    evidence.nasaArticle = nasaArticle; evidence.aiArticle = aiArticle;
    assert.ok(snapshot.articles.length > 0, 'No live feed data');
    for (const id of sourceIds) assert.ok(snapshot.sources.find(s => s.id === id)?.lastSuccess, `No successful actual feed retrieval for ${id}`);
    await shot('main');
    return { ...entry.details, articleCount: snapshot.articles.length, sourceCounts: Object.fromEntries(sourceIds.map(id => [id, snapshot.articles.filter(a => a.sourceId === id).length])) };
  });
  await check('NASA item-level rights classification and denied AI', async () => {
    assert.ok(nasaArticle, 'Exact approved NASA article absent from real feed; do not synthesize it');
    assert.equal(nasaArticle.aiAllowed, false);
    assert.equal(nasaArticle.media.length, approvals.length, 'Unreviewed item media must not escape exact-asset gate');
    for (const m of nasaArticle.media) {
      const approval = approvals.find(a => a.url === m.url && a.kind === m.kind && a.itemUrl === nasaArticle.url);
      assert.ok(approval, 'Unreviewed asset escaped classification'); assert.equal(m.credit, approval.credit);
    }
    let rejection;
    try { await invoke({ op: 'summarize', profileId: 'default', articleId: nasaArticle.id, requestId: 'v02-reader-nasa-denied' }); } catch (e) { rejection = String(e); }
    assert.match(rejection || '', /permission|eligible|policy|AI/i);
    return { articleId: nasaArticle.id, originalUrl: nasaArticle.url, media: nasaArticle.media, deniedAi: rejection };
  });
  for (const kind of ['image', 'video']) await check(`native ${kind} explicit load, exact bytes, credit and decode`, async entry => {
    await selectArticle(nasaArticle);
    const index = nasaArticle.media.findIndex(m => m.kind === kind), media = nasaArticle.media[index];
    const approval = approvals.find(a => a.url === media.url);
    const slot = page.locator('.media-slot').nth(index);
    assert.equal(await slot.locator(kind === 'image' ? 'img' : 'video').count(), 0, 'Media loaded without explicit click');
    await slot.getByRole('button', { name: `Load ${kind} ${index + 1}`, exact: true }).click();
    const element = slot.locator(kind === 'image' ? 'img' : 'video');
    await element.waitFor({ timeout: 35000 });
    const src = await element.getAttribute('src');
    assert.ok(src?.startsWith(`data:${approval.mime};base64,`), 'Native bytes, not remote media src required');
    const bytes = Buffer.from(src.split(',')[1], 'base64');
    const actual = { bytes: bytes.length, sha256: sha256(bytes) };
    entry.details = { articleId: nasaArticle.id, originalUrl: nasaArticle.url, assetUrl: media.url, expected: approval, actual };
    assert.equal(actual.bytes, approval.bytes); assert.equal(actual.sha256, approval.sha256);
    const credit = await slot.locator('figcaption').innerText(); assert.match(credit, /Credit: NASA/);
    await slot.getByRole('button', { name: `Open media original ${index + 1}`, exact: true }).waitFor();
    if (kind === 'image') {
      await element.evaluate(img => img.decode());
      entry.details.decode = await element.evaluate(img => ({ complete: img.complete, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight }));
      assert.ok(entry.details.decode.naturalWidth > 0 && entry.details.decode.complete);
    } else {
      assert.equal(await element.evaluate(v => v.paused), true, 'Video autoplay forbidden');
      // Ordinary HTMLMediaElement playback of the host-returned source; no src
      // rewrite, fake decoder, injected frames or replacement DOM.
      await element.evaluate(v => { v.muted = true; return v.play(); });
      await until(() => element.evaluate(v => v.currentTime > 1 && v.videoWidth > 0 && v.readyState >= 2), 30000);
      entry.details.decode = await element.evaluate(v => ({ currentTime: v.currentTime, duration: v.duration, videoWidth: v.videoWidth, videoHeight: v.videoHeight, readyState: v.readyState, paused: v.paused, totalVideoFrames: v.getVideoPlaybackQuality().totalVideoFrames, droppedVideoFrames: v.getVideoPlaybackQuality().droppedVideoFrames, error: v.error?.message || null }));
      assert.ok(entry.details.decode.totalVideoFrames > 0); assert.equal(entry.details.decode.error, null);
    }
    await element.scrollIntoViewIfNeeded();
    entry.details.screenshot = await shot(kind);
    entry.details.assetScreenshot = await shot(`${kind}-asset`, slot);
    if (kind === 'video') await element.evaluate(v => v.pause());
    entry.details.credit = credit;
    // Newer reader builds visibly expose original URLs. Record missing label as
    // its own acceptance check below rather than discarding successful decode.
    entry.details.visibleOriginalUrl = (await page.locator('body').innerText()).includes(nasaArticle.url);
    return entry.details;
  });
  await check('media reader visibly attributes original article URL', async () => {
    assert.ok(nasaArticle); await selectArticle(nasaArticle);
    const body = await page.locator('body').innerText();
    assert.ok(body.includes(nasaArticle.url), 'Original article URL is not displayed in this embedded reader build');
    return { originalUrl: nasaArticle.url, screenshot: await shot('media-attribution') };
  });
  await check('daily briefing real local date, sectors, counts and empty gaps', async entry => {
    const brief = await invoke({ op: 'daily_brief', profileId: 'default' });
    entry.details = { brief };
    const now = new Date();
    const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    assert.equal(brief.date, localDate); assert.ok(brief.dayStart < brief.dayEnd);
    const inDay = t => Number.isFinite(t) && t >= brief.dayStart && t < brief.dayEnd && t <= brief.generatedAt;
    const fresh = await invoke({ op: 'snapshot', profileId: 'default' });
    const matching = fresh.articles.filter(a => !a.hidden);
    const dated = matching.filter(a => inDay(a.publishedAt));
    assert.equal(brief.articleCount, dated.length, 'Unique dated count differs from actual retained articles');
    assert.equal(brief.undatedCount, matching.filter(a => a.publishedAt == null && inDay(a.firstSeen)).length);
    for (const sector of brief.sectors) {
      const rows = dated.filter(a => a.topics?.includes(sector.id) || (!a.topics?.length && sector.id === 'unclassified'));
      assert.equal(sector.articleCount, rows.length); assert.equal(sector.sourceCount, new Set(rows.map(a => a.sourceId)).size);
      for (const a of sector.items) assert.ok(rows.some(r => r.id === a.id && r.url === a.url));
    }
    assert.ok(brief.sectors.length >= 11);
    assert.ok(brief.sectors.some(s => s.articleCount === 0), 'Real coverage has no empty sector to exercise');
    await page.getByRole('button', { name: 'Daily briefing', exact: true }).click();
    await page.locator('.brief-sector').first().waitFor();
    assert.equal(await page.getByLabel('Briefing date', { exact: true }).inputValue(), brief.date);
    assert.equal(await page.locator('.brief-sector').count(), brief.sectors.length);
    assert.equal(await page.locator('.sector-empty').count(), brief.sectors.filter(s => !s.items.length).length);
    assert.match(await page.locator('.brief-coverage').innerText(), /not.*(world events|complete)|retrieved/i);
    return { brief, screenshot: await shot('briefing'), visibleEmptyGaps: await page.locator('.sector-empty').allTextContents() };
  });
  await check('daily briefing profile filtering over real retrieved articles', async () => {
    const profile = await invoke({ op: 'profile_create', name: 'Reader smoke NASA only' });
    const p = await invoke({ op: 'snapshot', profileId: profile.id });
    await invoke({ op: 'profile_update', profileId: profile.id, preferences: { ...p.profile.preferences, sources: ['nasa-technology'] } });
    const readback = await invoke({ op: 'snapshot', profileId: profile.id });
    assert.deepEqual(readback.profile.preferences.sources, ['nasa-technology']);
    const brief = await invoke({ op: 'daily_brief', profileId: profile.id });
    const expected = snapshot.articles.filter(a => a.sourceId === 'nasa-technology' && a.publishedAt >= brief.dayStart && a.publishedAt < brief.dayEnd && a.publishedAt <= brief.generatedAt);
    assert.equal(brief.articleCount, expected.length);
    for (const s of brief.sectors) for (const a of s.items) assert.equal(a.sourceId, 'nasa-technology');
    return { profileId: profile.id, preferences: readback.profile.preferences, brief };
  });
  await check('actual local AI connection and consent readback', async () => {
    const connected = await invoke({ op: 'local_ai_connect' });
    const fresh = await invoke({ op: 'snapshot', profileId: 'default' });
    const provider = fresh.providers.find(p => p.id === 'ollama');
    assert.equal(provider.model, 'qwen3:4b-instruct-2507-q4_K_M'); assert.equal(provider.enabled, true); assert.equal(provider.consented, true);
    assert.ok(fresh.providers.filter(p => p.enabled).every(p => p.kind === 'ollama'), 'Do not send smoke inputs to cloud providers');
    // Reload reads the committed provider settings; no synthetic frontend state.
    await page.reload(); await page.getByRole('tablist', { name: 'Workspace tabs' }).waitFor();
    return { connected, provider };
  });
  await check('government item rights gate and actual local AI summary in reader', async entry => {
    assert.ok(aiArticle, 'No current eligible NHC/Fed feed item; never relax policy to force a summary');
    entry.details = { article: aiArticle, semanticAccuracyVerified: false };
    await selectArticle(aiArticle);
    await page.getByRole('button', { name: 'Summarize excerpt', exact: true }).click();
    await page.locator('.summary-output').waitFor({ timeout: 180000 });
    const output = await page.locator('.summary-output').innerText();
    const originalAfter = (await invoke({ op: 'snapshot', profileId: 'default' })).articles.find(a => a.id === aiArticle.id);
    assert.equal(originalAfter?.excerpt, aiArticle.excerpt, 'AI changed the publisher excerpt');
    entry.details.publisherExcerptUnchanged = true;
    entry.details.output = output;
    assert.match(output, /AI-generated.*verify with the original/);
    assert.match(output, /qwen3:4b-instruct-2507-q4_K_M/);
    assert.match(output, /Generated/);
    assert.ok(output.length > 160, 'No nonempty generated response');
    await page.locator('.summary-output').scrollIntoViewIfNeeded();
    entry.details.screenshot = await shot('summary');
    entry.details.summaryScreenshot = await shot('summary-output', page.locator('.summary'));
    return entry.details;
  });
  await check('government AI output required source/input/nonofficial labels', async () => {
    assert.ok(aiArticle); const policy = catalog.find(s => s.id === aiArticle.sourceId).rightsPolicy;
    const text = await page.locator('.summary-output').innerText();
    assert.ok(text.includes(policy.outputLabel), 'Required source-specific nonofficial output label missing');
    assert.ok(text.includes(policy.attribution), 'Required source attribution missing');
    assert.match(text, /feed excerpt|Headline-only input|headline.only|supplied feed/i);
    return { outputLabel: policy.outputLabel, attribution: policy.attribution, semanticAccuracyVerified: false };
  });
  await check('real HN Firebase stream initial metadata and bounded follow-up', async entry => {
    await page.getByRole('button', { name: 'Live discussion', exact: true }).click();
    await page.getByRole('button', { name: 'Connect HN stream', exact: true }).click();
    const initial = await until(async () => { const s = await invoke({ op: 'live_status' }); entry.details = { latestStatus: s }; return s.items?.length === 20 && s.lastEventAt ? s : false; }, 90000, 750);
    assert.equal(initial.enabled, true); assert.ok(Number.isFinite(Date.parse(initial.lastEventAt)));
    for (const i of initial.items) {
      assert.ok(i.id && i.title); assert.equal(i.aiAllowed, false); assert.equal(i.contentKind, 'discussion'); assert.match(i.discussionUrl, /^https:\/\/news\.ycombinator\.com\/item\?id=\d+$/);
      assert.ok(Number.isFinite(Date.parse(i.receivedAt))); assert.ok(!('excerpt' in i) && !('body' in i), 'Live stream must be metadata-only');
    }
    // Initial hydration arrives in batches; later batches intentionally wait behind Show latest.
    await until(async () => {
      const pending = page.locator('.live-new');
      if (await pending.isVisible()) await pending.click();
      return await page.locator('.live-row').count() === 20;
    }, 15000);
    const disclosure = await page.locator('.live-disclosure').innerText(); assert.match(disclosure, /not verified reporting/); assert.match(disclosure, /Initial snapshot is not newly published news/);
    const initialShot = await shot('live-initial');
    const deadline = Date.now() + liveWait; let later = initial;
    do { await delay(Math.min(1000, Math.max(1, deadline - Date.now()))); later = await invoke({ op: 'live_status' }); if (later.lastEventAt !== initial.lastEventAt) break; } while (Date.now() < deadline);
    const changed = JSON.stringify(later.items) !== JSON.stringify(initial.items);
    // Allow the ordinary 1s UI status poll to catch up before photographing it.
    await delay(1200);
    const renderedStatus = await page.locator('.live-status').innerText();
    assert.ok(!renderedStatus.includes('Invalid Date'));
    evidence.liveRenderedStatus = renderedStatus;
    entry.details = { initial, later, initialScreenshot: initialShot, screenshot: await shot('live'), waitedAtMostMs: liveWait, subsequentTransportEventObserved: later.lastEventAt !== initial.lastEventAt, subsequentItemChangeObserved: changed, note: changed ? 'Metadata changed after initial snapshot; not an assertion that the story was newly published.' : 'No subsequent item change observed during the bounded window. Initial snapshot alone is not a second live update.' };
    await page.getByRole('button', { name: 'Disconnect stream', exact: true }).click();
    const disconnected = await invoke({ op: 'live_status' }); assert.equal(disconnected.enabled, false); entry.details.disconnected = disconnected;
    return entry.details;
  });
  evidence.domMetrics = await page.evaluate(() => ({ title: document.title, lang: document.documentElement.lang, viewport: { width: innerWidth, height: innerHeight }, scrollWidth: document.documentElement.scrollWidth, horizontalOverflow: document.documentElement.scrollWidth > innerWidth }));
} catch (e) { evidence.fatalError = String(e.stack || e); console.error(evidence.fatalError); }
finally {
  if (page && !page.isClosed()) { try { const s = await invoke({ op: 'live_status' }); if (s.enabled) { await invoke({ op: 'live_set', enabled: false }); evidence.finalLiveStatus = await invoke({ op: 'live_status' }); } } catch { /* app already stopped */ } }
  // Terminate only this test's owned subprocess tree. Existing Ollama is untouched.
  if (app?.pid && app.exitCode === null) { try { execFileSync('taskkill.exe', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* exited */ } }
  if (browser) await browser.close().catch(() => {});
  evidence.finishedAt = new Date().toISOString();
  evidence.summary = { checks: evidence.checks.length, passed: evidence.checks.filter(c => c.passed).length, failed: evidence.checks.filter(c => !c.passed).length };
  evidence.passed = !evidence.fatalError && evidence.summary.failed === 0;
  persist(); console.log(JSON.stringify({ evidencePath, summary: evidence.summary, passed: evidence.passed, fatalError: evidence.fatalError }, null, 2));
  if (!evidence.passed) process.exitCode = 1;
}
