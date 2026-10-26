import type { Article, FocusSection, Snapshot, Source, Tab, Watchlist } from "./types";
export const sourceFailed = (source: Source) => source.enabled && Number.isFinite(source.failures) && (source.failures ?? 0) > 0;
// 0.5 cache disclosure. The host prunes silently: an unsaved story disappears
// after 30 days, or once it falls outside the newest 5000, whichever comes
// first. Saved stories are exempt. A reader relying on cached stories offline
// has no way to learn that today, which makes the policy worth stating rather
// than leaving it buried in the Rust. These numbers mirror `retain` in
// src-tauri/src/db.rs and are asserted in tests/v05-cache-disclosure.test.ts -
// a disclosure that lies is worse than no disclosure.
export const CACHE_LIMITS = {
  articleDays: 30,
  articleMax: 5000,
  alertReceiptDays: 90,
  alertAttemptMinutes: 10,
} as const;

export function cacheDisclosure(articles: Article[]) {
  let saved = 0;
  let unread = 0;
  for (const a of articles) {
    if (a.saved) saved++;
    if (!a.read) unread++;
  }
  return { cached: articles.length, saved, unread, keepsSavedForever: true };
}
// 0.5 source search and filter. Thirty sources with no way to find one is a
// real daily-use cost, so the matching lives in the model layer where it can be
// tested without a browser rather than inside a component.
export type SourceFilter = "all" | "enabled" | "disabled" | "failing";

export function filterSources(sources: Source[], query: string, filter: SourceFilter): Source[] {
  const q = query.trim().toLowerCase();
  return sources.filter((s) => {
    if (filter === "enabled" && !s.enabled) return false;
    // A disabled source is not "failing": it is switched off, which is a
    // deliberate state rather than a delivery problem.
    if (filter === "disabled" && s.enabled) return false;
    if (filter === "failing" && !sourceFailed(s)) return false;
    if (!q) return true;
    return (
      s.name.toLowerCase().includes(q) ||
      (s.publisher || "").toLowerCase().includes(q) ||
      s.kind.toLowerCase().includes(q) ||
      s.region.toLowerCase().includes(q) ||
      s.language.toLowerCase().includes(q)
    );
  });
}

// Counts describe the whole list under a filter, ignoring the query, so the
// chips keep showing how many sources each state holds while a search is typed.
export function sourceFilterCount(sources: Source[], filter: SourceFilter): number {
  return filterSources(sources, "", filter).length;
}
export function sourceEligibleAt(source: Source) {
  // Match the host scheduler, not publication age. Legacy status text is not a clock.
  const last = Number.isInteger(source.lastAttempt) ? source.lastAttempt! : undefined;
  const retry = Number.isInteger(source.retryAt) ? source.retryAt! : undefined;
  if (last === undefined && retry === undefined) return undefined;
  const minutes = Number.isInteger(source.refreshMinutes) ? source.refreshMinutes! : 30;
  return Math.max(retry ?? 0, last === undefined ? 0 : last + Math.min(1440, Math.max(5, minutes)) * 60);
}

export function filterArticles(
  rows: Article[],
  tab: Tab,
  previousVisit: number,
  watchlist?: Watchlist,
) {
  const sectionMatches = (a: Article, section?: FocusSection) => {
    if (!section) return true;
    const sections = a.sections || [];
    if (section === "others") return sections.length === 0 || sections.includes("others");
    return sections.includes(section);
  };
  return rows.filter(
    (a) =>
      !a.hidden &&
      sectionMatches(a, tab.section) &&
      (tab.mode !== "brief" || a.firstSeen > previousVisit) &&
      (tab.mode !== "saved" || a.saved) &&
      (!tab.topic || a.topics.includes(tab.topic)) &&
      (tab.mode !== "watchlist" ||
        (!!watchlist &&
          (!watchlist.keywords.length ||
            watchlist.keywords.some((k) =>
              (a.title + " " + a.excerpt)
                .toLowerCase()
                .includes(k.toLowerCase()),
            )) &&
          (!watchlist.topics.length ||
            watchlist.topics.some((t) => a.topics.includes(t))) &&
          (!watchlist.sources.length ||
            watchlist.sources.includes(a.sourceId)))),
  );
}
export type ReadingStatus = "all" | "unread" | "read";
export const matchesReadingStatus = (
  article: { read: boolean },
  status: ReadingStatus,
) =>
  status === "all" || (status === "unread" ? !article.read : article.read);

