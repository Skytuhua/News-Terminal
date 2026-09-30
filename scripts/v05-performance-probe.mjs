// Synthetic browser benchmark only. No native DB, feed, AI or user profile access.
// Usage: node scripts/v05-performance-probe.mjs [--stories=5000] [--trials=5] [--port=4183] [--output=docs/evidence/v05-performance-run1.json]
//
// Measures the areas left unmeasured by docs/daily-performance-baseline.md (0.3-era
// list work) and docs/v04-performance-baseline.md (0.4 native ranking/snapshot):
// production bundle/startup cost, per-keystroke main-thread work while typing in the
// search box, tab and profile switch, reader-pane content switch, briefing and live
// view entry, and a repeated no-op refresh cycle. Reports medians over N trials with
// min/max, plus long tasks and DOM element counts.
//
// Two in-memory Vite builds, nothing written to dist:
//   1. mode=production  -> real production asset bytes (startup cost / bundle size)
//   2. mode=test        -> production React + minification, keeps the existing
//                          ipc.ts `import.meta.env.MODE === "test"` injection seam
//                          so the fixture can answer dispatches. The only difference
//                          between the two bundles is that seam.
import { build } from "vite";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import os from "node:os";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).map(v => v.replace(/^--/, "").split("=")),
);
const stories = Number(args.stories || 5000);
const trials = Number(args.trials || 5);
const port = Number(args.port || 4183);
assert(Number.isInteger(stories) && stories >= 100 && stories <= 20000, "stories out of range");
assert(Number.isInteger(trials) && trials >= 5 && trials <= 20, "trials must be >= 5");
assert(Number.isInteger(port) && port >= 1024 && port <= 65535, "port out of range");
const output = resolve(root, args.output || "docs/evidence/v05-performance-run1.json");
assert(
  !existsSync(output),
  "Evidence is immutable: choose a new --output path, never overwrite a prior run",
);
assert(
  relative(root, output).replaceAll("\\", "/").startsWith("docs/evidence/v05-performance-"),
  "Output must stay in the owned evidence prefix",
);

const hashFiles = [
  "src/App.tsx", "src/model.ts", "src/ipc.ts", "src/coalescedRead.ts",
  "src/HeadlineRow.tsx", "src/Coverage.tsx", "src/Briefing.tsx", "src/SectorSummary.tsx",
  "src/LiveDiscussion.tsx", "src/HiddenStories.tsx", "src/Summary.tsx", "src/StoryThumbnail.tsx",
  "src/MediaSession.tsx", "src/types.ts", "src/main.tsx", "package.json", "package-lock.json",
  "vite.config.ts", "index.html",
];
async function fingerprints() {
  return Object.fromEntries(
    await Promise.all(
      hashFiles.map(async name => [
        name,
        createHash("sha256").update(await readFile(resolve(root, name))).digest("hex"),
      ]),
    ),
  );
}

// ---------------------------------------------------------------- production bundle
// Real production asset bytes, in memory only. The seam is compiled away here, so
// this build is never driven by a browser; it exists to price bytes and parse cost.
const prodBuild = await build({ root, mode: "production", logLevel: "warn", build: { write: false, sourcemap: false } });
const prodAssets = prodBuild.output
  .map(a => {
    const bytes = Buffer.from(a.type === "asset" ? a.source : a.code);
    return {
      file: a.fileName,
      rawBytes: bytes.length,
      gzipBytes: gzipSync(bytes, { level: 9 }).length,
    };
  })
  .sort((a, b) => b.rawBytes - a.rawBytes);

// Instrumented build: production React, minified, keeps the ipc injection seam.
const testBuild = await build({ root, mode: "test", logLevel: "warn", build: { write: false, sourcemap: false } });
const assets = new Map(
  testBuild.output.map(a => ["/" + a.fileName, a.type === "asset" ? a.source : a.code]),
);
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  const content = assets.get(path === "/" ? "/index.html" : path);
  if (content === undefined) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader("Content-Type", path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : "text/html");
  // Long cache mirrors the shipped WebView2 asset behaviour; cold trials also use a
  // fresh browser context so the HTTP cache starts empty either way.
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.end(content);
});
// Bind failure is an infrastructure problem, not a measurement result. Name the
// port and the likely cause so a stale listener from a killed run is never
// mistaken for a probe defect (EADDRINUSE otherwise surfaces as a bare stack).
try {
  await new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", ok);
  });
} catch (error) {
  if (error && error.code === "EADDRINUSE") {
    throw new Error(
      `INFRASTRUCTURE FAILURE: port ${port} is already in use, so this run never started. ` +
        `Another probe or server is still listening (check: netstat -ano | findstr :${port}). ` +
        `Free the port or pass --port=<other>. No measurement was taken.`,
    );
  }
  throw new Error(`INFRASTRUCTURE FAILURE: could not listen on 127.0.0.1:${port}: ${error && error.code || error}`);
}
const base = `http://127.0.0.1:${port}`;
assert.equal((await fetch(base)).status, 200, "Dedicated server health check");

// Derived fixture expectations, computed in Node from the same closed-form rules the
// in-page generator uses. The probe asserts against these, never against a hardcoded
// number, so a change to the fixture distribution cannot silently invalidate a run.
function expectations(count) {
  const hidden = i => i % 37 === 0;
  const needle = i => i % 10 === 0;
  const saved = i => i % 25 === 0;
  const range = [...Array(count).keys()];
  return {
    all: range.filter(i => !hidden(i)).length,
    saved: range.filter(i => !hidden(i) && saved(i)).length,
    brief: range.filter(i => !hidden(i) && i * 60 < 86400).length,
    // "needle" appears in the title of every tenth row; the excerpt never contains it.
    needle: range.filter(i => !hidden(i) && needle(i)).length,
  };
}

