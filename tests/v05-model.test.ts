import { expect, test } from "vitest";
import {
  filterArticles,
  matchesReadingStatus,
  unreadCounts,
  type ReadingStatus,
} from "../src/model";

const article = (patch: Record<string, unknown>) =>
  ({
    id: "a",
    title: "Report",
    excerpt: "",
    topics: ["science"],
    sections: ["technology"],
    sourceId: "wire",
    read: false,
    saved: false,
    hidden: false,
    firstSeen: 50,
    ...patch,
  }) as any;

const rows = [
  article({ id: "tech-unread", sections: ["technology"] }),
  article({ id: "tech-read", sections: ["technology"], read: true }),
  article({ id: "ai-unread", sections: ["ai"], topics: ["ai"] }),
  article({ id: "stocks-unread", sections: ["stocks"], topics: ["markets"] }),
  article({ id: "saved-unread", saved: true, sections: [] }),
  article({ id: "saved-read", saved: true, read: true, sections: [] }),
  article({ id: "hidden-unread", hidden: true, sections: [] }),
  article({ id: "hidden-read", hidden: true, read: true, sections: [] }),
  article({ id: "new-unread", firstSeen: 150, sections: [] }),
  article({ id: "old-unread", firstSeen: 50, sections: [] }),
  article({ id: "other-unread", sourceId: "rival", sections: [] }),
];

test("unread counts exclude read, hidden and non-matching rows and never count totals", () => {
  const counts = unreadCounts(rows, 100, []);
  expect(counts.all).toBe(7); // every visible unread row
  expect(counts.brief).toBe(1); // only firstSeen > previousVisit
  expect(counts.saved).toBe(1); // hidden saved rows are not visible saved rows
  expect(counts.hidden).toBe(1);
  expect(counts.sections.technology).toBe(1);
  expect(counts.sections.ai).toBe(1);
  expect(counts.sections.stocks).toBe(1);
  expect(counts.sections.others).toBe(4); // only rows with no focus section
  expect(Object.values(counts.sections).every((n) => n <= counts.all)).toBe(true);
});

test("watchlist counts use the watchlist's own dimension matching, including all-must-match", () => {
  const counts = unreadCounts(rows, 100, [
    { id: "w1", name: "Wire", keywords: [], topics: [], sources: ["wire"] },
    { id: "w2", name: "Impossible", keywords: ["nowhere"], topics: [], sources: [] },
    {
      id: "w3",
      name: "Both",
      keywords: ["report"],
      topics: ["ai"],
      sources: ["wire"],
    },
  ] as any);
  expect(counts.watchlists.w1).toBe(6); // every visible unread row from the wire
  expect(counts.watchlists.w2).toBe(0);
  // All three dimensions must match at once: only the AI row qualifies.
  expect(counts.watchlists.w3).toBe(1);
});

test("counts derive from filterArticles, so a count cannot disagree with its destination", () => {
  const watchlist = {
    id: "w1",
    name: "Wire",
    keywords: [],
    topics: ["science"],
    sources: ["wire"],
  } as any;
  const counts = unreadCounts(rows, 100, [watchlist]);
  const destination = filterArticles(
    rows,
    {
      id: "t",
      title: "W",
      topic: "",
      query: "",
      mode: "watchlist",
      watchlistId: "w1",
    } as any,
    100,
    watchlist,
  ).filter((a: any) => !a.read).length;
  expect(counts.watchlists.w1).toBe(destination);
});

test("reading status filters the collection without writing state", () => {
  const statuses: ReadingStatus[] = ["all", "unread", "read"];
  expect(
    rows.filter((a) => matchesReadingStatus(a, "all")),
  ).toHaveLength(rows.length);
  expect(
    rows.filter((a) => matchesReadingStatus(a, "unread")).map((a) => a.id),
  ).toEqual([
    "tech-unread",
    "ai-unread",
    "stocks-unread",
    "saved-unread",
    "hidden-unread",
    "new-unread",
    "old-unread",
    "other-unread",
  ]);
  expect(
    rows.filter((a) => matchesReadingStatus(a, "read")).map((a) => a.id),
  ).toEqual(["tech-read", "saved-read", "hidden-read"]);
  expect(statuses).toHaveLength(3);
});
