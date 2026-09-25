import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";

for (const [service, input, expected] of [
  ["lemmy", "https://lemmy.world/c/technology", "https://lemmy.world/feeds/c/technology.xml?sort=New"],
  ["youtube", "UCLA_DiR1FfKNvjuUpBHmylQ", "https://www.youtube.com/feeds/videos.xml?channel_id=UCLA_DiR1FfKNvjuUpBHmylQ"],
]) test(`fixture: ${service} connection preserves official feed URL`, async ({ page }) => {
  await fixture(page, { v02: true });
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page.getByLabel("Service", { exact: true }).selectOption(service);
  await page.getByLabel("Connection name").fill(`${service} discovery`);
  await page.getByLabel("Account or community URL / channel ID").fill(input);
  await page.getByLabel("Connection terms URL").fill("https://example.org/terms");
  await page.getByLabel("I have reviewed these terms and have permission to access and store title/link metadata").check();
  await page.getByRole("button", { name: "Add connection" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_CALLS__.filter((c: any) => c.op === "source_add").at(-1)?.url)).toBe(expected);
});

test("fixture: a YouTube handle is not repaired into a channel ID", async ({ page }) => {
  await fixture(page, { v02: true });
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page.getByLabel("Service", { exact: true }).selectOption("youtube");
  await page.getByLabel("Connection name").fill("Video discovery");
  await page.getByLabel("Account or community URL / channel ID").fill("@NASA");
  await page.getByLabel("Connection terms URL").fill("https://www.youtube.com/t/terms");
  await page.getByLabel("I have reviewed these terms and have permission to access and store title/link metadata").check();
  await page.getByRole("button", { name: "Add connection" }).click();
  await expect(page.getByRole("alert")).toContainText("Enter an exact YouTube channel ID");
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.some((c: any) => c.op === "source_add"))).toBe(false);
});

test("fixture: social setup requires reviewed terms and registers only official metadata feeds", async ({ page }) => {
  await fixture(page, { v02: true });
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page.getByLabel("Connection name").fill("My science account");
  await page.getByLabel("Account or community URL / channel ID").fill("https://mastodon.social/@Mastodon");
  await page.getByLabel("Connection terms URL").fill("https://mastodon.social/terms-of-service");
  await page.getByRole("button", { name: "Add connection" }).click();
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.some((c: any) => c.op === "source_add"))).toBe(false);
  await page.getByLabel("I have reviewed these terms and have permission to access and store title/link metadata").check();
  await page.getByRole("button", { name: "Add connection" }).click();
  await expect(page.getByText("Connection saved. It uses scheduled RSS refresh, not a live stream.")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_SNAPSHOT__().sources.some((s: any) => s.url === "https://mastodon.social/@Mastodon.rss" && s.kind === "discussion" && s.storage === "metadata" && s.aiAllowed === false && s.mediaAllowed === false))).toBe(true);
  await page.getByRole("button", { name: "Open Bluesky website" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_CALLS__.filter((c: any) => c.op === "open_original").at(-1)?.url)).toBe("https://bsky.app/");
  await expect(page.getByText("External only - not connected", { exact: true })).toHaveCount(3);
  await expect(page.getByText("does not scrape them")).toBeVisible();
  await expect(page.getByText("External search - no ingestion", { exact: true })).toHaveCount(3);
  await page.getByRole("button", { name: "Open Reddit technology search" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_CALLS__.filter((c: any) => c.op === "open_original").at(-1)?.url)).toBe("https://www.reddit.com/search/?q=technology%20news");
});
