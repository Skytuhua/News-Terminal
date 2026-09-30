import { expect, test, type Page } from "@playwright/test";
import { fixture } from "./fixture";

// 0.5 bulk triage. Selection is scoped to the mounted page, the active profile
// and the current filter; it is never persisted, and it is cleared whenever the
// collection it was scoped to changes. A bulk action must issue exactly one
// dispatch, not one per row.

const counts = (page: Page) =>
  page.evaluate(() => {
    const w = window as any;
    return {
      writes: w.__TEST_CALLS__.filter(
        (r: any) => r.op === "article_state" || r.op === "article_state_many",
      ),
    };
  });

const selectRows = async (page: Page, titles: string[]) => {
  for (const title of titles)
    await page.getByRole("checkbox", { name: `Select ${title}`, exact: true }).check();
};

const idsFor = (page: Page, titles: string[]) =>
  page.evaluate(
    (wanted) => {
      const w = window as any, s = w.__TEST_SNAPSHOT__();
      return s.articles.filter((a: any) => wanted.includes(a.title)).map((a: any) => a.id);
    },
    titles,
  );

test("bulk triage issues exactly one dispatch for the selected rows", async ({ page }) => {
  await fixture(page);
  const titles = [
    "Researchers map a new lunar water reserve",
    "What lunar water observations can tell us",
  ];
  await selectRows(page, titles);

  const bar = page.getByRole("region", { name: "Bulk actions" });
  await expect(bar).toContainText("2 selected");

  await page.evaluate(() => { (window as any).__TEST_CALLS__.length = 0; });
  await bar.getByRole("button", { name: "Mark read", exact: true }).click();

  const { writes } = await counts(page);
  expect(writes, "one dispatch for the whole selection").toHaveLength(1);
  expect(writes[0].op).toBe("article_state_many");
  expect(writes[0].items.map((i: any) => i.read).sort()).toEqual([true, true]);
  // Profile is always explicit on a bulk write; there is no default.
  expect(writes[0].profileId).toBeTruthy();
  // A five-row batch must not turn into five round trips.
  expect(writes[0].items).toHaveLength(titles.length);
});

test("selection is scoped to the page and never persisted", async ({ page }) => {
  await fixture(page);
  const storage = () =>
    page.evaluate(() => JSON.stringify(Object.fromEntries(
      Object.entries(localStorage).sort(([a], [b]) => a.localeCompare(b)),
    )));

  // Isolate the selection's storage footprint: selecting then clearing must
  // leave persistence byte-identical, which is a stronger and less ambiguous
  // check than scanning storage for a substring the app writes anyway.
  const before = await storage();
  await selectRows(page, ["Researchers map a new lunar water reserve"]);
  await expect(page.getByRole("region", { name: "Bulk actions" })).toContainText("1 selected");
  await page.getByRole("region", { name: "Bulk actions" })
    .getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByRole("region", { name: "Bulk actions" })).toHaveCount(0);
  expect(await storage(), "selection must not touch persisted state").toBe(before);

  // A navigation change clears it.
  await selectRows(page, ["Researchers map a new lunar water reserve"]);
  await expect(page.getByRole("region", { name: "Bulk actions" })).toContainText("1 selected");
  await page.getByRole("button", { name: "Saved stories", exact: true }).click();
  await expect(page.getByRole("region", { name: "Bulk actions" })).toHaveCount(0);
});

test("a reading-status change clears the selection so it cannot act on a hidden row", async ({
  page,
}) => {
  await fixture(page);
  await selectRows(page, ["Researchers map a new lunar water reserve"]);
  await expect(page.getByRole("region", { name: "Bulk actions" })).toContainText("1 selected");
  await page.getByLabel("Reading status", { exact: true }).selectOption("read");
  await expect(page.getByRole("region", { name: "Bulk actions" })).toHaveCount(0);
});

test("bulk hide states the count and writes every selected row", async ({ page }) => {
  await fixture(page);
  const titles = [
    "Researchers map a new lunar water reserve",
    "What lunar water observations can tell us",
  ];
  await selectRows(page, titles);
  await page.evaluate(() => { (window as any).__TEST_CALLS__.length = 0; });
  await page.getByRole("region", { name: "Bulk actions" })
    .getByRole("button", { name: "Hide", exact: true }).click();

  // The count must be stated, not implied.
  await expect(page.getByText(/2 stories hidden/)).toBeVisible();

  const { writes } = await counts(page);
  expect(writes).toHaveLength(1);
  expect(writes[0].op).toBe("article_state_many");
  const expected = await idsFor(page, titles);
  expect(writes[0].items.map((i: any) => i.articleId).sort()).toEqual([...expected].sort());
  expect(writes[0].items.every((i: any) => i.hidden === true)).toBe(true);
  // The selection is consumed by the action.
  await expect(page.getByRole("region", { name: "Bulk actions" })).toHaveCount(0);
});

test("an empty selection offers no bulk actions", async ({ page }) => {
  await fixture(page);
  await expect(page.getByRole("region", { name: "Bulk actions" })).toHaveCount(0);
  const bar = page.getByRole("region", { name: "Bulk actions" });
  expect(await bar.count()).toBe(0);
});
