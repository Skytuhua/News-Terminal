import { expect, test } from "vitest";
import { filterSources, sourceFilterCount, type SourceFilter } from "../src/model";
import type { Source } from "../src/types";

const src = (over: Partial<Source>): Source => ({
  id: over.id || "s",
  name: "Source",
  url: "https://example.org/feed",
  homepage: "https://example.org",
  kind: "news",
  topics: [],
  region: "Global",
  language: "English",
  enabled: true,
  status: "ok",
  lastSuccess: 0,
  termsUrl: "https://example.org/terms",
  storage: "metadata",
  ...over,
});

const list: Source[] = [
  src({ id: "a", name: "Ars Technica", kind: "technology", region: "US", enabled: true, failures: 0 }),
  src({ id: "b", name: "Nature", kind: "science", region: "UK", enabled: true, failures: 3 }),
  src({ id: "c", name: "Local Paper", kind: "local", region: "US", enabled: false, failures: 0 }),
  src({ id: "d", name: "Der Spiegel", kind: "news", region: "DE", language: "German", enabled: true, failures: 0 }),
];

test("a blank query and the all filter return every source", () => {
  expect(filterSources(list, "  ", "all")).toHaveLength(4);
  expect(sourceFilterCount(list, "all")).toBe(4);
});

test("the query is trimmed and matched case-insensitively", () => {
  expect(filterSources(list, "  nature ", "all").map((s) => s.id)).toEqual(["b"]);
  expect(filterSources(list, "NATURE", "all").map((s) => s.id)).toEqual(["b"]);
});

test("the query matches name, publisher, kind and region", () => {
  expect(filterSources(list, "spiegel", "all").map((s) => s.id)).toEqual(["d"]);
  expect(filterSources(list, "technology", "all").map((s) => s.id)).toEqual(["a"]);
  expect(filterSources(list, "DE", "all").map((s) => s.id)).toEqual(["d"]);
});

test("a query matches any field at once, not just the first", () => {
  // "local" is a kind, and "Local Paper" is a name.
  expect(filterSources(list, "local", "all").map((s) => s.id)).toEqual(["c"]);
});

test("the enabled filter keeps only enabled sources", () => {
  expect(filterSources(list, "", "enabled").map((s) => s.id)).toEqual(["a", "b", "d"]);
  expect(sourceFilterCount(list, "enabled")).toBe(3);
});

test("the disabled filter keeps only disabled sources", () => {
  expect(filterSources(list, "", "disabled").map((s) => s.id)).toEqual(["c"]);
});

test("the failing filter keeps only enabled sources with failures", () => {
  // A disabled source is not "failing" - it is switched off, which is a
  // deliberate state rather than a delivery problem.
  expect(filterSources(list, "", "failing").map((s) => s.id)).toEqual(["b"]);
});

test("the query and the filter combine", () => {
  expect(filterSources(list, "us", "enabled").map((s) => s.id)).toEqual(["a"]);
  expect(filterSources(list, "us", "disabled").map((s) => s.id)).toEqual(["c"]);
});

test("a query matching nothing returns an empty list, never everything", () => {
  expect(filterSources(list, "nonexistent", "all")).toEqual([]);
  expect(sourceFilterCount(list, "failing")).toBe(1);
});

test("filtering never mutates the input order or the input array", () => {
  const before = list.map((s) => s.id);
  filterSources(list, "", "enabled");
  expect(list.map((s) => s.id)).toEqual(before);
});
