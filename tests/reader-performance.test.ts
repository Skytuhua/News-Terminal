import { expect, test, vi } from "vitest";
import { reconcileArticles, sameBriefingInputs, sameSearchInputs, sameSnapshotValue } from "../src/model";
import type { Article, Snapshot } from "../src/types";

const article = (id = "a"): Article => ({
  id, sourceId: "wire", sourceName: "Science Wire", title: `Story ${id}`,
  url: `https://example.org/${id}`, excerpt: "A multilingual report. 科学 الخبر",
  publishedAt: 100, firstSeen: 110, updatedAt: 120, topics: ["science", "technology"],
  sections: ["technology"], topicLabels: ["Science"], classificationVersion: 1,
  classificationReasons: ["Topic match"], region: "world", language: "en", kind: "reporting",
  aiAllowed: true, read: false, saved: false, hidden: false, groupId: "group", reasons: ["Recent"], score: 1,
  history: [{ at: 90, title: "Earlier title", excerpt: "Earlier excerpt" }],
  media: [{ kind: "image", url: "https://example.org/image.png", mimeType: "image/png", caption: "Caption", credit: "Wire", playback: "inline" }],
});

// Exhaustive at compile time: adding an Article field requires a change case.
const changedFields: Required<Article> = {
  id: "changed", sourceId: "other", sourceName: "Other wire", title: "Corrected story",
  url: "https://example.org/corrected", excerpt: "Corrected excerpt", publishedAt: null,
  firstSeen: 111, updatedAt: 121, topics: ["technology", "science"], sections: ["ai"],
  topicLabels: ["AI"], classificationVersion: 2, classificationReasons: ["Corrected classification"],
  region: "local", language: "ar", kind: "opinion", aiAllowed: false, read: true, saved: true,
  hidden: true, groupId: "other-group", reasons: ["New reason"], score: 2,
  history: [{ at: 90, title: "Earlier title", excerpt: "Corrected history" }],
  media: [{ kind: "image", url: "https://example.org/image.png", mimeType: "image/png", caption: "Corrected caption", credit: "Wire", playback: "inline" }],
};

function snapshot(articles = [article(), article("b")]): Snapshot {
  const profile: Snapshot["profile"] = {
    id: "default", name: "Desk", preferences: {
      topics: [], regions: [], languages: [], sources: [], keywords: [], excludeKeywords: [], diversityCap: .5,
    }, quietHours: { enabled: false, start: "22:00", end: "07:00" },
    alertsEnabled: false, lastVisit: 200, previousVisit: 100,
  };
  return {
    replacementToken: "fixture", profiles: [profile], profile, articles,
    sources: [{ id: "wire", name: "Wire", url: "https://example.org/feed", homepage: "https://example.org",
      kind: "reporting", topics: [], region: "world", language: "en", enabled: true, aiAllowed: true,
      mediaAllowed: true, storage: "excerpt", status: "Healthy", lastSuccess: 200, termsUrl: "https://example.org/terms" }],
    watchlists: [], providers: [], lastRefresh: 200,
    workspace: { activeTabId: "home", revision: 0, tabs: [{ id: "home", title: "Headlines", mode: "all", topic: "", query: "" }] },
  };
}

const legacySearchInput = (s: Snapshot) => JSON.stringify([
  s.profile.preferences, s.articles.map(({ read: _read, saved: _saved, ...searchable }) => searchable),
]);
const legacyBriefingInput = (s: Snapshot) => JSON.stringify([
  s.profile.preferences,
  s.sources.map(({ id, enabled, storage, aiAllowed, mediaAllowed }) => [id, enabled, storage, aiAllowed, mediaAllowed]),
  s.articles.map(({ id, updatedAt, title, excerpt, url, sourceId, sourceName, publishedAt, topics, sections, topicLabels, region, language, kind, aiAllowed, hidden, media }) =>
    [id, updatedAt, title, excerpt, url, sourceId, sourceName, publishedAt, topics, sections, topicLabels, region, language, kind, aiAllowed, hidden, media]),
]);

test("equivalent full snapshots retain every article identity and the accepted array", () => {
  const previous = [article(), article("b")];
  const next = structuredClone(previous);
  Object.freeze(previous);
  previous.forEach(a => { Object.freeze(a); Object.freeze(a.history); Object.freeze(a.media); });
  expect(reconcileArticles(previous, next)).toBe(previous);
  expect(next).toEqual(previous);
  expect(reconcileArticles(previous, previous)).toBe(previous);
});

test("each article field remains authoritative and uses the existing search and briefing invalidation rules", () => {
  const previous = snapshot();
  for (const [field, value] of Object.entries(changedFields)) {
    const next = structuredClone(previous);
    Object.assign(next.articles[0], { [field]: value });
    const reconciled = reconcileArticles(previous.articles, next.articles);
    expect(reconciled[0], field).toBe(next.articles[0]);
    expect(reconciled[1], field).toBe(previous.articles[1]);
    expect(reconciled[0], field).toEqual(next.articles[0]);
    expect(sameSearchInputs(previous, next), field).toBe(legacySearchInput(previous) === legacySearchInput(next));
    expect(sameBriefingInputs(previous, next), field).toBe(legacyBriefingInput(previous) === legacyBriefingInput(next));
  }
});

