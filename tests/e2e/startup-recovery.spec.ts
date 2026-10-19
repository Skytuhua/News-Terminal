import { test, expect, type Page } from "@playwright/test";
import { fixture } from "./fixture";

async function recoverListenerFailure(page: Page) {
  await page.addInitScript(() => {
    let rejected = false;
    window.addEventListener = new Proxy(window.addEventListener, {
      apply(addListener, target, args) {
        if (args[0] === "data-changed" && !rejected) {
          rejected = true;
          throw new Error("Fixture workspace listener rejected");
        }
        return Reflect.apply(addListener, target, args);
      },
    });
  });
  // fixture waits for the workspace, so recover its initial failure first.
  await Promise.all([
    fixture(page),
    (async () => {
      await expect(page.getByRole("alert")).toHaveText("Error: Fixture workspace listener rejected");
      await page.getByRole("button", { name: "Retry", exact: true }).click();
    })(),
  ]);
  await expect(page.getByTestId("story-row")).toHaveCount(3);
}

test("fixture: startup retry restores later data-change notifications", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await recoverListenerFailure(page);

  // This is an external/background change, without a UI action's own readback.
  await page.evaluate(() => {
    const w = window as any;
    const snapshot = w.__TEST_SNAPSHOT__();
    w.__TEST_PATCH__({ articles: snapshot.articles.filter((article: any) => article.id !== "a") });
    window.dispatchEvent(new Event("data-changed"));
  });
  await expect(page.getByTestId("story-row")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Researchers map a new lunar water reserve", exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("fixture: startup retry observes a database replacement from another window", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await recoverListenerFailure(page);

  await page.evaluate(async () => {
    const w = window as any;
    const replacement = w.__TEST_SNAPSHOT__();
    replacement.articles = [{ ...replacement.articles[0], id: "restored-story", title: "Restored cached report" }];
    replacement.workspace = {
      tabs: [{ id: "restored", title: "Restored desk", mode: "all", topic: "", query: "", selectedId: "restored-story" }],
      activeTabId: "restored",
    };
    await w.__NEWS_TEST_DISPATCH__({ op: "import", data: JSON.stringify(replacement) });
  });
  await expect(page.getByRole("tab", { name: "Restored desk", exact: true })).toBeVisible();
  await expect(page.getByTestId("story-row")).toHaveCount(1);
  await expect(page.locator(".detail h2")).toHaveText("Restored cached report");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("fixture: retrying a workspace read retains the adopted profile and visit marker", async ({ page }) => {
  await page.addInitScript(() => {
    let rejected = false;
    (window as any).__TEST_BEFORE_DISPATCH__ = (request: { op: string }) => {
      if (request.op === "snapshot" && !rejected) {
        rejected = true;
        throw new Error("Fixture initial snapshot rejected");
      }
    };
  });
  await Promise.all([
    fixture(page, { savedProfile: true }),
    (async () => {
      await expect(page.getByRole("alert")).toHaveText("Error: Fixture initial snapshot rejected");
      await page.getByRole("button", { name: "Retry", exact: true }).click();
    })(),
  ]);
  await expect(page.getByLabel("Reading profile", { exact: true })).toHaveValue("desk-b");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((request: any) => request.op === "visit")))
    .toEqual([{ op: "visit", profileId: "desk-b" }]);
});
