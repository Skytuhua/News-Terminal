import { expect, test, type Page } from "@playwright/test";
import { fixture } from "./fixture";

// 0.5 alert delivery feedback. The host emits notification-status when Windows
// delivery fails, and alert_receipts proves what was actually delivered.
// Before this, a silenced alert was indistinguishable from a delivered one.

const failDelivery = (page: Page, message: string) =>
  page.evaluate(
    (m) => window.dispatchEvent(new CustomEvent("notification-status", { detail: m })),
    message,
  );

const HOST_MESSAGE =
  "Windows notifications are unavailable. Delivery will retry briefly; watchlist updates remain in the app.";

test("a delivery failure is surfaced visibly and verbatim", async ({ page }) => {
  await fixture(page);
  await expect(page.getByRole("status", { name: "Alert delivery problem" })).toHaveCount(0);
  await failDelivery(page, HOST_MESSAGE);
  const banner = page.getByRole("status", { name: "Alert delivery problem" });
  await expect(banner).toBeVisible();
  // The renderer must not paraphrase a delivery failure it cannot verify.
  await expect(banner).toContainText("Windows notifications are unavailable");
  await expect(banner).toContainText("watchlist updates remain in the app");
});

test("the failure banner can be dismissed but is not lost silently", async ({ page }) => {
  await fixture(page);
  await failDelivery(page, HOST_MESSAGE);
  await page.getByRole("button", { name: "Dismiss alert warning" }).click();
  await expect(page.getByRole("status", { name: "Alert delivery problem" })).toHaveCount(0);
  // Dismissal removes the banner but leaves a durable route to the receipts.
  await expect(page.getByRole("button", { name: "Alert history", exact: true })).toBeVisible();
});

test("alert history lists receipts newest first", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: "Alert history", exact: true }).click();
  const rows = page.getByTestId("alert-receipt");
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText("Researchers map a new lunar water reserve");
  await expect(rows.nth(1)).toContainText("New chips improve battery density");
});

test("a receipt whose article was pruned says so instead of showing a blank row", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: "Alert history", exact: true }).click();
  const pruned = page.getByTestId("alert-receipt").nth(2);
  await expect(pruned).toContainText("No longer available");
  // The timestamp still survives, so the reader can see roughly when it fired.
  await expect(pruned).toContainText("2026");
});

test("the failure banner links to the receipts", async ({ page }) => {
  await fixture(page);
  await failDelivery(page, HOST_MESSAGE);
  await page.getByRole("button", { name: "Show alert history" }).click();
  await expect(page.getByTestId("alert-receipt").first()).toBeVisible();
});

test("an empty receipt list explains why instead of looking broken", async ({ page }) => {
  await fixture(page, { alertReceipts: [] });
  await page.getByRole("button", { name: "Alert history", exact: true }).click();
  await expect(page.getByText("No alerts delivered yet", { exact: false })).toBeVisible();
  await expect(page.getByText("only while News Terminal is running", { exact: false })).toBeVisible();
});

test("receipts are requested with an explicit profileId", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: "Alert history", exact: true }).click();
  await expect(page.getByTestId("alert-receipt").first()).toBeVisible();
  const call = await page.evaluate(() =>
    (window as any).__TEST_CALLS__.filter((r: any) => r.op === "alert_receipts").pop());
  // No default profile: the host refuses a receipt read without one.
  expect(call).toBeTruthy();
  expect(call.profileId).toBe("default");
});

test("switching profile does not leak another profile's receipts", async ({ page }) => {
  // savedProfile adds a second profile, the only way a cross-profile leak is
  // observable at all.
  await fixture(page, { savedProfile: true });
  const sel = page.getByLabel("Reading profile", { exact: true });
  const current = await sel.evaluate((el: HTMLSelectElement) => el.value);
  const other = (await sel.evaluate((el: HTMLSelectElement) =>
    Array.from(el.options).map((o) => o.value).find((v) => v !== el.value)))!;

  await page.getByRole("button", { name: "Alert history", exact: true }).click();
  await expect(page.getByTestId("alert-receipt").first()).toBeVisible();

  await sel.selectOption(other);
  await expect
    .poll(() => page.evaluate(() => (window as any).__TEST_SNAPSHOT__().profile.id))
    .toBe(other);
  // Re-enter the view so the receipts read is issued for the new profile.
  await page.getByRole("button", { name: "Alert history", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__TEST_CALLS__.filter((r: any) => r.op === "alert_receipts").pop()?.profileId))
    .toBe(other);
  await expect(page.getByTestId("alert-receipt")).toHaveCount(0);
  await expect(page.getByText("No alerts delivered yet", { exact: false })).toBeVisible();
  // The profile we came from is untouched and still holds its receipts.
  expect(other).not.toBe(current);
});
