import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";
for (const width of [1440, 1024, 720, 480])
  test(`fixture: readable layout at ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 960 });
    await fixture(page);
    await page
      .getByRole("button", {
        name: "Researchers map a new lunar water reserve",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Researchers map a new lunar water reserve",
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(await page.title()).toBe("News Terminal");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(errors).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`desk-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`settings-${width}.png`),
      fullPage: true,
    });
  });
