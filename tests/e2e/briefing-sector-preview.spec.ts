import { test, expect, type Page } from "@playwright/test";
import { fixture } from "./fixture";

// Opening the briefing must not pay for sector source previews the user has not
// asked to see. The preview is only displayed behind that sector's collapsed
// "Review selected source inputs" disclosure, and Generate is disabled until it
// arrives, so an unexpanded preview is work with no reader-visible purpose.
const science = (page: Page) =>
  page.getByRole("region", { name: "Science source quotations", exact: true });
const disclosure = (page: Page) =>
  science(page).getByText("Review selected source inputs", { exact: true });

const previewCalls = (page: Page) =>
  page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) => r.op === "sector_summary_preview"));
const briefCalls = (page: Page) =>
  page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) => r.op === "daily_brief"));

async function openBriefing(page: Page) {
  await fixture(page, { v02: true });
  await page.evaluate(() => {
    const w = window as any;
    const s = w.__TEST_SNAPSHOT__();
    w.__TEST_PATCH__({ providers: s.providers.map((p: any) => ({ ...p, enabled: true, consented: true })) });
    window.dispatchEvent(new Event("data-changed"));
  });
  await page.getByRole("button", { name: "Daily briefing", exact: true }).click();
  await expect(science(page).getByRole("heading", { name: "Sector source quotations" })).toBeVisible();
}

test("briefing open issues no sector source preview; the first expand issues exactly one", async ({ page }) => {
  await openBriefing(page);

  // The briefing itself is still fetched, and it is the only fetch.
  expect((await briefCalls(page)).length).toBeGreaterThan(0);
  expect(await previewCalls(page)).toEqual([]);

  // Generate stays disabled with its existing honest explanation until the
  // preview has actually loaded, and the status must not claim a check is
  // running when nothing has been requested yet.
  const generate = science(page).getByRole("button", { name: "Generate sector summary", exact: true });
  await expect(generate).toBeDisabled();
  await expect(science(page).getByRole("status")).toContainText("checked only when you review them");
  await expect(science(page).getByText(/source stories selected ·/)).toHaveCount(0);

  // Expanding the disclosure for that sector fetches its preview once.
  await disclosure(page).click();
  await expect(science(page).getByText("2 source stories selected · 2 eligible · 0 excluded", { exact: true })).toBeVisible();
  const first = await previewCalls(page);
  expect(first).toHaveLength(1);
  expect(first[0]).toMatchObject({ profileId: "default", date: "2026-09-23", sectorId: "science" });
  await expect(generate).toBeEnabled();
});

test("later expands reuse the loaded preview; collapsing neither refetches nor discards it", async ({ page }) => {
  await openBriefing(page);
  await disclosure(page).click();
  await expect(science(page).getByText("2 source stories selected · 2 eligible · 0 excluded", { exact: true })).toBeVisible();
  expect(await previewCalls(page)).toHaveLength(1);
  const loaded = (await previewCalls(page))[0];

  for (const open of [false, true, false, true]) {
    await disclosure(page).click();
    if (open) await expect(science(page).getByText("Headline-only input", { exact: true })).toBeVisible();
    else await expect(science(page).getByText("Headline-only input", { exact: true })).toHaveCount(0);
    // Collapsing hides the list; it must not discard the loaded counts or refetch.
    await expect(science(page).getByText("2 source stories selected · 2 eligible · 0 excluded", { exact: true })).toBeVisible();
    expect(await previewCalls(page)).toEqual([loaded]);
  }
  await expect(science(page).getByRole("button", { name: "Generate sector summary", exact: true })).toBeEnabled();
});

test("browsing the briefing loads no preview, sends nothing to AI and marks nothing read", async ({ page }) => {
  await openBriefing(page);
  // Touch the briefing the way a reader does: browse sectors, read the outline,
  // open the per-story AI disclosure without requesting anything.
  await page.getByRole("link", { name: /^Science/ }).click();
  await page.getByText("Optional AI summaries · per story", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Researchers map a new lunar water reserve" })).toBeVisible();
  expect(await previewCalls(page)).toEqual([]);
  const calls = await page.evaluate(() => (window as any).__TEST_CALLS__.map((r: any) => r.op));
  // Navigating to a sector legitimately records a "visit" - that is a view
  // record, not a read marker, so it is not in this list. What must never
  // happen is AI work, a media load, or any article_state write (which is what
  // marks a story read or saved).
  for (const op of ["sector_summarize", "summarize", "media_load", "article_state", "article_state_many", "model_catalog"])
    expect(calls.filter((o: string) => o === op)).toEqual([]);
  // And the story the reader opened must still be unread in the fixture state.
  const read = await page.evaluate(() => {
    const s = (window as any).__TEST_SNAPSHOT__();
    return s.articles.filter((a: any) => a.read).map((a: any) => a.id);
  });
  expect(read, "browsing the briefing must not mark anything read").toEqual([]);
});