export type UnreadCounts = {
  all: number;
  brief: number;
  saved: number;
  hidden: number;
  sections: Record<FocusSection, number>;
  watchlists: Record<string, number>;
};

/**
 * One projection for every navigation badge.
 *
 * Each count is the unread row count of the destination's own
 * `filterArticles` call, so a badge can never disagree with what the
 * destination lists. Unread only; hidden rows are excluded everywhere
 * except the Hidden stories destination itself.
 */
export function unreadCounts(
  rows: readonly Article[],
  previousVisit: number,
  watchlists: readonly Watchlist[],
): UnreadCounts {
  const tab = (patch: Partial<Tab>): Tab =>
    ({ id: "", title: "", topic: "", query: "", mode: "all", ...patch }) as Tab;
  const unread = (patch: Partial<Tab>, watchlist?: Watchlist) =>
    filterArticles(
      rows as Article[],
      tab(patch),
      previousVisit,
      watchlist,
    ).filter((a) => !a.read).length;
  const sections = {} as Record<FocusSection, number>;
  for (const section of focusSections)
    sections[section.id] = unread({ section: section.id });
  const watchlistCounts: Record<string, number> = {};
  for (const watchlist of watchlists)
    watchlistCounts[watchlist.id] = unread(
      { mode: "watchlist", watchlistId: watchlist.id },
      watchlist,
    );
  return {
    all: unread({ mode: "all" }),
    brief: unread({ mode: "brief" }),
    saved: unread({ mode: "saved" }),
    // Hidden stories live in their own view, so count them directly rather
    // than through the headline predicate that deliberately excludes them.
    hidden: rows.filter((a) => a.hidden && !a.read).length,
    sections,
    watchlists: watchlistCounts,
  };
}

// Snapshots contain JSON data. Compare values without allocating serialized
// copies of every article. Object key order and omitted undefined properties do
// not change that data; array order (including history and media) does.
export function sameSnapshotValue(previous: unknown, next: unknown): boolean {
  if (previous === next) return true;
  if (previous === null || next === null || typeof previous !== "object" || typeof next !== "object") return false;
  if (Array.isArray(previous)) {
    if (!Array.isArray(next) || previous.length !== next.length) return false;
    for (let i = 0; i < previous.length; i++)
      if (!sameSnapshotValue(previous[i] ?? null, next[i] ?? null)) return false;
    return true;
  }
  if (Array.isArray(next)) return false;
  const before = previous as Record<string, unknown>;
  const after = next as Record<string, unknown>;
  let beforeCount = 0;
  for (const key of Object.keys(before)) {
    if (before[key] === undefined) continue;
    beforeCount++;
    if (!Object.hasOwn(after, key) || !sameSnapshotValue(before[key], after[key])) return false;
  }
  let afterCount = 0;
  for (const key of Object.keys(after)) if (after[key] !== undefined) afterCount++;
  return beforeCount === afterCount;
}

export function reconcileArticles(previous: Article[], next: Article[]) {
  if (previous === next) return previous;
  const byId = new Map(previous.map(article => [article.id, article]));
  const reconciled = next.map(article => {
    const old = byId.get(article.id);
    return old && sameSnapshotValue(old, article) ? old : article;
  });
  return reconciled.length === previous.length && reconciled.every((article, i) => article === previous[i]) ? previous : reconciled;
}

