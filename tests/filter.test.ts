import { test, expect } from "vitest";
import { filterArticles } from "../src/model";
const rows: any[] = [
  {
    id: "a",
    title: "Space report",
    excerpt: "Moon",
    topics: ["science"],
    sourceId: "nasa",
    saved: true,
    hidden: false,
  },
  {
    id: "b",
    title: "Business",
    excerpt: "Stocks",
    topics: ["business"],
    sourceId: "other",
    saved: false,
    hidden: false,
  },
];
test("saved and topic filters narrow cached rows", () =>
  expect(
    filterArticles(
      rows,
      { mode: "saved", topic: "science" } as any,
      0,
      undefined,
    ).map((a) => a.id),
  ).toEqual(["a"]));
test("watchlist requires each configured dimension", () =>
  expect(
    filterArticles(rows, { mode: "watchlist" } as any, 0, {
      keywords: ["moon"],
      topics: ["science"],
      sources: ["nasa"],
    } as any).map((a) => a.id),
  ).toEqual(["a"]));

test("focus section filters use section membership without rewriting legacy topics", () => {
  const focusRows = [
    { id: "ai", hidden: false, topics: ["technology"], sections: ["ai", "technology"] },
    { id: "stocks", hidden: false, topics: ["business"], sections: ["stocks"] },
    { id: "general", hidden: false, topics: ["business"], sections: ["others"] },
    { id: "legacy", hidden: false, topics: ["science"] },
  ];
  expect(filterArticles(focusRows as any, { mode: "all", section: "ai" } as any, 0).map((a) => a.id)).toEqual(["ai"]);
  expect(filterArticles(focusRows as any, { mode: "all", section: "stocks" } as any, 0).map((a) => a.id)).toEqual(["stocks"]);
  expect(filterArticles(focusRows as any, { mode: "all", section: "others" } as any, 0).map((a) => a.id)).toEqual(["general", "legacy"]);
});