const startedAt = new Date().toISOString();
const expectedCounts = expectations(stories);
// Single source of truth for the typed query: the battery, the assertions and the
// evidence record all read this one constant.
const TYPED_QUERY = "needle";
const initialHashes = await fingerprints();
const result = {
  schemaVersion: 1,
  startedAt,
  kind: "synthetic browser fixture against the current production frontend build; not native Tauri/SQLite/feed/AI latency",
  measures: [
    "production bundle bytes (raw + gzip)",
    "cold first paint / first story rows (fresh browser context, empty HTTP cache)",
    "synthetic fixture construction cost, reported separately because it runs before app code in the same main-thread task",
    "cached same-context reload",
    "tab switch",
    "profile switch",
    "per-keystroke main-thread input-to-paint latency while typing in the search box",
    "open a story (reader pane mount)",
    "reader pane content switch (second story)",
    "switch to Daily briefing (many sectors)",
    "switch to Live discussion",
    "repeat no-op refresh cycle (3 consecutive)",
    "main-thread long tasks and DOM element counts per step",
  ],
  environment: {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpu: os.cpus()[0].model.trim(),
    logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytesAtStart: os.freemem(),
    node: process.version,
    gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    cpuThrottle: "none",
    mode: "Vite in-memory builds; production React, minified, sourcemaps off; nothing written to dist",
    builds: { production: "mode=production, seam compiled away, measured for bytes only", instrumented: "mode=test, same config plus the ipc.ts injection seam" },
    port,
    trialIsolation: "one freshly launched headless Chromium process per trial; fresh context (empty HTTP cache) for the cold measurement, second fresh context for the interaction battery",
  },
  productionAssets: prodAssets,
  sourceHashesAtStart: initialHashes,
  config: { stories, trials, sources: 19, sectors: 14, liveItems: 100, tabs: 3, profiles: 2 },
  expectedCounts: null,
  trials: [],
  typedQuery: null,
  microbenchmarks: [],
  errors: [],
};
result.expectedCounts = expectedCounts;
result.typedQuery = TYPED_QUERY;
await mkdir(dirname(output), { recursive: true });
const save = async () => writeFile(output, JSON.stringify(result, null, 2) + "\n");

