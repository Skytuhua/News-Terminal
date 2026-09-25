import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";

test("fixture: media permission is an independent acknowledged source setting", async ({ page }) => {
  await fixture(page, { v02: true });
  await page.getByRole("button", { name: /Sources & health/ }).click();
  await page.getByLabel("I have permission to load media from Science Wire").check();
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_SNAPSHOT__().sources[0].mediaAllowed)).toBe(true);
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((c: any) => c.op === "source_update").at(-1))).toMatchObject({ sourceId: "science", mediaAllowed: true });
});

test("fixture: reader loads media only on click and retains external fallback", async ({ page }) => {
  const remote: string[] = [];
  page.on("request", r => { if (r.url().includes("example.org")) remote.push(r.url()); });
  await fixture(page, { v02: true });
  await page.getByRole("button", { name: "Researchers map a new lunar water reserve", exact: true }).click();
  await expect(page.getByRole("button", { name: "Load image 1" })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.some((c: any) => c.op === "media_load"))).toBe(false);
  await expect(page.locator(".reader-media img, .reader-media video")).toHaveCount(0);
  await page.getByRole("button", { name: "Load image 1" }).click();
  await expect(page.getByAltText("Fixture lunar image")).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect.poll(() => page.getByAltText("Fixture lunar image").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator(".reader-media").getByText("Credit: Test fixture")).toBeVisible();
  await page.getByRole("button", { name: "Load video 2" }).click();
  await expect(page.locator(".reader-media video")).toHaveAttribute("controls", "");
  await expect(page.locator(".reader-media video")).not.toHaveAttribute("autoplay", "");
  await page.getByRole("button", { name: "Open media original 3" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_CALLS__.filter((c: any) => c.op === "open_original").at(-1)?.url)).toBe("https://www.youtube.com/watch?v=fixture");
  expect(remote).toEqual([]);
});

test("fixture: headline row image follows profile opt-in and is host-mediated", async ({ page }) => {
  const remote: string[] = [];
  page.on("request", r => { if (r.url().includes("example.org")) remote.push(r.url()); });
  await fixture(page, { v02: true });
  await expect(page.getByRole("button", { name: "Enable automatic images" })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.some((c: any) => c.op === "media_load"))).toBe(false);
  await page.getByRole("button", { name: "Enable automatic images" }).click();
  await expect(page.getByAltText("Fixture lunar image")).toHaveAttribute("src", /^data:image\/png;base64,/);
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((c: any) => c.op === "media_load").at(-1))).toMatchObject({ articleId: "a", index: 0, profileId: "default" });
  expect(remote).toEqual([]);
});
