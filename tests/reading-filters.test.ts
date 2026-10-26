import { expect, test } from "vitest";
import { filterReadingArticles, publisherOptions, type PublicationRange } from "../src/readingFilters";
import type { Article } from "../src/types";

const now = 2_000_000_000;
const article = (patch: Partial<Article> = {}): Article => ({
  id: "story",
  sourceId: "wire",
  sourceName: "Science Wire",
  title: "A cached report",
  url: "https://example.org/story",
  excerpt: "A permitted excerpt.",
  publishedAt: now,
  firstSeen: now,
  updatedAt: now,
  topics: ["science"],
  region: "world",
  language: "en",
  kind: "reporting",
  read: false,
  saved: false,
  hidden: false,
  groupId: "story",
  reasons: [],
  score: 1,
  history: [],
  ...patch,
});

test("default reading filters preserve every accepted article and the array identity", () => {
  const rows = [
    article({ id: "unknown", publishedAt: null }),
    article({ id: "future", publishedAt: now + 1 }),
    article({ id: "invalid", publishedAt: NaN }),
    article({ id: "infinite", publishedAt: Infinity }),
    article({ id: "old", publishedAt: 0 }),
  ];
  expect(filterReadingArticles(rows, "", "all", now)).toBe(rows);
});

test("publisher filtering matches the exact source ID rather than its display name", () => {
  const rows = [
    article({ id: "first", sourceId: "wire", sourceName: "Renamed publisher" }),
    article({ id: "same-name", sourceId: "other", sourceName: "Science Wire" }),
    article({ id: "different-case", sourceId: "Wire" }),
    article({ id: "unknown-date", sourceId: "wire", publishedAt: null }),
  ];
  expect(filterReadingArticles(rows, "wire", "all", now).map(row => row.id))
    .toEqual(["first", "unknown-date"]);
  expect(filterReadingArticles(rows, "Science Wire", "all", now)).toEqual([]);
});

test.each<{ range: PublicationRange; lower: number }>([
  { range: "day", lower: 1_999_913_600 },
  { range: "week", lower: 1_999_395_200 },
  { range: "month", lower: 1_997_408_000 },
])("$range includes its exact lower bound and the present, but excludes older and future dates", ({ range, lower }) => {
  const rows = [
    article({ id: "too-old", publishedAt: lower - 1 }),
    article({ id: "at-lower", publishedAt: lower }),
    article({ id: "inside", publishedAt: lower + 1 }),
    article({ id: "at-now", publishedAt: now }),
    article({ id: "future", publishedAt: now + 1 }),
  ];
  expect(filterReadingArticles(rows, "", range, now).map(row => row.id))
    .toEqual(["at-lower", "inside", "at-now"]);
});

test.each<PublicationRange>(["day", "week", "month"])("%s excludes unknown and nonfinite publication dates", range => {
  const rows = [
    article({ id: "unknown", publishedAt: null }),
    article({ id: "nan", publishedAt: NaN }),
    article({ id: "positive-infinity", publishedAt: Infinity }),
    article({ id: "negative-infinity", publishedAt: -Infinity }),
    article({ id: "dated", publishedAt: now }),
  ];
  expect(filterReadingArticles(rows, "", range, now).map(row => row.id)).toEqual(["dated"]);
});

test("publication filters do not substitute a recent first-seen date", () => {
  const rows = [
    article({ id: "recently-fetched", publishedAt: now - 86_401, firstSeen: now }),
    article({ id: "undated", publishedAt: null, firstSeen: now }),
    article({ id: "recent-publication", publishedAt: now, firstSeen: now - 86_401 }),
  ];
  expect(filterReadingArticles(rows, "", "day", now).map(row => row.id))
    .toEqual(["recent-publication"]);
});

test("publisher and publication filters intersect without mutating or reordering articles", () => {
  const rows = [
    article({ id: "second-newest", publishedAt: now - 2 }),
    article({ id: "other-publisher", sourceId: "other", publishedAt: now }),
    article({ id: "old", publishedAt: now - 86_401 }),
    article({ id: "newest", publishedAt: now - 1 }),
  ];
  const original = [...rows];
  rows.forEach(row => Object.freeze(row));
  Object.freeze(rows);
  const filtered = filterReadingArticles(rows, "wire", "day", now);
  expect(filtered.map(row => row.id)).toEqual(["second-newest", "newest"]);
  expect(filtered[0]).toBe(rows[0]);
  expect(filtered[1]).toBe(rows[3]);
  expect(rows).toEqual(original);
});

test("publisher options deduplicate by source ID and sort names with an ID tie-break", () => {
  const rows = [
    article({ sourceId: "z", sourceName: "Zulu" }),
    article({ sourceId: "b", sourceName: "Alpha" }),
    article({ sourceId: "a", sourceName: "Alpha" }),
    article({ sourceId: "b", sourceName: "Alpha" }),
  ];
  const original = [...rows];
  Object.freeze(rows);
  expect(publisherOptions(rows)).toEqual([
    { id: "a", name: "Alpha" },
    { id: "b", name: "Alpha" },
    { id: "z", name: "Zulu" },
  ]);
  expect(rows).toEqual(original);
});

test("empty accepted collections produce no reading results or publisher options", () => {
  expect(filterReadingArticles([], "missing", "day", now)).toEqual([]);
  expect(publisherOptions([])).toEqual([]);
});
