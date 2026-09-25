import type { Article, FocusSection, Source, Tab, Watchlist } from "./types";
export const sourceFailed = (source: Source) => source.enabled && Number.isFinite(source.failures) && (source.failures ?? 0) > 0;
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
export function reconcileArticles(previous: Article[], next: Article[]) {
  const byId = new Map(previous.map(article => [article.id, article]));
  const reconciled = next.map(article => {
    const old = byId.get(article.id);
    return old && JSON.stringify(old) === JSON.stringify(article) ? old : article;
  });
  return reconciled.length === previous.length && reconciled.every((article, i) => article === previous[i]) ? previous : reconciled;
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