function sameSearchArticle(previous: Article, next: Article) {
  if (previous === next) return true;
  // Search previously fingerprinted every field except these two local markers.
  // Keep unknown wire fields in the comparison so future metadata invalidates it.
  const before = previous as unknown as Record<string, unknown>;
  const after = next as unknown as Record<string, unknown>;
  const searchable = (article: Record<string, unknown>) => Object.keys(article)
    .filter(key => key !== "read" && key !== "saved" && article[key] !== undefined);
  const keys = searchable(before);
  return keys.length === searchable(after).length && keys.every(key =>
    Object.hasOwn(after, key) && sameSnapshotValue(before[key], after[key]));
}

export function sameSearchInputs(previous: Snapshot, next: Snapshot) {
  return sameSnapshotValue(previous.profile.preferences, next.profile.preferences) &&
    previous.articles.length === next.articles.length &&
    previous.articles.every((article, i) => sameSearchArticle(article, next.articles[i]));
}

const briefingArticleFields = [
  "id", "updatedAt", "title", "excerpt", "url", "sourceId", "sourceName", "publishedAt", "topics",
  "sections", "topicLabels", "region", "language", "kind", "aiAllowed", "hidden", "groupId", "media",
] as const satisfies readonly (keyof Article)[];
const briefingSourceFields = ["id", "enabled", "storage", "aiAllowed", "mediaAllowed"] as const satisfies readonly (keyof Source)[];
function sameFields<T>(previous: T, next: T, fields: readonly (keyof T)[]) {
  // The former array projection serialized absent optional fields as null.
  return previous === next || fields.every(key => sameSnapshotValue(previous[key] ?? null, next[key] ?? null));
}

export function sameBriefingInputs(previous: Snapshot, next: Snapshot) {
  return sameSnapshotValue(previous.profile.preferences, next.profile.preferences) &&
    previous.sources.length === next.sources.length &&
    previous.sources.every((source, i) => sameFields(source, next.sources[i], briefingSourceFields)) &&
    previous.articles.length === next.articles.length &&
    previous.articles.every((article, i) => sameFields(article, next.articles[i], briefingArticleFields));
}
export function relatedCounts(articles: readonly Article[]) {
  const counts = new Map<string, number>();
  for (const article of articles) counts.set(article.groupId, (counts.get(article.groupId) || 0) + 1);
  return counts;
}
export const list = (value: string) =>
  value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
export const date = (value: number | null) =>
  value !== null && Number.isFinite(value)
    ? new Date(value * 1000).toLocaleString()
    : "Publication time unavailable";
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
function formatter(locale: string | undefined, options: Intl.DateTimeFormatOptions) {
  const key = JSON.stringify([locale, options]);
  let format = dateFormatters.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, options);
    dateFormatters.set(key, format);
  }
  return format;
}
export function compactDate(value: number | null, now = new Date(), locale?: string, timeZone?: string) {
  const published = new Date(value === null ? NaN : value * 1000);
  if (!Number.isFinite(published.getTime())) return "Undated";
  const calendar = (date: Date) => {
    const parts = formatter('en-US', {year:'numeric', month:'numeric', day:'numeric', timeZone}).formatToParts(date);
    const get = (type: string) => Number(parts.find(part => part.type === type)!.value);
    return {year:get('year'), day: Date.UTC(get('year'), get('month') - 1, get('day'))};
  };
  const today = calendar(now), day = calendar(published);
  if (today.day === day.day) return formatter(locale, {hour:'2-digit', minute:'2-digit', timeZone}).format(published);
  if (today.day - day.day === 86400000) return new Intl.RelativeTimeFormat(locale, {numeric:'auto'}).format(-1, 'day');
  return formatter(locale, {month:'short', day:'numeric', ...(today.year !== day.year ? {year:'numeric' as const} : {}), timeZone}).format(published);
}
export const topics = [
  "ai",
  "politics",
  "business",
  "markets",
  "technology",
  "science",
  "health",
  "weather",
  "climate",
  "sports",
  "entertainment",
  "culture",
];
export const focusSections: { id: FocusSection; title: string }[] = [
  { id: "ai", title: "AI" },
  { id: "technology", title: "Technology" },
  { id: "stocks", title: "Stocks" },
  { id: "others", title: "Others" },
];