// ---------------------------------------------------------------------- fixture data
// Deterministic, seeded, synthetic. Realistic distributions: multilingual long
// titles, 19 sources, mixed kinds/topics/sections, related groups of 1-5, some
// read/saved/hidden rows, one search token per ten, per-story media permissions.
// The init script below is serialised into the page as a standalone function body,
// so every helper it needs is declared inside it. addInitScript arguments are
// intentionally tiny: the fixture is generated in-page, exactly as the 0.3-era
// probe did, so the measured page does no extra JSON parse at load time.
function installFixture(config) {
  // The fixture is built in an init script, so it runs on the main thread before
  // any app code. Its cost is synthetic overhead that lands inside cold first
  // paint, so it is measured explicitly and reported alongside every cold
  // number rather than being silently folded into the app's startup cost.
  const fixtureStart = performance.now();
  let resultFixtureInstallMs = 0;
  function mulberry(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const TOPICS = ["ai", "politics", "business", "markets", "technology", "science", "health", "weather", "climate", "sports", "entertainment", "culture"];
  const SECTIONS = ["ai", "technology", "stocks", "others"];
  const KINDS = ["reporting", "reporting", "reporting", "reporting", "reporting", "reporting", "reporting", "opinion", "discussion", "official notice"];
  const LANGS = [
    { code: "en", region: "world" },
    { code: "de", region: "europe" },
    { code: "fr", region: "europe" },
    { code: "es", region: "americas" },
    { code: "ja", region: "asia" },
    { code: "zh", region: "asia" },
    { code: "ru", region: "europe" },
    { code: "ar", region: "middle-east" },
    { code: "pt", region: "americas" },
    { code: "hi", region: "asia" },
  ];
  const TITLES = {
    en: i => `Regulators open a long-running inquiry into ${TOPICS[i % TOPICS.length]} market concentration as publishers warn that consolidation could raise subscription prices for smaller institutional readers`,
    de: i => `Aufsichtsbehörden eröffnen eine länger dauernde Prüfung der Marktkonzentration im Bereich ${TOPICS[i % TOPICS.length]}, während Verleger davor warnen, dass Konsolidierung die Abonnementpreise kleinerer institutioneller Leserinnen und Leser erhöhen könnte`,
    fr: i => `Les régulateurs ouvrent une enquête de longue durée sur la concentration du marché ${TOPICS[i % TOPICS.length]}, les éditeurs avertissant que la consolidation pourrait augmenter les prix d'abonnement pour les petits lecteurs institutionnels`,
    es: i => `Los reguladores abren una investigación de larga duración sobre la concentración del mercado ${TOPICS[i % TOPICS.length]}, mientras los editores advierten que la consolidación podría subir las precios de suscripción`,
    ja: i => `${TOPICS[i % TOPICS.length]}市場の支配力について規制当局が長期的な調査を開始。出版社は統合が小規模な機関読者の購読価格に影響を与えると警告している`,
    zh: i => `监管机构对${TOPICS[i % TOPICS.length]}市场的集中度展开长期调查，出版商警告称行业整合可能推高小型机构读者的订阅价格，并对消费者选择造成不利影响`,
    ru: i => `Регуляторы начали длительное расследование концентрации рынка ${TOPICS[i % TOPICS.length]}; издатели предупреждают, что консолидация может повысить стоимость подписки для небольших институциональных читателей`,
    ar: i => `تفتح هيئات الرقابة تحقيقًا طويل الأمد حول تركّز سوق ${TOPICS[i % TOPICS.length]}، فيما يحذّر الناشرون من أن التوحيد قد يرفع أسعار الاشتراك`,
    pt: i => `Os reguladores abrem uma investigação de longa duração sobre a concentração do mercado ${TOPICS[i % TOPICS.length]}, enquanto os editores alertam que a consolidação pode elevar os preços de assinatura`,
    hi: i => `${TOPICS[i % TOPICS.length]} बाज़ार में एकाग्रता पर नियामकों ने लंबी जाँच शुरू की, प्रकाशकों ने चेतावनी दी कि विलयीकरण से छोटे संस्थागत पाठकों के सदस्यता शुल्क बढ़ सकते हैं`,
  };
  const EXCERPTS = {
    en: "Synthetic permitted feed excerpt used only for repeatable browser measurements; it is not real reporting and names no real organisation.",
    de: "Synthetischer zulässiger Feed-Auszug, ausschließlich für wiederholbare Browsermessungen; keine echte Berichterstattung.",
    fr: "Extrait de flux synthétique autorisé, uniquement pour des mesures de navigateur reproductibles ; ce n'est pas une information réelle.",
    es: "Extracto de feed sintético permitido, solo para mediciones de navegador repetibles; no es información real.",
    ja: "繰り返し可能なブラウザ計測のための合成された許可フィード抜粋です。実際在深圳の報道ではありません。",
    zh: "仅用于可重复浏览器测量的合成许可摘要片段；并非真实报道。",
    ru: "Синтетический разрешённый фрагмент ленты только для повторяемых измерений в браузере; это не реальная новость.",
    ar: "مقتطف تركيبي مسموح من التغذية، لقياسات متكررة في المتصفح فقط؛ ليس تقريرًا حقيقيًا.",
    pt: "Trecho sintético permitido, apenas para medições repetíveis no navegador; não é reportagem real.",
    hi: "केवल दोहराने योग्य ब्राउज़र माप के लिए कृत्रिम अनुमत फ़ीड अंश; यह वास्तविक रिपोर्टिंग नहीं है।",
  };
  const SECTOR_TITLES = [
    ["ai", "Artificial intelligence"], ["technology", "Technology"], ["science", "Science"],
    ["markets", "Markets"], ["politics", "Politics"], ["health", "Health"],
    ["climate", "Climate"], ["business", "Business"], ["sports", "Sports"],
    ["culture", "Culture"], ["entertainment", "Entertainment"], ["weather", "Weather"],
    ["energy", "Energy"], ["security", "Security"],
  ];
  // Mirrors src-tauri/src/lib.rs `changed()`: these ops broadcast data-changed.
  const NO_BROADCAST = new Set([
    "snapshot", "hidden_stories", "workspace_get", "daily_brief", "sector_summary_preview",
    "sector_summarize", "media_load", "media_cancel", "media_preferences", "benchmark_catalog",
    "model_catalog", "live_status", "window_monitors", "search", "export", "summarize",
    "summary_cancel", "window_context", "open_original",
  ]);
  function buildFixture({ count, seed, profileId, profileName, prefix }) {
    const rand = mulberry(seed);
    const at = 1790184000; // fixed instant; never Date.now()
    const preferences = { topics: [], regions: [], languages: [], sources: [], keywords: [], excludeKeywords: [], diversityCap: 0.5 };
    const profile = { id: profileId, name: profileName, preferences, quietHours: { enabled: false, start: "22:00", end: "07:00" }, alertsEnabled: false, lastVisit: at, previousVisit: at - 86400 };
    const sources = Array.from({ length: 19 }, (_, i) => {
      const lang = LANGS[i % LANGS.length];
      return {
        id: `s${i}`, name: `Synthetic source ${i} · ${lang.code.toUpperCase()}`,
        url: `https://example.org/feed/${i}`, homepage: "https://example.org",
        kind: i % 3 === 0 ? "reporting" : "aggregator", topics: [TOPICS[i % TOPICS.length]],
        region: lang.region, language: lang.code, enabled: i !== 18,
        status: i === 12 ? "Stale" : "Healthy", lastSuccess: at - i * 600,
        lastAttempt: at - i * 600, retryAt: null, failures: i === 12 ? 3 : 0,
        refreshMinutes: 30, termsUrl: "https://example.org/terms", storage: "excerpt",
        aiAllowed: i % 4 !== 3, mediaAllowed: i % 5 !== 4, accessMode: "free-keyless",
        sourceAdapter: "feed", publisher: `Synthetic publisher ${i}`, imagesAvailable: i % 3 === 0,
      };
    });
    let group = 0, groupLeft = 0;
    const articles = Array.from({ length: count }, (_, i) => {
      if (groupLeft === 0) { group += 1; groupLeft = 1 + Math.floor(rand() * 5); }
      groupLeft -= 1;
      const source = sources[i % 19];
      const lang = LANGS[i % LANGS.length];
      const needle = i % 10 === 0;
      const sections = i % 4 === 0 ? [] : [SECTIONS[Math.floor(rand() * SECTIONS.length)]];
      return {
        id: `${prefix}${i}`, sourceId: source.id, sourceName: source.name,
        title: `${needle ? "needle · " : ""}${TITLES[lang.code](i)} #${i}`,
        url: `https://example.org/story/${i}`,
        excerpt: `${EXCERPTS[lang.code]} ${EXCERPTS.en}`,
        publishedAt: at - i * 60, firstSeen: at - i * 60,
        updatedAt: i % 7 === 0 ? at - i * 60 + 120 : at - i * 60,
        topics: [TOPICS[i % TOPICS.length], TOPICS[(i * 7) % TOPICS.length]],
        sections, topicLabels: [TOPICS[i % TOPICS.length]],
        classificationVersion: 1, classificationReasons: ["Synthetic fixture"],
        region: lang.region, language: lang.code, kind: KINDS[i % KINDS.length],
        aiAllowed: i % 3 === 0, mediaAllowed: undefined,
        read: i % 3 === 0, saved: i % 25 === 0, hidden: i % 37 === 0,
        groupId: `g${group}`, reasons: ["Synthetic fixture", "Recent report", "Topic match"],
        score: 1 - i / (count * 4),
        history: i % 11 === 0 ? [{ at: at - i * 60 - 3600, title: `Earlier synthetic headline ${i}`, excerpt: EXCERPTS.en }] : [],
        media: i % 9 === 0 && source.mediaAllowed !== false
          ? [{ kind: "image", url: `https://example.org/img/${i}.png`, caption: `Synthetic caption ${i}`, credit: `Synthetic credit ${i}`, playback: "inline" }]
          : [],
      };
    });
    return { at, profile, sources, articles };
  }

    const enc = new TextEncoder();
    const primary = buildFixture({ count: config.stories, seed: 20260925, profileId: "default", profileName: "Synthetic desk", prefix: "a" });
    const secondary = buildFixture({ count: config.stories, seed: 777001, profileId: "desk-b", profileName: "Synthetic desk B", prefix: "b" });
    const byProfile = { default: primary, "desk-b": secondary };
    const tabSeed = (p) => [
      { id: "home", title: "All headlines", mode: "all", topic: "", query: "" },
      { id: "brief-desk", title: "Synthetic brief desk", mode: "brief", topic: "", query: "" },
      { id: "saved-desk", title: "Synthetic saved desk", mode: "saved", topic: "", query: "" },
    ];
    const workspace = {
      default: { tabs: tabSeed("default"), activeTabId: "home", revision: 0 },
      "desk-b": { tabs: tabSeed("desk-b"), activeTabId: "home", revision: 0 },
    };
    const mainProfile = { current: "default" };
    const replacementToken = crypto.randomUUID();
    const liveEnabled = { value: true };
    const liveItems = Array.from({ length: config.liveItems }, (_, i) => ({
      id: `live${i}`, title: `${TITLES[LANGS[i % LANGS.length].code](i)} — discussion ${i}`,
      url: `https://example.org/story/${i}`, discussionUrl: `https://news.ycombinator.com/item?id=${i}`,
      by: `synthetic-${i % 40}`, publishedAt: "2026-09-25T09:00:00Z", receivedAt: "2026-09-25T09:01:00Z", score: 100 - i,
    }));
    const liveStatus = () => ({
      enabled: liveEnabled.value, state: liveEnabled.value ? "connected" : "off",
      lastEventAt: "2026-09-25T09:01:00Z", lastItemAt: "2026-09-25T09:01:00Z",
      message: "Synthetic local status only; no upstream connection.",
      items: liveEnabled.value ? liveItems : [],
    });
    const dailyBrief = (p) => ({
      date: "2026-09-25", dayStart: p.at - 86399, dayEnd: p.at + 1, generatedAt: p.at,
      coverageLabel: "Synthetic cached coverage only", articleCount: p.articles.length, undatedCount: 0,
      sectors: SECTOR_TITLES.slice(0, config.sectors).map(([id, title], s) => {
        const items = p.articles.slice(s * 25, s * 25 + 25).map(a => ({
          id: a.id, title: a.title, url: a.url, sourceId: a.sourceId, sourceName: a.sourceName,
          publishedAt: a.publishedAt, kind: a.kind, excerpt: a.excerpt, aiAllowed: a.aiAllowed,
        }));
        return {
          id, title, articleCount: items.length, sourceCount: new Set(items.map(i => i.sourceId)).size,
          items, outline: items.slice(0, 6).map(i => `Outline line: ${i.title.slice(0, 90)}`),
        };
      }),
    });
    const providers = [
      { id: "ollama", name: "Ollama", kind: "ollama", model: "qwen3:4b", enabled: true, consented: true, hasKey: false },
      { id: "groq", name: "Groq", kind: "groq", model: "fixture", enabled: false, consented: false, hasKey: true },
    ];
    const mediaPrefs = {};
    const state = (profileId) => {
      const p = byProfile[profileId] || byProfile.default;
      return {
        replacementToken,
        profiles: [primary.profile, secondary.profile],
        profile: p.profile,
        sources: p.sources,
        articles: p.articles,
        watchlists: [{ id: "wl1", name: "Synthetic watchlist", keywords: ["needle"], topics: ["technology"], sources: [], alerts: false }],
        workspace: workspace[profileId] || workspace.default,
        providers,
        lastRefresh: p.at,
      };
    };
    const snapshotBytes = enc.encode(JSON.stringify(state("default"))).length;

    const calls = [];
    const longTasks = [];
    const keyLatency = [];
    new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration }))))
      .observe({ type: "longtask", buffered: true });
    for (const type of ["paint", "largest-contentful-paint", "navigation-timing", "resource"]) {
      try {
        new PerformanceObserver(list => {
          for (const e of list.getEntries()) {
            if (type === "largest-contentful-paint") window.__PERF__.lcp.push({ start: e.startTime, size: e.size });
            else if (type === "paint") window.__PERF__.paints.push({ name: e.name, start: e.startTime });
          }
        }).observe({ type, buffered: true });
      } catch { /* entry type unsupported in this engine build */ }
    }
    // In-page input->paint latency: recorded inside the page so no CDP round trip
    // is attributed to the main thread. Two animation frames approximate the paint
    // that follows the React commit for that keystroke.
    window.addEventListener("keydown", e => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement) || target.type !== "search") return;
      const t0 = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        keyLatency.push({ latencyMs: performance.now() - t0 });
      }));
    }, true);

    window.__PERF__ = { calls, longTasks, keyLatency, paints: [], lcp: [], snapshotBytes, liveBytes: enc.encode(JSON.stringify(liveStatus())).length, fixtureInstallMs: resultFixtureInstallMs };

    window.__NEWS_TEST_DISPATCH__ = async r => {
      const start = performance.now();
      const finish = value => {
        calls.push({ op: r.op, query: r.query, start, duration: performance.now() - start });
        if (!NO_BROADCAST.has(r.op)) window.dispatchEvent(new Event("data-changed"));
        return value;
      };
      const target = byProfile[r.profileId] || byProfile.default;
      if (["workspace_save", "article_state", "group_split"].includes(r.op) && r.replacementToken !== replacementToken)
        throw new Error("Database replaced: reload before making a new change");
      if (r.op === "window_context") return finish({ label: "main", detached: false, profileId: mainProfile.current, detachedTabs: [] });
      if (r.op === "window_set_profile") {
        if (!byProfile[r.profileId]) throw new Error("Unknown profile");
        mainProfile.current = r.profileId;
        return finish(null);
      }
      if (r.op === "visit") return finish(structuredClone(target.profile));
      if (r.op === "snapshot") return finish(structuredClone(state(r.profileId || mainProfile.current)));
      if (r.op === "workspace_get") {
        const w = workspace[r.profileId] || workspace.default;
        return finish({ ...structuredClone(w), replacementToken });
      }
      if (r.op === "workspace_save") {
        const w = workspace[r.profileId] || workspace.default;
        if (r.expectedRevision !== (w.revision ?? 0)) throw new Error("Workspace revision conflict");
        const { replacementToken: _t, ...next } = r.workspace;
        workspace[r.profileId] = { ...next, revision: (w.revision ?? 0) + 1 };
        return finish(null);
      }
      if (r.op === "search") {
        const q = r.query.toLowerCase();
        return finish(structuredClone(target.articles.filter(a => (a.title + " " + a.excerpt).toLowerCase().includes(q))));
      }
      if (r.op === "hidden_stories")
        return finish(structuredClone(target.articles.filter(a => a.hidden).sort((a, b) => b.firstSeen - a.firstSeen)));
      if (r.op === "article_state") {
        const article = target.articles.find(a => a.id === r.articleId);
        if (!article) throw new Error("Unknown article");
        Object.assign(article, Object.fromEntries(["read", "saved", "hidden"].filter(k => k in r).map(k => [k, r[k]])));
        return finish(null);
      }
      if (r.op === "group_split") {
        target.articles.find(a => a.id === r.articleId).groupId = r.articleId;
        return finish(null);
      }
      if (r.op === "refresh") return finish({ updated: 0, failed: 0 });
      if (r.op === "live_status") return finish(structuredClone(liveStatus()));
      if (r.op === "live_set") { liveEnabled.value = !!r.enabled; return finish(structuredClone(liveStatus())); }
      if (r.op === "daily_brief") return finish(structuredClone(dailyBrief(target)));
      if (r.op === "sector_summary_preview") {
        const brief = dailyBrief(target);
        const sector = brief.sectors.find(s => s.id === r.sectorId) || brief.sectors[0];
        const sources = sector.items.filter(i => i.aiAllowed).slice(0, 12).map((i, n) => ({
          id: `S${n + 1}`, articleId: i.id, title: i.title, url: i.url, sourceName: i.sourceName,
          publishedAt: i.publishedAt, inputLabel: n ? "Headline-only input" : "Feed excerpt input",
          attribution: "Synthetic fixture attribution", outputLabel: "Synthetic generated analysis.",
        }));
        return finish({
          profileId: r.profileId, date: r.date, sectorId: sector.id, sectorTitle: sector.title,
          fingerprint: `synthetic:${sector.id}:${sources.length}`, eligibleCount: sources.length,
          excludedCount: 0, selectedCount: sources.length, limit: 12, sources,
          coverageLabel: "Synthetic sector coverage only.",
        });
      }
      if (r.op === "media_preferences") return finish({ automatic: false, mode: "visual", ...(mediaPrefs[r.profileId] || {}), replacementToken });
      if (r.op === "media_preferences_set") { mediaPrefs[r.profileId] = { automatic: r.automatic, mode: r.mode }; return finish({ ...mediaPrefs[r.profileId], replacementToken }); }
      if (r.op === "media_load") return finish({ kind: "image", mimeType: "image/png", bytes: 68, dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" });
      if (r.op === "media_cancel") return finish({ cancelled: true });
      if (r.op === "open_original") return finish(null);
      throw new Error(`Unexpected fixture operation: ${r.op}`);
    };

  resultFixtureInstallMs = performance.now() - fixtureStart;
  window.__PERF__.fixtureInstallMs = resultFixtureInstallMs;
}

// ------------------------------------------------------------------------ measuring
// The init script is serialised into the page, so it cannot close over anything in
// this module. Any throw inside it would otherwise surface only as a hung wait, so
// the failure is captured here and re-thrown by the caller.
async function install(page, config) {
  await page.addInitScript({ content: `window.__NEWS_FIXTURE_INSTALL__ = ${installFixture.toString()};` });
  await page.addInitScript(cfg => {
    try {
      window.__NEWS_FIXTURE_INSTALL__(cfg);
    } catch (error) {
      window.__FIXTURE_ERROR__ = String((error && error.stack) || error);
    }
  }, config);
}

const painted = page =>
  page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())))));

