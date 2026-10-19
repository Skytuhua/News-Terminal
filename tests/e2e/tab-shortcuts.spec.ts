import { expect, test, type Page } from "@playwright/test";
import { fixture } from "./fixture";

const search = (page: Page) => page.getByRole("searchbox", { name: "Search cached stories", exact: true });
const workspace = (page: Page) => page.evaluate(() => (window as any).__TEST_SNAPSHOT__().workspace);

test("tab cycling from search preserves each tab's query", async ({ page }, info) => {
  await fixture(page);
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(2);
  const secondId = (await workspace(page)).activeTabId;
  const home = page.locator("#workspace-tab-home");
  await home.click();

  await search(page).fill("lunar");
  await search(page).press("Control+Tab");
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(search(page)).toBeFocused();
  await expect(search(page)).toHaveValue("");
  await expect.poll(async () => (await workspace(page)).tabs.find((tab: any) => tab.id === "home").query).toBe("lunar");

  await search(page).fill("chips");
  await search(page).press("Control+Shift+Tab");
  await expect(home).toHaveAttribute("aria-selected", "true");
  await expect(search(page)).toHaveValue("lunar");
  await expect.poll(async () => (await workspace(page)).tabs.find((tab: any) => tab.id === secondId).query).toBe("chips");
  await page.screenshot({ path: info.outputPath("search-tab-cycle.png"), fullPage: true });

  await page.reload();
  await expect(home).toHaveAttribute("aria-selected", "true");
  await expect(search(page)).toHaveValue("lunar");
  await search(page).press("Control+Tab");
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(search(page)).toHaveValue("chips");
});

test("new and close tab shortcuts work while search is focused", async ({ page }, info) => {
  await fixture(page);
  await search(page).fill("lunar");
  await expect.poll(async () => (await workspace(page)).tabs[0].query).toBe("lunar");
  await search(page).press("Control+t");
  await expect(page.getByRole("tab")).toHaveCount(2);
  const secondId = (await workspace(page)).activeTabId;
  expect(secondId).not.toBe("home");
  await expect(search(page)).toHaveValue("");
  await search(page).fill("chips");
  await expect.poll(async () => (await workspace(page)).tabs.find((tab: any) => tab.id === secondId).query).toBe("chips");

  await search(page).press("Control+w");
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.locator("#workspace-tab-home")).toHaveAttribute("aria-selected", "true");
  await expect(search(page)).toHaveValue("lunar");
  expect((await workspace(page)).tabs.map((tab: any) => tab.id)).toEqual(["home"]);
  await page.screenshot({ path: info.outputPath("search-tab-close.png"), fullPage: true });
});

test("typing and open dialogs still protect reader actions", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: "Researchers map a new lunar water reserve", exact: true }).click();
  await search(page).fill("");
  await search(page).pressSequentially("xmsrojk");
  await expect(search(page)).toHaveValue("xmsrojk");
  await expect.poll(() => page.evaluate(() => {
    const article = (window as any).__TEST_SNAPSHOT__().articles.find((item: any) => item.id === "a");
    return { read: article.read, hidden: article.hidden, saved: article.saved };
  })).toEqual({ read: true, hidden: false, saved: false });
  await expect.poll(async () => (await workspace(page)).tabs[0].query).toBe("xmsrojk");

  await page.getByRole("button", { name: "Keyboard shortcuts", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  for (const key of ["Control+t", "Control+w", "Control+Tab", "Control+Shift+Tab"]) {
    await page.keyboard.press(key);
    await expect(dialog).toBeVisible();
    await expect(page.locator('[role="tab"]')).toHaveCount(1);
    expect((await workspace(page)).activeTabId).toBe("home");
  }
});
