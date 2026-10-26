import type { Article } from "./types";

export type PublicationRange = "all" | "day" | "week" | "month";

const publicationSeconds = {
  day: 24 * 60 * 60,
  week: 7 * 24 * 60 * 60,
  month: 30 * 24 * 60 * 60,
};

export function filterReadingArticles(
  rows: Article[],
  publisherId: string,
  published: PublicationRange,
  nowSeconds: number,
): Article[] {
  if (!publisherId && published === "all") return rows;
  const lower = published === "all" ? 0 : nowSeconds - publicationSeconds[published];
  return rows.filter(article =>
    (!publisherId || article.sourceId === publisherId) &&
    (published === "all" || (
      article.publishedAt !== null &&
      Number.isFinite(article.publishedAt) &&
      article.publishedAt >= lower && article.publishedAt <= nowSeconds
    )),
  );
}

export function publisherOptions(rows: Article[]): { id: string; name: string }[] {
  const publishers = new Map<string, string>();
  for (const article of rows) {
    if (!publishers.has(article.sourceId))
      publishers.set(article.sourceId, article.sourceName);
  }
  return Array.from(publishers, ([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
