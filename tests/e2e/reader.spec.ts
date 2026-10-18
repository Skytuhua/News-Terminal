import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";
test("browser without a native runtime never fabricates news", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("Desktop runtime required")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh feeds" })).toHaveCount(
    0,
  );
  // Let the committed screen's passive effects and rejected promises settle.
  await page.evaluate(() => new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  ));
  expect(errors).toEqual([]);
});
test("fixture: alert listener setup failures are visible without an unhandled rejection", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    window.addEventListener = new Proxy(window.addEventListener, {
      apply(addListener, target, args) {
        if (args[0] === "notification-status") throw new Error("Fixture notification listener rejected");
        return Reflect.apply(addListener, target, args);
      },
    });
  });
  await fixture(page);
  const warning = page.getByRole("status", { name: "Alert delivery problem" });
  await expect(warning).toContainText("Alert delivery status is unavailable: Error: Fixture notification listener rejected");
  expect(errors).toEqual([]);
  await warning.getByRole("button", { name: "Show alert history" }).click();
  await expect(page.getByTestId("alert-receipt").first()).toBeVisible();
});
test("fixture: select, save, search cached content and open original", async ({
  page,
}) => {
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
  await page.getByRole("button", { name: "Save story", exact: true }).click();
  await page
    .getByRole("button", { name: "Saved stories", exact: true })
    .click();
  await expect(page.getByTestId("story-row")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Open original", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__TEST_CALLS__.some(
          (r: any) =>
            r.op === "open_original" && r.url === "https://example.org/moon",
        ),
      ),
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "All headlines", exact: true })
    .click();
  await page.getByRole("searchbox").fill("chips");
  await expect(page.getByTestId("story-row")).toHaveCount(1);
  await expect(
    page.getByRole("button", {
      name: "New chips improve battery efficiency",
      exact: true,
    }),
  ).toBeVisible();
});
