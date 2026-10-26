import { expect, test } from "vitest";
import { sameBriefingInputs } from "../src/model";
import type { Snapshot } from "../src/types";

function snapshot(): Snapshot {
  const profile: Snapshot["profile"] = {
    id: "default", name: "Desk",
    preferences: { topics: [], regions: [], languages: [], sources: [], keywords: [], excludeKeywords: [], diversityCap: .5 },
    quietHours: { enabled: false, start: "22:00", end: "07:00" },
    alertsEnabled: false, lastVisit: 200, previousVisit: 100,
  };
  return {
    replacementToken: "fixture", profiles: [profile], profile,
    sources: [], watchlists: [], providers: [], lastRefresh: 200,
    workspace: { activeTabId: "home", tabs: [{ id: "home", title: "Headlines", mode: "all", topic: "", query: "" }] },
    articles: [{
      id: "a", sourceId: "wire", sourceName: "Science Wire", title: "A science report",
      url: "https://example.org/a", excerpt: "Publisher excerpt", publishedAt: 200,
      firstSeen: 200, updatedAt: 200, topics: ["science"], region: "world", language: "en",
      kind: "reporting", aiAllowed: true, read: false, saved: false, hidden: false,
      groupId: "automatic-group", reasons: [], score: 1, history: [],
    }],
  };
}

test("a profile group split invalidates briefing inputs without changing article content", () => {
  const previous = snapshot();
  const next = structuredClone(previous);
  next.articles[0].groupId = "split:default:a";
  expect(sameBriefingInputs(previous, next)).toBe(false);
});

test("reading and saving preserve briefing inputs, including existing group splits", () => {
  const previous = snapshot();
  previous.articles[0].groupId = "split:default:a";
  const next = structuredClone(previous);
  next.articles[0].read = true;
  next.articles[0].saved = true;
  expect(sameBriefingInputs(previous, next)).toBe(true);
});
