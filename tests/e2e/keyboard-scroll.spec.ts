import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";
test("fixture: keyboard story navigation keeps the active row in view", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => {
    const s = (window as any).__TEST_SNAPSHOT__();
    (window as any).__TEST_PATCH__({
      articles: Array.from({ length: 30 }, (_, i) => ({
        ...s.articles[0],
        id: `article-${i}`,
        title: `Report number ${i}`,
        groupId: `group-${i}`,
      })),
    });
  });
  await page.getByRole("button", { name: "Refresh feeds" }).click();
  await page
    .getByRole("button", { name: "30 new stories · Show latest" })
    .click();
  await page
    .getByRole("button", { name: "Report number 0", exact: true })
    .click();
  for (let i = 0; i < 14; i++) await page.keyboard.press("j");
  await expect(
    page.getByRole("heading", { name: "Report number 14", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.locator(".story-list").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
});