test("insertions, deletions and reordered readbacks preserve incoming order and surviving identities", () => {
  const previous = [article("a"), article("b"), article("c")];
  const incoming = [structuredClone(previous[2]), article("new"), structuredClone(previous[0])];
  const result = reconcileArticles(previous, incoming);
  expect(result.map(a => a.id)).toEqual(["c", "new", "a"]);
  expect(result[0]).toBe(previous[2]);
  expect(result[1]).toBe(incoming[1]);
  expect(result[2]).toBe(previous[0]);
  expect(previous.map(a => a.id)).toEqual(["a", "b", "c"]);
  expect(sameSearchInputs(snapshot(previous), snapshot(result))).toBe(false);
  expect(sameBriefingInputs(snapshot(previous), snapshot(result))).toBe(false);
  expect(reconcileArticles(previous, [])).toEqual([]);
});

test("nested media, history and future wire fields are compared, including keys with equal counts", () => {
  const previous = snapshot();
  const extended = previous.articles[0] as Article & { extension: { read: boolean; labels: string[] } };
  extended.extension = { read: false, labels: ["a", "b"] };
  for (const mutate of [
    (a: typeof extended) => { a.extension.read = true; },
    (a: typeof extended) => { a.extension.labels.reverse(); },
    (a: typeof extended) => { (a as any).extension = { read: false, renamed: ["a", "b"] }; },
    (a: typeof extended) => { a.media![0].playback = "external"; },
    (a: typeof extended) => { a.history[0].at++; },
  ]) {
    const next = structuredClone(previous);
    mutate(next.articles[0] as typeof extended);
    expect(reconcileArticles(previous.articles, next.articles)[0]).toBe(next.articles[0]);
    expect(sameSearchInputs(previous, next)).toBe(false);
  }
  expect(sameSnapshotValue({ a: 1 }, { b: 1 })).toBe(false);
  expect(sameSnapshotValue({ nested: { a: 1 } }, { nested: { b: 1 } })).toBe(false);
});

test("object key order and undefined object properties preserve JSON data, while array order and null values remain significant", () => {
  const previous = [article()];
  delete previous[0].media;
  const reordered = Object.fromEntries(Object.entries(previous[0]).reverse()) as Article;
  reordered.media = undefined;
  expect(reconcileArticles(previous, [reordered])).toBe(previous);
  expect(sameSearchInputs(snapshot(previous), snapshot([reordered]))).toBe(true);
  expect(sameSnapshotValue([undefined], [null])).toBe(true);
  expect(sameSnapshotValue(Array(1), [1])).toBe(false);
  expect(sameSnapshotValue({ value: null }, {})).toBe(false);
  expect(sameSnapshotValue(["a", "b"], ["b", "a"])).toBe(false);
  expect(sameSnapshotValue({ "0": "a" }, ["a"])).toBe(false);
  const nullable = structuredClone(previous);
  (nullable[0] as any).media = null;
  expect(sameSearchInputs(snapshot(previous), snapshot(nullable))).toBe(false);
  expect(sameBriefingInputs(snapshot(previous), snapshot(nullable))).toBe(true);
});

test("preferences and briefing source permissions invalidate only the existing inputs", () => {
  const previous = snapshot();
  const cases: ((s: Snapshot) => void)[] = [
    s => { s.profile.preferences.keywords = ["science"]; },
    s => { s.profile.preferences.diversityCap = .7; },
    s => { s.sources[0].enabled = false; },
    s => { s.sources[0].storage = "metadata"; },
    s => { s.sources[0].aiAllowed = false; },
    s => { s.sources[0].mediaAllowed = false; },
    s => { delete s.sources[0].mediaAllowed; },
    s => { s.sources[0].status = "Stale"; s.sources[0].failures = 2; },
    s => { s.workspace.revision = 3; s.workspace.tabs[0].selectedId = "b"; },
    s => { s.providers.push({ id: "ollama", name: "Ollama", kind: "ollama", model: "fixture", enabled: true, consented: false, hasKey: false }); },
    s => { s.sources.reverse(); s.articles.reverse(); },
  ];
  for (const mutate of cases) {
    const next = structuredClone(previous);
    mutate(next);
    expect(sameSearchInputs(previous, next)).toBe(legacySearchInput(previous) === legacySearchInput(next));
    expect(sameBriefingInputs(previous, next)).toBe(legacyBriefingInput(previous) === legacyBriefingInput(next));
  }
});

test("5000 cloned articles and a changed read marker need no serialization and share every unchanged row", () => {
  const previous = snapshot(Array.from({ length: 5000 }, (_, i) => article(String(i))));
  const next = structuredClone(previous);
  next.articles[2500].read = true;
  const stringify = vi.spyOn(JSON, "stringify").mockImplementation(() => { throw new Error("Unexpected cache serialization"); });
  let searchUnchanged = false;
  let briefingUnchanged = false;
  try {
    next.articles = reconcileArticles(previous.articles, next.articles);
    searchUnchanged = sameSearchInputs(previous, next);
    briefingUnchanged = sameBriefingInputs(previous, next);
  } finally {
    stringify.mockRestore();
  }
  expect(next.articles.filter((a, i) => a === previous.articles[i])).toHaveLength(4999);
  expect(next.articles[2500].read).toBe(true);
  expect(previous.articles[2500].read).toBe(false);
  expect(searchUnchanged).toBe(true);
  expect(briefingUnchanged).toBe(true);
});