// The status text is the app's own count of the visible collection, so it doubles as
// the readiness signal and as proof that pagination and filters produced what the
// fixture distribution says they should.
const readyRows = (page, total) =>
  page.waitForFunction(
    n => document.querySelectorAll('[data-testid="story-row"]').length === Math.min(n, 100)
      && document.querySelector(".filters [role=status]")?.textContent === `${n} stories`,
    total,
  );

const opCounts = page =>
  page.evaluate(() => {
    const out = {};
    for (const c of window.__PERF__.calls) out[c.op] = (out[c.op] || 0) + 1;
    return out;
  });

async function step(page, label, action, ready) {
  const start = await page.evaluate(() => performance.now());
  const before = await opCounts(page);
  await action();
  if (ready) await ready();
  const end = await painted(page);
  return page.evaluate(
    ({ label, start, end, before }) => {
      const tasks = window.__PERF__.longTasks.filter(t => t.start >= start && t.start < end);
      const counts = {};
      for (const c of window.__PERF__.calls) counts[c.op] = (counts[c.op] || 0) + 1;
      return {
        label,
        ms: end - start,
        opDelta: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v - (before[k] || 0)])),
        longTasks: tasks.length,
        longTaskTotalMs: tasks.reduce((s, t) => s + t.duration, 0),
        longestTaskMs: tasks.length ? Math.max(...tasks.map(t => t.duration)) : 0,
        domElements: document.querySelectorAll("*").length,
        storyRows: document.querySelectorAll('[data-testid="story-row"]').length,
      };
    },
    { label, start, end, before },
  );
}

