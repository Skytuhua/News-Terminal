import { test, expect, type Page } from "@playwright/test";
import { fixture } from "./fixture";

test("fixture: terminal text tokens meet normal-text contrast", async ({ page }, testInfo) => {
  await fixture(page, { v02: true });
  const contrast = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    const luminance = (token: string) => {
      ctx.fillStyle = css.getPropertyValue(token).trim(); ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => { const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; });
      return .2126 * r + .7152 * g + .0722 * b;
    };
    return ["--bg", "--surface", "--selected"].flatMap(bg => ["--text", "--muted", "--accent"].map(fg => { const a = luminance(bg), b = luminance(fg); return { bg, fg, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }; }));
  });
  for (const pair of contrast) expect(pair.ratio, `${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(4.5);
  await testInfo.attach("token-contrast", { body: JSON.stringify(contrast), contentType: "application/json" });
});

async function navigate(page: Page, name: string) {
  const nav = page.getByRole("button", { name: "Toggle navigation" });
  if (await nav.isVisible()) await nav.click();
  await page.getByRole("button", { name, exact: true }).click();
}
for (const { width, height, zoom } of [{ width: 1440, height: 900, zoom: 1 }, { width: 1024, height: 768, zoom: 1 }, { width: 480, height: 800, zoom: 1 }, { width: 1440, height: 900, zoom: 2 }]) {
  test(`fixture: v02 desk visual ${width}x${height} zoom ${zoom}`, async ({ page }, testInfo) => {
    test.setTimeout(60000);
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.setViewportSize({ width: width / zoom, height: height / zoom });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await fixture(page, { v02: true });
    if (zoom !== 1) {
      // Emulate the CSS viewport and pixel density of desktop page zoom.
      // CSS `zoom` alone does not change media queries or dvh and is not valid QA.
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: width / zoom, height: height / zoom, deviceScaleFactor: zoom, mobile: false });
    }
    async function capture(name: string) {
      expect(await page.evaluate(() => innerWidth)).toBe(width / zoom);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      expect(await page.title()).toBe("News Terminal");
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
      const metrics = await page.evaluate(() => ({
        viewport: { width: innerWidth, height: innerHeight }, scrollWidth: document.documentElement.scrollWidth,
        smallControls: Array.from(document.querySelectorAll("button,input,select")).filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.width < 44 && r.height < 44; }).map(e => e.getAttribute("aria-label") || e.textContent?.trim()),
        headlineSize: document.querySelector(".headline") ? getComputedStyle(document.querySelector(".headline")!).fontSize : null,
      }));
      expect(metrics.viewport.width).toBe(width / zoom);
      await testInfo.attach(`${name}-metrics`, { body: JSON.stringify({ ...metrics, errors }), contentType: "application/json" });
    }
    await page.getByRole("button", { name: "Researchers map a new lunar water reserve", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Researchers map a new lunar water reserve" })).toBeVisible();
    await capture("reader");
    await navigate(page, "Daily briefing");
    await expect(page.getByText("Fixture cached coverage only")).toBeVisible();
    await capture("briefing");
    await navigate(page, "Live discussion");
    await page.getByRole("button", { name: "Connect HN stream" }).click();
    await expect(page.getByText("Fixture discussion about open science", { exact: true })).toBeVisible();
    await capture("live");
    await page.getByRole("button", { name: "Screens", exact: true }).click();
    await expect(page.getByText("Current display: Primary display")).toBeVisible();
    await expect(page.getByRole("button", { name: "Close settings" })).toBeInViewport();
    await page.getByRole("button", { name: "Move this window" }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "Move this window" })).toBeInViewport();

    await expect(page.getByRole("button", { name: "Close settings" })).toBeInViewport();
    await capture("screens");
    expect(errors).toEqual([]);
  });
}
