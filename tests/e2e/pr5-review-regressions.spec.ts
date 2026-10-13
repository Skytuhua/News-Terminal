import { expect, test } from "@playwright/test";
import { fixture } from "./fixture";

const LUNAR = "Researchers map a new lunar water reserve";

test("native receipt seconds render the delivery date and an ISO time attribute", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: "Alert history", exact: true }).click();
  const time = page.getByTestId("alert-receipt").first().locator("time");
  await expect(time).toHaveAttribute("datetime", "2026-09-29T08:04:00.000Z");
  await expect(time).toContainText("2026");
});

test("alert history isolates article shortcuts from the previous reading selection", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: LUNAR, exact: true }).click();
  await expect(page.locator(".detail h2")).toHaveText(LUNAR);
  await page.getByRole("button", { name: "Alert history", exact: true }).click();
  await expect(page.getByTestId("alert-receipt")).toHaveCount(3);
  await page.evaluate(() => { (window as any).__TEST_CALLS__.length = 0; });
  await page.locator(".alert-history h2").click();
  for (const key of ["j", "k", "x", "m", "s"]) await page.keyboard.press(key);
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) =>
    ["article_state", "article_state_many"].includes(r.op)))).toEqual([]);
  await expect(page.locator(".desk")).toHaveClass(/report-view/);
});

test("a failed receipt read can be retried without changing reading data", async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => { (window as any).__FAIL_OP__ = "alert_receipts"; });
  await page.getByRole("button", { name: "Alert history", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not load alert history");
  await page.evaluate(() => { (window as any).__FAIL_OP__ = undefined; });
  await page.getByRole("button", { name: "Retry alert history" }).click();
  await expect(page.getByTestId("alert-receipt")).toHaveCount(3);
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) =>
    ["article_state", "article_state_many"].includes(r.op)))).toEqual([]);
});

test("a long receipt history stays scrollable inside the workspace", async ({ page }) => {
  await fixture(page, { alertReceipts: Array.from({ length: 50 }, (_, i) => ({
    profileId: "default", articleId: `receipt-${i}`, at: 1790669040 - i, title: `Delivered story ${i + 1}`,
  })) });
  await page.getByRole("button", { name: "Alert history", exact: true }).click();
  await expect(page.getByTestId("alert-receipt")).toHaveCount(50);
  const history = page.locator(".alert-history");
  expect(await history.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await history.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(page.getByTestId("alert-receipt").last()).toBeInViewport();
});

test("a bulk acknowledgement preserves selection in a newer filter", async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    const w = window as any;
    w.__TEST_BEFORE_DISPATCH__ = (r: any) => r.op === "article_state_many"
      ? new Promise<void>(resolve => { w.__RELEASE_BULK__ = resolve; }) : undefined;
  });
  await page.getByRole("checkbox", { name: `Select ${LUNAR}`, exact: true }).check();
  await page.getByRole("region", { name: "Bulk actions" }).getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!(window as any).__RELEASE_BULK__)).toBe(true);
  await page.getByLabel("Reading status", { exact: true }).selectOption("unread");
  const newer = page.getByRole("checkbox", { name: "Select What lunar water observations can tell us", exact: true });
  await newer.check();
  await page.evaluate(() => { (window as any).__RELEASE_BULK__(); });
  await expect(page.getByText("1 stories saved", { exact: true })).toBeVisible();
  await expect(newer).toBeChecked();
  await expect(page.getByRole("region", { name: "Bulk actions" })).toContainText("1 selected");
});

test("rapid read-toggle presses serialize and use the confirmed read state", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: LUNAR, exact: true }).click();
  await expect(page.locator('.story-row[data-article-id="a"]')).toHaveClass(/read/);
  await page.locator(".list-heading h2").click();
  await page.evaluate(() => {
    const w = window as any;
    w.__TEST_CALLS__.length = 0;
    let first = true;
    w.__TEST_BEFORE_DISPATCH__ = (r: any) => {
      if (r.op === "article_state" && first) {
        first = false;
        return new Promise<void>(resolve => { w.__RELEASE_READ__ = resolve; });
      }
    };
  });
  await page.keyboard.press("m");
  await expect.poll(() => page.evaluate(() => !!(window as any).__RELEASE_READ__)).toBe(true);
  await page.keyboard.press("m");
  await page.evaluate(() => { (window as any).__RELEASE_READ__(); });
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_CALLS__
    .filter((r: any) => r.op === "article_state").map((r: any) => r.read))).toEqual([false, true]);
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_SNAPSHOT__().articles[0].read)).toBe(true);
});

test("failed read toggles preserve the confirmed state for the next press", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: LUNAR, exact: true }).click();
  await expect(page.locator('.story-row[data-article-id="a"]')).toHaveClass(/read/);
  await page.locator(".list-heading h2").click();
  await page.evaluate(() => { (window as any).__FAIL_OP__ = "article_state"; });
  await page.keyboard.press("m");
  await expect(page.getByRole("alert")).toContainText("Fixture service unavailable");
  expect(await page.evaluate(() => (window as any).__TEST_SNAPSHOT__().articles[0].read)).toBe(true);
  await page.evaluate(() => { (window as any).__FAIL_OP__ = undefined; });
  await page.keyboard.press("m");
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_SNAPSHOT__().articles[0].read)).toBe(false);
});

