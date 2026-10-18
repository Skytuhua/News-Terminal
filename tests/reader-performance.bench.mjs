// Node-only comparison benchmark. No browser, native IPC, database, network or AI.
// node tests/reader-performance.bench.mjs --baseline=<commit> [--samples=9]
// A verified baseline checkout can be supplied with --baseline-dir=<path>.
// stdout is a JSON evidence record; redirect it to a new path when preserving a run.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, "").split("=")));
const baseline = args.baseline || "8834fbc20240917abdd7dce3846eb2c541b7d975";
assert.match(baseline, /^[0-9a-f]{7,40}$/i, "baseline must be a commit hash");
const samples = Number(args.samples || 9);
assert(Number.isInteger(samples) && samples >= 5 && samples <= 50, "samples must be between 5 and 50");
const oldFile = async name => args["baseline-dir"]
  ? readFile(resolve(args["baseline-dir"], name), "utf8")
  : execFileSync("git", ["show", `${baseline}:${name}`], { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
const oldModel = await oldFile("src/model.ts");
const oldApp = await oldFile("src/App.tsx");
const newModel = await readFile(resolve(root, "src/model.ts"), "utf8");
const newApp = await readFile(resolve(root, "src/App.tsx"), "utf8");
const importModel = text => import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(text)).toString("base64")}`);
const beforeModel = await importModel(oldModel);
const afterModel = await importModel(newModel);
// Execute the expressions from the requested baseline, not remembered formulas.
const searchExpression = oldApp.match(/const searchRevision = useMemo\(\(\) => ([\s\S]*?), \[data\?\.profile\.preferences/);
const briefingExpression = oldApp.match(/setBriefingInput\((JSON\.stringify\([\s\S]*?\n      \]\))\);/);
assert(searchExpression && briefingExpression, "baseline no longer has the expected fingerprint expressions");
const searchInput = new Function("data", `return ${searchExpression[1]};`);
const briefingInput = new Function("next", `return ${briefingExpression[1]};`);
const hash = text => createHash("sha256").update(text).digest("hex");
const beforeHashes = { model: hash(oldModel), app: hash(oldApp) };
const afterHashes = { model: hash(newModel), app: hash(newApp) };
const probeHash = hash(await readFile(fileURLToPath(import.meta.url), "utf8"));

function fixture() {
  const topics = ["science", "technology", "politics", "markets"];
  const headlines = [
    "Researchers compare new observations across the region and publish their findings",
    "科学者が新しい観測結果と地域の研究データを比較しました",
    "تقرير علمي يقارن نتائج الرصد الجديدة في المنطقة",
    "Neue Beobachtungen: Forschende vergleichen die Ergebnisse aus mehreren Regionen",
  ];
  const excerpt = "This synthetic publisher excerpt describes observations and their limitations. ".repeat(4);
  const profile = { id: "default", name: "Synthetic desk", preferences: {
    topics: [], regions: [], languages: [], sources: [], keywords: [], excludeKeywords: [], diversityCap: .5,
  }, quietHours: { enabled: false, start: "22:00", end: "07:00" }, alertsEnabled: false, lastVisit: 200, previousVisit: 100 };
  const sources = Array.from({ length: 19 }, (_, i) => ({
    id: `source-${i}`, name: `Source ${i}`, url: `https://example.org/feed/${i}`, homepage: "https://example.org",
    kind: "reporting", topics: [topics[i % topics.length]], region: "world", language: "en",
    enabled: true, aiAllowed: i % 3 === 0, mediaAllowed: true, storage: "excerpt", status: "Healthy",
    lastSuccess: 200, termsUrl: "https://example.org/terms",
  }));
  return {
    replacementToken: "synthetic", profile, profiles: [profile], sources, watchlists: [], providers: [],
    workspace: { activeTabId: "home", tabs: [{ id: "home", title: "Headlines", mode: "all", topic: "", query: "" }], revision: 0 }, lastRefresh: 200,
    articles: Array.from({ length: 5000 }, (_, i) => ({
      id: `article-${i}`, sourceId: sources[i % 19].id, sourceName: sources[i % 19].name,
      title: `${headlines[i % headlines.length]} #${i}`, excerpt, url: `https://example.org/story/${i}`,
      publishedAt: 1790184000 - i * 60, firstSeen: 1790184000 - i * 60, updatedAt: 1790184000 - i * 60,
      topics: [topics[i % topics.length]], sections: ["technology"], topicLabels: ["Science"],
      classificationVersion: 1, classificationReasons: ["Synthetic classification"], region: "world", language: "en", kind: "reporting",
      aiAllowed: i % 3 === 0, read: i % 3 === 0, saved: i % 25 === 0, hidden: i % 37 === 0,
      groupId: `group-${Math.floor(i / 3)}`, reasons: ["Synthetic fixture", "Recent report", "Topic match"], score: 1 - i / 20000,
      media: i % 9 === 0 ? [{ kind: "image", url: `https://example.org/image/${i}.png`, caption: `Synthetic image ${i}`, credit: "Fixture", playback: "inline" }] : [],
      history: i % 11 === 0 ? [{ at: 1790180000 - i * 60, title: `Earlier headline ${i}`, excerpt }] : [],
    })),
  };
}

