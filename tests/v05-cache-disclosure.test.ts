import { expect, test } from "vitest";
import { cacheDisclosure, CACHE_LIMITS } from "../src/model";
import type { Article } from "../src/types";

const art = (over: Partial<Article> = {}): Article => ({
  id: "a",
  title: "Story",
  url: "https://example.org/a",
  excerpt: "",
  sourceName: "Source",
  sourceId: "s",
  publishedAt: 1,
  firstSeen: 1,
  updatedAt: 1,
  topics: [],
  region: "world",
  language: "en",
  kind: "reporting",
  read: false,
  saved: false,
  hidden: false,
  groupId: "a",
  reasons: [],
  score: 0,
  history: [],
  ...over,
});

test("the limits state the host retention policy, not a guess", () => {
  // These numbers must match src-tauri/src/db.rs `retain`. A disclosure that
  // lies is worse than no disclosure.
  expect(CACHE_LIMITS.articleDays).toBe(30);
  expect(CACHE_LIMITS.articleMax).toBe(5000);
  expect(CACHE_LIMITS.alertReceiptDays).toBe(90);
  expect(CACHE_LIMITS.alertAttemptMinutes).toBe(10);
});

test("a disclosure reports the current cache size", () => {
  const d = cacheDisclosure([art(), art({ id: "b" }), art({ id: "c", saved: true })]);
  expect(d.cached).toBe(3);
  expect(d.saved).toBe(1);
  expect(d.unread).toBe(3);
});

test("saving a story does not make it read", () => {
  // Saving protects a story from pruning; it is not a read receipt. Counting a
  // saved-but-unread story as read would hide it from the Unread filter while
  // still being unread, which is exactly the confusion this panel should avoid.
  const d = cacheDisclosure([art({ saved: true }), art({ id: "b", saved: true, read: true })]);
  expect(d.saved).toBe(2);
  expect(d.unread).toBe(1);
});

test("an empty cache reports zeroes rather than blank or negative values", () => {
  const d = cacheDisclosure([]);
  expect(d.cached).toBe(0);
  expect(d.saved).toBe(0);
  expect(d.unread).toBe(0);
  expect(d.keepsSavedForever).toBe(true);
});

test("the disclosure always says saved stories survive pruning", () => {
  expect(cacheDisclosure([]).keepsSavedForever).toBe(true);
  expect(cacheDisclosure([art()]).keepsSavedForever).toBe(true);
});
