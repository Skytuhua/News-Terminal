import { expect, test, type Page } from "@playwright/test";
import { fixture } from "./fixture";

const nav = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

const mixStates = (page: Page) =>
  page.evaluate(() => {
    const w = window as any;
    const s = w.__TEST_SNAPSHOT__();
    w.__TEST_PATCH__({
      articles: s.articles.map((a: any) => ({
        ...a,
        read: a.id === "c",
        saved: a.id === "b",
      })),
    });
    w.__TEST_CALLS__.length = 0;
    window.dispatchEvent(new Event("data-changed"));
  });

const writes = (page: Page) =>
  page.evaluate(() =>
    (window as any).__TEST_CALLS__.filter((r: any) =>
      ["article_state", "article_state_many"].includes(r.op),
    ).length,
  );

test("reading status replaces the Unread checkbox, defaults to All and writes no article state", async ({
  page,
}) => {
  await fixture(page);
  await mixStates(page);
  await expect(page.getByLabel("Unread", { exact: true })).toHaveCount(0);
  const status = page.getByLabel("Reading status", { exact: true });
  await expect(status).toHaveValue("all");
  await expect(status.locator("option")).toHaveText(["All", "Unread", "Read"]);
  await expect(page.getByRole("option", { name: "Recently read" })).toHaveCount(0);
  await expect(page.getByTestId("story-row")).toHaveCount(3);

  await status.selectOption("unread");
  await expect(page.getByTestId("story-row")).toHaveCount(2);
  await expect(page.locator(".headline")).toHaveText([
    "Researchers map a new lunar water reserve",
    "What lunar water observations can tell us",
  ]);

  await status.selectOption("read");
  await expect(page.getByTestId("story-row")).toHaveCount(1);
  await expect(page.locator(".headline")).toHaveText([
    "New chips improve battery efficiency",
  ]);
  // Changing a view filter is not a state change.
  expect(await writes(page)).toBe(0);
});

test("reading status resets to All on navigation and on a filter reset", async ({
  page,
}) => {
  await fixture(page);
  await mixStates(page);
  const status = page.getByLabel("Reading status", { exact: true });
  await status.selectOption("unread");
  await expect(page.getByTestId("story-row")).toHaveCount(2);
  await nav(page, "Saved stories").click();
  await expect(status).toHaveValue("all");
  await expect(page.getByTestId("story-row")).toHaveCount(1);
  await status.selectOption("read");
  // mixStates saved article "b" and marked only "c" read. The one saved story
  // is therefore unread, so the Read filter empties this view and exercises the
  // "clear filters" reset path.
  await expect(page.getByTestId("story-row")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "No saved stories match these filters" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(status).toHaveValue("all");
  await expect(page.getByTestId("story-row")).toHaveCount(1);
  expect(await writes(page)).toBe(0);
});

test("nav badges state the unread count, name it, and render nothing at zero", async ({
  page,
}) => {
  await fixture(page);
  await mixStates(page);
  const all = nav(page, "All headlines");
  await expect(all).toHaveAccessibleName("All headlines");
  // Scoped to .nav-count: an unscoped getByRole("img") also matches the lucide
  // icon SVGs inside these buttons, which makes the assertion ambiguous.
  await expect(all.locator(".nav-count")).toHaveText("2");
  await expect(all.locator(".nav-count")).toHaveAttribute("aria-label", "2 unread");
  await expect(nav(page, "Saved stories").locator(".nav-count")).toHaveAttribute("aria-label", "1 unread");
  // Hidden, read-only and empty destinations render no badge at all.
  await expect(nav(page, "Hidden stories").locator(".nav-count")).toHaveCount(0);
  await expect(nav(page, "AI").locator(".nav-count")).toHaveCount(0);
  await expect(nav(page, "Others").locator(".nav-count")).toHaveAttribute("aria-label", "2 unread");

  // The badge must equal the rows the destination actually shows.
  await all.click();
  await page.getByLabel("Reading status", { exact: true }).selectOption("unread");
  await expect(page.getByTestId("story-row")).toHaveCount(2);
  await expect(
    nav(page, "Saved stories").locator(".nav-count"),
  ).toHaveAttribute("aria-label", "1 unread");
  await nav(page, "Saved stories").click();
  await page.getByLabel("Reading status", { exact: true }).selectOption("unread");
  await expect(page.getByTestId("story-row")).toHaveCount(1);
});

test("marking read updates the badge without reordering rows", async ({ page }) => {
  await fixture(page);
  await mixStates(page);
  const order = () => page.locator(".headline").allTextContents();
  expect(await order()).toEqual([
    "Researchers map a new lunar water reserve",
    "What lunar water observations can tell us",
    "New chips improve battery efficiency",
  ]);
  await nav(page, "All headlines").click();
  await page.getByLabel("Reading status", { exact: true }).selectOption("unread");
  await page.getByRole("button", { name: "Researchers map a new lunar water reserve", exact: true }).click();
  await page.locator(".list-heading h2").click();
  await page.keyboard.press("j");
  // Selecting a story marks it read, and J selects the next unread one, so
  // both unread stories are now read and the badge disappears entirely.
  await expect(nav(page, "All headlines").locator(".nav-count")).toHaveCount(0);
  await page.getByLabel("Reading status", { exact: true }).selectOption("all");
  expect(await order()).toEqual([
    "Researchers map a new lunar water reserve",
    "What lunar water observations can tell us",
    "New chips improve battery efficiency",
  ]);
});

test("watchlist badges are scoped to their own destination", async ({ page }) => {
  await fixture(page);
  await mixStates(page);
  await page.evaluate(() => {
    const w = window as any;
    const s = w.__TEST_SNAPSHOT__();
    w.__TEST_PATCH__({
      articles: s.articles.map((a: any) => ({ ...a, sections: ["technology"] })),
      watchlists: [
        { id: "w-tech", name: "Tech desk", keywords: [], topics: [], sources: [], alerts: false },
        { id: "w-none", name: "Empty desk", keywords: ["nothing"], topics: [], sources: [], alerts: false },
      ],
    });
    window.dispatchEvent(new Event("data-changed"));
  });
  await expect(nav(page, "Tech desk").locator(".nav-count")).toHaveAttribute("aria-label", "2 unread");
  await expect(nav(page, "Empty desk").locator(".nav-count")).toHaveCount(0);
  await nav(page, "Tech desk").click();
  await page.getByLabel("Reading status", { exact: true }).selectOption("unread");
  await expect(page.getByTestId("story-row")).toHaveCount(2);
});