test("a lost read-write acknowledgement recovers without repeating the write", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: LUNAR, exact: true }).click();
  await expect(page.locator('.story-row[data-article-id="a"]')).toHaveClass(/read/);
  await page.locator(".list-heading h2").click();
  await page.evaluate(() => {
    const w = window as any;
    w.__TEST_CALLS__.length = 0;
    let first = true;
    w.__TEST_AFTER_DISPATCH__ = (r: any) => {
      if (r.op === "article_state" && first) {
        first = false;
        throw new Error("Write acknowledgement lost");
      }
    };
  });
  await page.keyboard.press("m");
  await expect(page.getByRole("alert")).toContainText("Write acknowledgement lost");
  expect(await page.evaluate(() => (window as any).__TEST_SNAPSHOT__().articles[0].read)).toBe(false);
  await page.keyboard.press("m");
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_CALLS__
    .filter((r: any) => r.op === "article_state").map((r: any) => r.read))).toEqual([false, true]);
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_SNAPSHOT__().articles[0].read)).toBe(true);
});

test("keyboard Hide clears the reader and keeps Undo after an acknowledged hide loses its readback", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: LUNAR, exact: true }).click();
  await expect(page.locator('.story-row[data-article-id="a"]')).toHaveClass(/read/);
  await page.locator(".list-heading h2").click();
  await page.evaluate(() => {
    const w = window as any;
    w.__TEST_CALLS__.length = 0;
    let held = false;
    w.__TEST_BEFORE_DISPATCH__ = (r: any) => {
      if (r.op === "snapshot" && !held && w.__TEST_CALLS__.some((call: any) => call.op === "article_state" && call.hidden === true)) {
        held = true;
        return new Promise<void>((_, reject) => {
          w.__FAIL_HIDE_READBACK__ = () => reject(new Error("Hide readback unavailable"));
        });
      }
    };
  });
  await page.keyboard.press("x");
  await expect.poll(() => page.evaluate(() => !!(window as any).__FAIL_HIDE_READBACK__)).toBe(true);
  try {
    expect(await page.evaluate(() => (window as any).__TEST_SNAPSHOT__().articles[0].hidden)).toBe(true);
    await expect(page.locator(".detail h2")).toHaveText("Select a story");
    await expect(page.getByRole("button", { name: "Undo hide", exact: true })).toBeVisible();
  } finally {
    await page.evaluate(() => { (window as any).__FAIL_HIDE_READBACK__(); });
  }
  await expect(page.getByRole("alert")).toContainText("Hide readback unavailable");
  await expect(page.getByRole("button", { name: "Undo hide", exact: true })).toBeEnabled();
  await page.evaluate(() => { (window as any).__TEST_BEFORE_DISPATCH__ = undefined; });
  await page.getByRole("button", { name: "Undo hide", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__TEST_SNAPSHOT__().articles[0].hidden)).toBe(false);
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__
    .filter((r: any) => r.op === "article_state" && "hidden" in r).map((r: any) => r.hidden))).toEqual([true, false]);
});

test("article shortcuts stay inert while a profile change awaits acknowledgement", async ({ page }) => {
  await fixture(page, { savedProfile: true });
  await page.getByRole("button", { name: LUNAR, exact: true }).click();
  await expect(page.locator('.story-row[data-article-id="a"]')).toHaveClass(/read/);
  await page.evaluate(() => {
    const w = window as any;
    w.__TEST_BEFORE_DISPATCH__ = (r: any) => r.op === "window_set_profile"
      ? new Promise<void>(resolve => { w.__RELEASE_PROFILE__ = resolve; }) : undefined;
  });
  await page.getByLabel("Reading profile", { exact: true }).selectOption("default");
  await expect.poll(() => page.evaluate(() => !!(window as any).__RELEASE_PROFILE__)).toBe(true);
  await page.locator(".list-heading h2").click();
  await page.evaluate(() => { (window as any).__TEST_CALLS__.length = 0; });
  try {
    await page.keyboard.press("x");
    await page.keyboard.press("m");
    expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) =>
      ["article_state", "article_state_many"].includes(r.op)))).toEqual([]);
  } finally {
    await page.evaluate(() => { (window as any).__RELEASE_PROFILE__(); });
  }
});

test("navigation describes unread counts on the focused buttons", async ({ page }) => {
  await fixture(page);
  await expect(page.getByRole("button", { name: "All headlines", exact: true })).toHaveAccessibleDescription("3 unread");
  await expect(page.getByRole("button", { name: "Others", exact: true })).toHaveAccessibleDescription("3 unread");
  await expect(page.getByRole("button", { name: "AI", exact: true })).toHaveAccessibleDescription("");
});

test("Hidden stories omits a count from the incomplete snapshot projection", async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    const w = window as any, s = w.__TEST_SNAPSHOT__();
    w.__TEST_PATCH__({ articles: s.articles.map((a: any) => ({ ...a, hidden: a.id === "a" })) });
    window.dispatchEvent(new Event("data-changed"));
  });
  await expect(page.getByTestId("story-row")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Hidden stories", exact: true }).locator(".nav-count")).toHaveCount(0);
});

test("storage explains that expired receipts are removed", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Storage & retention" }).click();
  await expect(page.getByRole("dialog")).toContainText("Alert receipts are removed after 90 days");
  await expect(page.getByRole("dialog")).toContainText("If a story is pruned earlier, its receipt keeps the delivery time");
});