// Match App's stable-reading projection: defer arrivals and retain accepted order.
function visible(previous, next) {
  const byId = new Map(next.articles.map(a => [a.id, a]));
  const existing = new Set(previous.articles.map(a => a.id));
  return {
    accepted: { ...next, articles: previous.articles.map(a => byId.get(a.id)).filter(Boolean) },
    pending: next.articles.filter(a => !existing.has(a.id)),
  };
}
const previous = fixture();
const oldSearch = searchInput(previous);
const oldBriefing = briefingInput(previous);
function before(next) {
  const briefingChanged = briefingInput(next) !== oldBriefing;
  const { accepted, pending } = visible(previous, next);
  accepted.articles = beforeModel.reconcileArticles(previous.articles, accepted.articles);
  return { accepted, pending, briefingChanged, searchChanged: searchInput(accepted) !== oldSearch };
}
function after(next) {
  const authoritative = { ...next, profile: { ...next.profile }, articles: afterModel.reconcileArticles(previous.articles, next.articles) };
  if (afterModel.sameSnapshotValue(previous.profile.preferences, next.profile.preferences))
    authoritative.profile.preferences = previous.profile.preferences;
  if (afterModel.sameSnapshotValue(previous.watchlists, next.watchlists)) authoritative.watchlists = previous.watchlists;
  const briefingChanged = !afterModel.sameBriefingInputs(previous, authoritative);
  const { accepted, pending } = visible(previous, authoritative);
  accepted.articles = afterModel.reconcileArticles(previous.articles, accepted.articles);
  return { accepted, pending, briefingChanged, searchChanged: !afterModel.sameSearchInputs(previous, accepted) };
}
const summarize = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = fraction => sorted[Math.floor((sorted.length - 1) * fraction)];
  return { medianMs: at(.5), p25Ms: at(.25), p75Ms: at(.75), minMs: sorted[0], maxMs: sorted.at(-1), samplesMs: values };
};
const cases = [
  ["unchanged readback", () => {}],
  ["one read marker", next => { next.articles[2500].read = !next.articles[2500].read; }],
  ["one corrected excerpt, unchanged timestamp", next => { next.articles[2500].excerpt = "Corrected publisher excerpt."; }],
  ["pending arrival and authoritative reorder", next => { next.articles.reverse(); next.articles.unshift({ ...next.articles[0], id: "pending" }); }],
];
const measurements = [];
for (const [name, mutate] of cases) {
  // Fixture construction and IPC cloning are excluded from timed sections.
  const next = structuredClone(previous);
  mutate(next);
  const oldResult = before(next), newResult = after(next);
  assert.deepEqual(newResult.accepted, oldResult.accepted, `${name}: accepted data`);
  assert.deepEqual(newResult.pending, oldResult.pending, `${name}: pending data`);
  assert.equal(newResult.searchChanged, oldResult.searchChanged, `${name}: search invalidation`);
  assert.equal(newResult.briefingChanged, oldResult.briefingChanged, `${name}: briefing invalidation`);
  const shared = result => result.accepted.articles.filter((a, i) => a === previous.articles[i]).length;
  assert.equal(shared(newResult), shared(oldResult), `${name}: structural sharing`);
  for (let i = 0; i < 3; i++) { before(next); after(next); }
  const timings = { before: [], after: [] };
  for (let i = 0; i < samples; i++) {
    // Alternate order to reduce a consistent warmup or scheduler advantage.
    for (const [label, run] of i % 2 ? [["after", after], ["before", before]] : [["before", before], ["after", after]]) {
      const start = performance.now();
      run(next);
      timings[label].push(performance.now() - start);
    }
  }
  measurements.push({ name, sharedArticles: shared(newResult), searchChanged: newResult.searchChanged,
    briefingChanged: newResult.briefingChanged, pending: newResult.pending.length,
    before: summarize(timings.before), after: summarize(timings.after) });
}
assert.equal(hash(await readFile(resolve(root, "src/model.ts"), "utf8")), afterHashes.model, "model changed during measurement");
assert.equal(hash(await readFile(resolve(root, "src/App.tsx"), "utf8")), afterHashes.app, "App changed during measurement");
assert.equal(hash(await readFile(fileURLToPath(import.meta.url), "utf8")), probeHash, "probe changed during measurement");
console.log(JSON.stringify({
  kind: "Node-only synthetic snapshot comparison pipeline; excludes React, browser, IPC, native database and fixture construction",
  createdAt: new Date().toISOString(), baseline, baselineSource: args["baseline-dir"] ? "provided baseline files; hashes recorded" : "git commit",
  beforeHashes, afterHashes, probeHash, changedDuringRun: [],
  environment: { node: process.version, platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model },
  articleCount: previous.articles.length, snapshotBytes: Buffer.byteLength(JSON.stringify(previous)), samples, measurements,
}, null, 2));