async function coldMeasure(browser) {
  // Fresh process-level isolation is per trial; here a fresh context guarantees an
  // empty HTTP cache. Browser launch time is deliberately excluded.
  const context = await browser.newContext({ viewport: result.environment.viewport, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  page.on("pageerror", e => result.errors.push(String(e)));
  await install(page, result.config);
  const wallStart = performance.now();
  await page.goto(base, { waitUntil: "domcontentloaded" });
  assert.equal(await page.evaluate(() => window.__FIXTURE_ERROR__ || null), null, "Fixture installed without error");
  const domContentLoaded = performance.now() - wallStart;
  await readyRows(page, result.expectedCounts.all);
  const rowsReady = performance.now() - wallStart;
  // painted() resolves with a PAGE-relative performance.now(), which is not
  // comparable with the driver's wallStart (the page timeline restarts at
  // navigation). Stop the driver clock here instead, so this stays a real
  // wall-clock duration rather than a subtraction across two clocks.
  await painted(page);
  const rowsPainted = performance.now() - wallStart;
  const cold = await page.evaluate(() => ({
    paints: window.__PERF__.paints,
    lcp: window.__PERF__.lcp,
    domElements: document.querySelectorAll("*").length,
    storyRows: document.querySelectorAll('[data-testid="story-row"]').length,
    longTasks: window.__PERF__.longTasks.length,
    longTaskTotalMs: window.__PERF__.longTasks.reduce((s, t) => s + t.duration, 0),
    longestTaskMs: window.__PERF__.longTasks.length ? Math.max(...window.__PERF__.longTasks.map(t => t.duration)) : 0,
    snapshotBytes: window.__PERF__.snapshotBytes,
    liveBytes: window.__PERF__.liveBytes,
    fixtureInstallMs: window.__PERF__.fixtureInstallMs,
    resources: performance.getEntriesByType("resource").map(r => ({ name: new URL(r.name).pathname, transferSize: r.transferSize, decodedBodySize: r.decodedBodySize })),
    opCounts: window.__PERF__.calls.reduce((acc, c) => ((acc[c.op] = (acc[c.op] || 0) + 1), acc), {}),
  }));
  await context.close();
  return { domContentLoaded, rowsReady, navigationToPaintedFrames: rowsPainted, ...cold };
}

async function interactionBattery(browser) {
  // Second fresh context: interaction timings must not inherit cold-start JIT state
  // or the cold context's DOM.
  const context = await browser.newContext({ viewport: result.environment.viewport, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  page.on("pageerror", e => result.errors.push(String(e)));
  await install(page, result.config);
  const steps = [];
  await page.goto(base, { waitUntil: "domcontentloaded" });
  assert.equal(await page.evaluate(() => window.__FIXTURE_ERROR__ || null), null, "Fixture installed without error");
  await readyRows(page, result.expectedCounts.all);
  await page.waitForTimeout(600);

  // A reload starts a new document, so the page's performance timeline restarts and a
  // pre-navigation reading from the old document is meaningless. Measured as driver
  // wall time around the reload, and reported separately from the in-page steps.
  const reloadStart = performance.now();
  await page.reload({ waitUntil: "domcontentloaded" });
  await readyRows(page, result.expectedCounts.all);
  await painted(page); // settle the new document before stopping the driver clock
  const reloadEnd = performance.now();
  steps.push({
    label: "cached-reload-same-context",
    ms: reloadEnd - reloadStart,
    timingBasis: "driver wall time across a navigation; in-page performance.now() is not comparable across documents",
    // A reload starts a new document, so window.__PERF__.calls is rebuilt from
    // zero: the counts below are totals for the new document, not a delta
    // against the pre-reload document. Deliberately named to say so.
    opCountsAfterReload: await opCounts(page),
    longTasks: await page.evaluate(() => window.__PERF__.longTasks.length),
    longTaskTotalMs: await page.evaluate(() => window.__PERF__.longTasks.reduce((s, t) => s + t.duration, 0)),
    longestTaskMs: await page.evaluate(() => window.__PERF__.longTasks.length ? Math.max(...window.__PERF__.longTasks.map(t => t.duration)) : 0),
    domElements: await page.evaluate(() => document.querySelectorAll("*").length),
    storyRows: await page.locator('[data-testid="story-row"]').count(),
  });

  steps.push(await step(page, "tab-switch-to-brief-desk",
    () => page.getByRole("tab", { name: "Synthetic brief desk" }).click(),
    () => page.locator(".list-heading h2").filter({ hasText: "Synthetic brief desk" }).waitFor()));

  steps.push(await step(page, "tab-switch-back-to-all-headlines",
    () => page.getByRole("tab", { name: "All headlines" }).click(),
    () => readyRows(page, result.expectedCounts.all)));

  steps.push(await step(page, "tab-switch-to-saved-desk",
    () => page.getByRole("tab", { name: "Synthetic saved desk" }).click(),
    () => page.locator(".list-heading h2").filter({ hasText: "Synthetic saved desk" }).waitFor()));

  steps.push(await step(page, "tab-switch-back-to-all-headlines-2",
    () => page.getByRole("tab", { name: "All headlines" }).click(),
    () => readyRows(page, result.expectedCounts.all)));

  steps.push(await step(page, "profile-switch-to-desk-b",
    () => page.locator('select[aria-label="Reading profile"]').selectOption("desk-b"),
    // Readiness is checked from outside the app: the profile select must show the new
    // profile AND a row carrying the other profile's id prefix must be mounted.
    () => page.waitForFunction(() =>
      document.querySelector('select[aria-label="Reading profile"]')?.value === "desk-b"
      && [...document.querySelectorAll('[data-testid="story-row"]')].some(r => r.getAttribute("data-article-id")?.startsWith("b")))));

  steps.push(await step(page, "profile-switch-back-to-default",
    () => page.locator('select[aria-label="Reading profile"]').selectOption("default"),
    () => page.waitForFunction(() =>
      document.querySelector('select[aria-label="Reading profile"]')?.value === "default"
      && [...document.querySelectorAll('[data-testid="story-row"]')].some(r => r.getAttribute("data-article-id")?.startsWith("a")))));

  // --- per-keystroke typing. Keystrokes are dispatched one at a time; the
  // input->paint latency is measured in-page (no CDP round trip on the hot path).
  await page.getByRole("searchbox").click();
  await page.evaluate(() => { window.__PERF__.keyLatency.length = 0; window.__PERF__.longTasks.length = 0; });
  const query = TYPED_QUERY;
  for (const ch of query) {
    await page.keyboard.type(ch);
    await page.waitForTimeout(70); // realistic inter-keystroke gap, not a burst
  }
  await readyRows(page, result.expectedCounts.needle);
  await page.waitForTimeout(900); // let the 180ms search debounce and 350ms tab-persist debounce settle
  const typing = await page.evaluate(() => {
    const l = window.__PERF__.keyLatency.map(k => k.latencyMs).sort((a, b) => a - b);
    const q = (p) => l[Math.min(l.length - 1, Math.floor(l.length * p))];
    return {
      keystrokes: l.length,
      latencyMedianMs: q(0.5), latencyP90Ms: q(0.9), latencyMaxMs: l[l.length - 1],
      latencyOver16ms: l.filter(v => v > 16).length, latencyOver50ms: l.filter(v => v > 50).length,
      longTasks: window.__PERF__.longTasks.length,
      longTaskTotalMs: window.__PERF__.longTasks.reduce((s, t) => s + t.duration, 0),
      longestTaskMs: window.__PERF__.longTasks.length ? Math.max(...window.__PERF__.longTasks.map(t => t.duration)) : 0,
      opCounts: window.__PERF__.calls.reduce((acc, c) => ((acc[c.op] = (acc[c.op] || 0) + 1), acc), {}),
      domElements: document.querySelectorAll("*").length,
    };
  });

  steps.push(await step(page, "clear-search-full-list",
    () => page.getByRole("searchbox").fill(""),
    () => readyRows(page, result.expectedCounts.all)));
  await page.waitForTimeout(900);

  steps.push(await step(page, "open-first-story-reader-pane",
    () => page.locator(".story-list .headline").first().click(),
    () => page.locator(".detail h2").waitFor()));

  steps.push(await step(page, "reader-content-switch-to-third-story",
    () => page.locator("[data-testid=story-row]").nth(2).locator(".headline").click(),
    () => page.waitForFunction(() => /#\d+\s*$/.test(document.querySelector(".detail h2")?.textContent || ""))));

  steps.push(await step(page, "switch-to-daily-briefing",
    () => page.getByRole("button", { name: "Daily briefing" }).click(),
    () => page.waitForFunction(n => document.querySelectorAll(".brief-sector").length === n, result.config.sectors)));

  steps.push(await step(page, "switch-to-live-discussion",
    () => page.getByRole("button", { name: "Live discussion" }).click(),
    () => page.waitForFunction(n => document.querySelectorAll(".live-row").length === n, result.config.liveItems)));

  steps.push(await step(page, "back-to-all-headlines-from-live",
    () => page.getByRole("button", { name: "All headlines" }).click(),
    () => readyRows(page, result.expectedCounts.all)));
  await page.waitForTimeout(600);

  // --- repeat no-op refresh cycle, three consecutive identical interactions.
  const refreshes = [];
  for (let i = 1; i <= 3; i++) {
    refreshes.push(await step(page, `noop-refresh-cycle-${i}`,
      () => page.getByRole("button", { name: "Refresh feeds" }).click(),
      () => page.getByText("Refresh complete · 0 updated · 0 source failures", { exact: true }).waitFor()));
    await page.waitForTimeout(400);
  }

  const final = await page.evaluate(() => ({
    domElements: document.querySelectorAll("*").length,
    storyRows: document.querySelectorAll('[data-testid="story-row"]').length,
    cachedArticles: window.__PERF__.calls.length,
    totalCalls: window.__PERF__.calls.length,
    longestTaskMs: window.__PERF__.longTasks.length ? Math.max(...window.__PERF__.longTasks.map(t => t.duration)) : 0,
  }));
  await context.close();
  return { steps, typing, refreshes, final };
}

let browser;
try {
  for (let trial = 1; trial <= trials; trial++) {
    browser = await chromium.launch({ headless: true });
    result.environment.chromium = browser.version();
    const record = { trial, startedAt: new Date().toISOString() };
    record.cold = await coldMeasure(browser);
    record.interactions = await interactionBattery(browser);
    // Isolation sanity: the cold context must not have leaked into the battery.
    assert.equal(record.cold.storyRows, Math.min(result.expectedCounts.all, 100), "Cold paint mounts one bounded page of rows");
    assert.equal(record.interactions.typing.keystrokes, TYPED_QUERY.length, "Every dispatched keystroke was measured");
    assert.equal(record.interactions.final.storyRows, Math.min(result.expectedCounts.all, 100), "Battery ends on a bounded page of rows");
    // A duration can only be non-negative and finite. Negative values mean two
    // different clocks were subtracted (a driver-relative and a page-relative
    // performance.now()), which silently corrupts a median instead of failing.
    for (const [where, value] of [
      ["cold.domContentLoaded", record.cold.domContentLoaded],
      ["cold.rowsReady", record.cold.rowsReady],
      ["cold.navigationToPaintedFrames", record.cold.navigationToPaintedFrames],
      ...record.interactions.steps.map(s => [`step:${s.label}`, s.ms]),
      ...record.interactions.refreshes.map(r => [`refresh:${r.label}`, r.ms]),
    ]) {
      assert.ok(Number.isFinite(value) && value >= 0, `${where} must be a finite non-negative duration, got ${value}`);
    }
    result.trials.push(record);
    await browser.close();
    browser = undefined;
    await save();
    console.log(JSON.stringify({
      trial,
      coldRowsReadyMs: Math.round(record.cold.rowsReady),
      coldFcp: Math.round(record.cold.paints.find(p => p.name === "first-contentful-paint")?.start || 0),
      coldLongestTaskMs: Math.round(record.cold.longestTaskMs),
      coldDomElements: record.cold.domElements,
      keystrokeMedianMs: Math.round(record.interactions.typing.latencyMedianMs),
      keystrokeMaxMs: Math.round(record.interactions.typing.latencyMaxMs),
      steps: record.interactions.steps.map(s => [s.label, Math.round(s.ms)]),
    }));
  }

  // ------------------------------------------------- isolated expression costs
  browser = await chromium.launch({ headless: true });
  {
    const context = await browser.newContext({ viewport: result.environment.viewport, reducedMotion: "reduce" });
    const page = await context.newPage();
    page.setDefaultTimeout(120000);
    await install(page, result.config);
    await page.goto(base, { waitUntil: "domcontentloaded" });
    assert.equal(await page.evaluate(() => window.__FIXTURE_ERROR__ || null), null, "Fixture installed without error");
    await readyRows(page, result.expectedCounts.all);
    // Pull the real fixture rows out through a dispatch so the benchmark runs on
    // the same objects the app renders, not a re-serialised copy.
    const data = await page.evaluate(async () => {
      const snapshot = await window.__NEWS_TEST_DISPATCH__({ op: "snapshot", profileId: "default" });
      return { articles: snapshot.articles, sources: snapshot.sources, profile: snapshot.profile, stories: snapshot.articles.length };
    });
    const bench = await page.evaluate(payload => {
      const { articles, sources, profile } = payload;
      const time = (label, fn, reps = 5) => {
        fn();
        const runs = Array.from({ length: reps }, () => {
          const t0 = performance.now();
          const checksum = fn();
          return { ms: performance.now() - t0, checksum };
        }).sort((a, b) => a.ms - b.ms);
        return { label, medianMs: runs[Math.floor(runs.length / 2)].ms, minMs: runs[0].ms, maxMs: runs[runs.length - 1].ms, checksum: runs[0].checksum };
      };
      const out = { articleCount: articles.length, isolatedExpressionCosts: [] };
      const E = out.isolatedExpressionCosts;
      // App.tsx:162-167 briefingInput projection, verbatim shape.
      E.push(time("App.tsx briefingInput full-cache JSON fingerprint (per load)", () =>
        JSON.stringify([
          profile.preferences,
          sources.map(({ id, enabled, storage, aiAllowed, mediaAllowed }) => [id, enabled, storage, aiAllowed, mediaAllowed]),
          articles.map(({ id, updatedAt, title, excerpt, url, sourceId, sourceName, publishedAt, topics, sections, topicLabels, region, language, kind, aiAllowed, hidden, media }) =>
            [id, updatedAt, title, excerpt, url, sourceId, sourceName, publishedAt, topics, sections, topicLabels, region, language, kind, aiAllowed, hidden, media]),
        ]).length));
      // App.tsx:451-454 searchRevision projection.
      E.push(time("App.tsx searchRevision JSON fingerprint (per data change)", () =>
        JSON.stringify([profile.preferences, articles.map(({ read: _r, saved: _s, ...searchable }) => searchable)]).length));
      // model.ts:45-52 reconcileArticles, both articles stringified per pair.
      E.push(time("model.ts reconcileArticles double JSON.stringify over all rows", () => {
        const byId = new Map(articles.map(a => [a.id, a]));
        return articles.map(a => {
          const old = byId.get(a.id);
          return old && JSON.stringify(old) === JSON.stringify(a) ? 1 : 0;
        }).reduce((s, v) => s + v, 0);
      }));
      // App.tsx:531-532 per-render navigationRows + Set rebuild.
      E.push(time("App.tsx per-render navigationRows filter + Set rebuild (5 renders)", () => {
        let total = 0;
        for (let r = 0; r < 5; r++) {
          const nav = articles.filter(a => !a.hidden);
          total += new Set(nav.map(a => a.id)).size;
        }
        return total;
      }));
      // Coverage.tsx:20-22 per-render related-coverage scan.
      E.push(time("Coverage.tsx related scan over all rows (5 renders)", () => {
        let total = 0;
        for (let r = 0; r < 5; r++) {
          const target = articles[0];
          total += articles.filter(a => a.groupId === target.groupId && !a.hidden).length;
        }
        return total;
      }));
      // HeadlineRow date() calls: 100 mounted rows, title + compactDate each.
      E.push(time("model.ts date()+compactDate() for 100 mounted rows", () => {
        const now = new Date();
        return articles.slice(0, 100).reduce((s, a) =>
          s + new Date(a.publishedAt * 1000).toLocaleString().length
          + new Intl.DateTimeFormat("en-US", { year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date(a.publishedAt * 1000)).length, 0);
      }, 3));
      // Briefing.tsx:53-57 mounts one SectorSummary per sector, and each one
      // dispatches sector_summary_preview on mount (SectorSummary.tsx:77-85).
      // Priced with the real async dispatch path below, not with `time`.
      out.note = "Isolated in-page expression costs on the live synthetic fixture. NOT application speedups and NOT additive.";
      return out;
    }, data);

    // Async counterpart: what the app actually does to open the briefing.
    // Briefing.tsx:24 dispatches daily_brief once; Briefing.tsx:53-57 then mounts
    // one SectorSummary per sector, each dispatching sector_summary_preview on
    // mount (SectorSummary.tsx:77-85). Measured against the same fixture, so it
    // prices the fan-out shape, not native SQLite cost.
    const fanout = await page.evaluate(async sectors => {
      const dispatch = window.__NEWS_TEST_DISPATCH__;
      const run = async () => {
        const t0 = performance.now();
        const brief = await dispatch({ op: "daily_brief", profileId: "default", date: "2026-09-25" });
        const afterBrief = performance.now();
        await Promise.all(brief.sectors.map(s => dispatch({
          op: "sector_summary_preview", profileId: "default", date: "2026-09-25", sectorId: s.id,
        })));
        return { briefMs: afterBrief - t0, fanoutMs: performance.now() - afterBrief, sectors: brief.sectors.length };
      };
      await run();
      const runs = [];
      for (let i = 0; i < 5; i++) runs.push(await run());
      const med = key => { const v = runs.map(r => r[key]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
      return {
        label: "briefing open: 1x daily_brief then N parallel sector_summary_preview",
        sectors, briefMedianMs: med("briefMs"), fanoutMedianMs: med("fanoutMs"),
        combinedMedianMs: med("briefMs") + med("fanoutMs"),
        note: "Fixture dispatch cost only. The real host answers these from SQLite; this is not a prediction of native latency.",
      };
    }, result.config.sectors);
    bench.briefingFanout = fanout;
    result.microbenchmarks.push(bench);
    await context.close();
    await save();
  }

  result.sourceHashesAtEnd = await fingerprints();
  result.changedDuringRun = hashFiles.filter(name => initialHashes[name] !== result.sourceHashesAtEnd[name]);
  result.finishedAt = new Date().toISOString();
  assert.equal(result.trials.length, trials, "All trials recorded");
  assert.equal(result.errors.length, 0, "Browser page errors");
  await save();
  console.log(`Evidence: ${output}; ${result.trials.length} trials, ${result.errors.length} browser errors.`);
} catch (error) {
  result.failure = String(error.stack || error);
  await save();
  throw error;
} finally {
  await browser?.close();
  await new Promise(r => server.close(r));
}
