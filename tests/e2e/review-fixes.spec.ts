import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";

test("delayed tab switching never persists programmatic query changes", async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    const w = window as any;
    const s = w.__TEST_SNAPSHOT__();
    s.workspace.tabs[0].query = "lunar";
    s.workspace.tabs.push({ id: "chips", title: "Chips", topic: "", query: "chips", mode: "all" });
    localStorage.setItem("fixture-state", JSON.stringify(s));
  });
  await page.reload();
  await expect(page.getByLabel("Search cached stories")).toHaveValue("lunar");
  await page.evaluate(() => { (window as any).__TEST_SNAPSHOT_DELAY__ = 650; });
  await page.getByRole("tab", { name: "Chips", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Chips", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.waitForTimeout(2000);
  expect(await page.evaluate(() => (window as any).__TEST_SNAPSHOT__().workspace.tabs.map((t: any) => t.query))).toEqual(["lunar", "chips"]);
  await page.getByLabel("Search cached stories").fill("battery");
  await page.getByRole("tab", { name: "Headlines", exact: true }).click();
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => (window as any).__TEST_SNAPSHOT__().workspace.tabs.map((t: any) => t.query))).toEqual(["lunar", "battery"]);
});

test("navigation clearing search cancels an older debounced input", async ({ page }) => {
  await fixture(page);
  await page.getByLabel("Search cached stories").fill("lunar");
  await page.getByRole("button", { name: "Technology", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Technology", exact: true })).toBeVisible();
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => (window as any).__TEST_SNAPSHOT__().workspace.tabs[0].query)).toBe("");
});

test("active searches defer matching arrivals until Show latest", async ({ page }) => {
  await fixture(page);
  await page.getByLabel("Search cached stories").fill("lunar");
  await expect(page.getByTestId("story-row")).toHaveCount(2);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const w = window as any;
    const s = w.__TEST_SNAPSHOT__();
    w.__TEST_PATCH__({ articles: [{ ...s.articles[0], id: "new-lunar", title: "Fresh lunar report" }, ...s.articles] });
    window.dispatchEvent(new Event("data-changed"));
  });
  await expect(page.getByRole("button", { name: /Show latest/ })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByTestId("story-row")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Fresh lunar report", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /Show latest/ }).click();
  await expect(page.getByTestId("story-row")).toHaveCount(3);
});

test("main window restores its native profile and persists explicit switches", async ({ page }) => {
  await fixture(page, { savedProfile: true });
  await expect(page.getByLabel("Reading profile")).toHaveValue("desk-b");
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) => r.op === "snapshot").map((r: any) => r.profileId))).not.toContain("default");
  await page.getByLabel("Reading profile").selectOption("default");
  await expect(page.getByLabel("Reading profile")).toHaveValue("default");
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.some((r: any) => r.op === "window_set_profile" && r.profileId === "default"))).toBe(true);
  await page.reload();
  await expect(page.getByLabel("Reading profile")).toHaveValue("default");
});

test("import reconciles a removed selected profile and discards its workspace", async ({ page }) => {
  await fixture(page);
  const backup = await page.evaluate(() => JSON.stringify((window as any).__TEST_SNAPSHOT__()));
  await page.getByRole("button", { name: "Manage profiles" }).click();
  await page.getByLabel("New profile name").fill("Temporary desk");
  await page.getByRole("button", { name: "Create profile", exact: true }).click();
  await expect(page.getByText(/Profile created/)).toBeVisible();
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.getByLabel("Reading profile").selectOption({ label: "Temporary desk" });
  await expect(page.getByLabel("Reading profile").locator("option:checked")).toHaveText("Temporary desk");
  await page.getByRole("button", { name: "Technology", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Technology", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Backup", exact: true }).click();
  await page.getByLabel("Backup JSON").fill(backup);
  await page.getByLabel("I understand this replaces the current local data").check();
  await page.getByRole("button", { name: "Import backup", exact: true }).click();
  await expect(page.getByText("Backup imported.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page.getByLabel("Reading profile")).toHaveValue("default");
  await expect(page.getByRole("tab", { name: "Headlines", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("story-row")).toHaveCount(3);
});

test("import readback failure is reported in the dialog without false success", async ({ page }) => {
  await fixture(page);
  const backup = await page.evaluate(() => {
    (window as any).__TEST_FAIL_IMPORT_READBACK__ = true;
    return JSON.stringify((window as any).__TEST_SNAPSHOT__());
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Backup", exact: true }).click();
  await page.getByLabel("Backup JSON").fill(backup);
  await page.getByLabel("I understand this replaces the current local data").check();
  await page.getByRole("button", { name: "Import backup", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Fixture service unavailable");
  await expect(page.getByText("Backup imported.", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page.getByTestId("story-row")).toHaveCount(0);
  await page.evaluate(() => { (window as any).__TEST_CALLS__.length = 0; });
  await page.keyboard.press("j");
  await page.keyboard.press("r");
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) => ["article_state", "refresh", "workspace_save"].includes(r.op)))).toEqual([]);
  await page.evaluate(() => { (window as any).__FAIL_OP__ = undefined; });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByTestId("story-row")).toHaveCount(3);
});

test("settings restores focus to its opener after closing", async ({ page }) => {
  await fixture(page);
  const opener = page.getByRole("button", { name: "Settings", exact: true });
  await opener.click();
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(opener).toBeFocused();
});

test("comparison dialog blocks background J S and R shortcuts", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: "Researchers map a new lunar water reserve", exact: true }).click();
  await page.getByRole("button", { name: "Compare coverage", exact: true }).click();
  await page.evaluate(() => { (window as any).__TEST_CALLS__.length = 0; });
  await page.keyboard.press("s");
  await page.keyboard.press("r");
  await page.keyboard.press("j");
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) => ["article_state", "refresh", "workspace_save"].includes(r.op)))).toEqual([]);
  await expect(page.getByRole("dialog", { name: "Compare coverage" })).toBeVisible();
});
