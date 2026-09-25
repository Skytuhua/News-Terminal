import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";

const lunar = "Researchers map a new lunar water reserve";
test("fixture: media failures recover, reject remote src and include profile scope", async ({ page }) => {
  await fixture(page, { v02: true });
  await page.getByRole("button", { name: lunar, exact: true }).click();
  await page.evaluate(() => { (window as any).__FAIL_OP__ = "media_load"; });
  await page.getByRole("button", { name: "Load image 1" }).click();
  await expect(page.locator(".reader-media").getByRole("alert")).toContainText("Fixture service unavailable");
  await expect(page.getByRole("button", { name: "Load image 1" })).toBeEnabled();
  await page.evaluate(() => { (window as any).__FAIL_OP__ = ""; (window as any).__MEDIA_BAD_URL__ = true; });
  await page.getByRole("button", { name: "Load image 1" }).click();
  await expect(page.locator(".reader-media").getByRole("alert")).toContainText("Unsupported media response");
  await expect(page.locator(".reader-media img")).toHaveCount(0);
  await page.evaluate(() => { (window as any).__MEDIA_BAD_URL__ = false; });
  await page.getByRole("button", { name: "Load image 1" }).click();
  await expect(page.locator(".reader-media img")).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((c: any) => c.op === "media_load").at(-1))).toMatchObject({ articleId: "a", index: 0, profileId: "default" });
});

test("fixture: a late media response never appears on a different selection", async ({ page }) => {
  await fixture(page, { v02: true });
  await page.evaluate(() => { (window as any).__MEDIA_DELAY__ = 1000; });
  await page.getByRole("button", { name: lunar, exact: true }).click();
  await page.getByRole("button", { name: "Load image 1" }).click();
  await page.getByRole("button", { name: "New chips improve battery efficiency", exact: true }).click();
  await page.waitForTimeout(1100);
  await expect(page.getByRole("heading", { name: "New chips improve battery efficiency" })).toBeVisible();
  await expect(page.locator(".reader-media img")).toHaveCount(0);
});

test("fixture: daily briefing discards old dates and retries native read failures", async ({ page }) => {
  await fixture(page, { v02: true });
  await page.evaluate(() => { (window as any).__FAIL_OP__ = "daily_brief"; });
  await page.getByRole("button", { name: "Daily briefing", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Briefing unavailable");
  await page.evaluate(() => { (window as any).__FAIL_OP__ = ""; (window as any).__BRIEF_DELAY__ = true; });
  await page.getByRole("button", { name: "Retry briefing" }).click();
  await expect(page.getByText("Fixture cached coverage only")).toBeVisible();
  await page.getByLabel("Briefing date").fill("2026-09-22");
  await page.getByLabel("Briefing date").fill("2026-09-21");
  await expect(page.getByText("Fixture cached coverage only")).toBeVisible();
  await page.waitForTimeout(900);
  const midnight = await page.evaluate(() => new Date("2026-09-21T00:00:00").toLocaleString());
  await expect(page.locator(".brief-coverage")).toContainText(midnight);
});

test("fixture: sector AI uses existing per-article permission gates and provenance", async ({ page }) => {
  await fixture(page, { v02: true });
  await page.evaluate(() => { const s = (window as any).__TEST_SNAPSHOT__(); s.articles[1].aiAllowed = false; s.providers[0].enabled = true; s.providers[0].consented = true; (window as any).__TEST_PATCH__(s); window.dispatchEvent(new Event("data-changed")); });
  await page.getByRole("button", { name: "Daily briefing", exact: true }).click();
  await page.locator("summary").filter({ hasText: "Optional AI summaries" }).click();
  await expect(page.getByRole("button", { name: "Summarize excerpt" })).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.some((c: any) => c.op === "summarize"))).toBe(false);
  await page.getByRole("button", { name: "Summarize excerpt" }).click();
  await expect(page.getByText("AI-generated · verify with the original")).toBeVisible();
  await expect(page.getByText("Fixture source attribution", { exact: true })).toBeVisible();
  await expect(page.getByText("Fixture generated analysis; not an official agency product.", { exact: true })).toBeVisible();
  await expect(page.getByText("Headline-only input — the feed does not contain the full statement.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((c: any) => c.op === "summarize").at(-1))).toMatchObject({ articleId: "a", profileId: "default" });
});

test("fixture: incoming live metadata waits behind a stable-list affordance", async ({ page }) => {
  await fixture(page, { v02: true });
  await page.getByRole("button", { name: "Live discussion", exact: true }).click();
  await page.getByRole("button", { name: "Connect HN stream" }).click();
  await expect(page.getByText("Fixture discussion about open science", { exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).__LIVE_ITEMS__ = [{ id: "hn-second", title: "Second fixture discussion", url: "", discussionUrl: "https://news.ycombinator.com/item?id=2", by: "fixture", publishedAt: "2026-09-23T10:00:00Z", receivedAt: "2026-09-23T10:01:00Z", score: 1 }]; });
  await expect(page.getByRole("button", { name: "1 received items · Show latest" })).toBeVisible();
  await expect(page.getByText("Second fixture discussion", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "1 received items · Show latest" }).click();
  await expect(page.getByText("Second fixture discussion", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Disconnect stream" }).click();
  await expect(page.getByText("Stream off", { exact: true })).toBeVisible();
});

test("fixture: screen failure does not claim movement and can retry", async ({ page }) => {
  await fixture(page, { v02: true });
  await page.getByRole("button", { name: "Screens", exact: true }).click();
  await page.getByLabel("Target monitor").selectOption("screen-2");
  await page.evaluate(() => { (window as any).__FAIL_OP__ = "window_move"; });
  await page.getByRole("button", { name: "Move this window" }).click();
  await expect(page.getByRole("alert")).toContainText("Fixture service unavailable");
  await expect(page.getByText("Current display: Primary display")).toBeVisible();
  await expect(page.getByRole("button", { name: "Move this window" })).toBeEnabled();
});
