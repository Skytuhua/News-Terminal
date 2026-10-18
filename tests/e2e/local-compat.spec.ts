import { test, expect, type Page } from "@playwright/test";
import { fixture } from "./fixture";

const compatible = {
  id: "openai-local", kind: "openai-local", name: "Local OpenAI-compatible",
  model: "fixture-local@q4_k_m", baseUrl: "http://127.0.0.1:1234/v1",
  enabled: true, consented: true, hasKey: false,
};

async function openStory(page: Page) {
  await page.getByRole("button", { name: "Researchers map a new lunar water reserve", exact: true }).click();
}

test("fixture: compatible settings require explicit model, endpoint and consent without sending content", async ({ page }) => {
  await fixture(page);
  await openStory(page);
  const generate = page.getByRole("button", { name: "Summarize excerpt", exact: true });
  await expect(generate).toBeDisabled();
  await page.getByRole("button", { name: "Configure AI", exact: true }).click();
  const form = page.locator("form").filter({ has: page.getByRole("heading", { name: "Local OpenAI-compatible", exact: true }) });
  const enable = form.getByLabel("Enable Local OpenAI-compatible", { exact: true });
  const consent = form.getByLabel("I consent to sending excerpts to Local OpenAI-compatible", { exact: true });
  await expect(enable).not.toBeChecked();
  await expect(consent).not.toBeChecked();
  await expect(form.getByLabel("Local OpenAI-compatible model", { exact: true })).toBeEmpty();
  await expect(form.locator('input[name="apiKey"]')).toHaveCount(0);
  await expect(page.getByText(/A localhost address only identifies the server connection/)).toBeVisible();
  const before = await page.evaluate(() => (window as any).__TEST_SNAPSHOT__().sources);

  await form.getByLabel("Local OpenAI-compatible model", { exact: true }).fill(compatible.model);
  await form.getByLabel("Local OpenAI-compatible base URL").fill("http://localhost:8080/v1");
  await enable.check();
  await form.getByRole("button", { name: "Save Local OpenAI-compatible", exact: true }).click();
  await expect(page.getByText("Provider settings saved.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(generate).toBeDisabled();

  await page.getByRole("button", { name: "Configure AI", exact: true }).click();
  await consent.check();
  await form.getByRole("button", { name: "Save Local OpenAI-compatible", exact: true }).click();
  await expect(page.getByText("Provider settings saved.", { exact: true })).toBeVisible();
  const saved = await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) => r.op === "provider_save").at(-1));
  const { hasKey: _hasKey, ...expectedProvider } = compatible;
  expect(saved.provider).toMatchObject({ ...expectedProvider, baseUrl: "http://localhost:8080/v1" });
  expect(saved.provider).not.toHaveProperty("hasKey");
  // The shared fixture records an explicit undefined apiKey on every call.
  expect(saved.apiKey).toBeUndefined();
  expect(saved.provider).not.toHaveProperty("apiKey");
  expect(await page.evaluate(() => (window as any).__TEST_SNAPSHOT__().sources)).toEqual(before);
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) => ["summarize", "sector_summarize", "local_ai_connect"].includes(r.op)))).toEqual([]);

  await form.getByLabel("Local OpenAI-compatible base URL").fill("http://127.0.0.1:9931/v1");
  await expect(consent).not.toBeChecked();
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect(page.getByText("Fixture summary of the lunar observations.", { exact: true })).toBeVisible();
});

test("fixture: summary readiness follows local consent and source permission, not cloud credentials", async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    (window as any).__TEST_PATCH__({ providers: [{ id: "groq", kind: "groq", name: "Groq", model: "fixture", enabled: true, consented: true, hasKey: true }] });
    window.dispatchEvent(new Event("data-changed"));
  });
  await openStory(page);
  const generate = page.getByRole("button", { name: "Summarize excerpt", exact: true });
  await expect(generate).toBeDisabled();
  await page.evaluate(provider => {
    (window as any).__TEST_PATCH__({ providers: [provider] });
    window.dispatchEvent(new Event("data-changed"));
  }, compatible);
  await expect(generate).toBeEnabled();
  await page.evaluate(() => {
    const w = window as any;
    w.__TEST_PATCH__({ articles: w.__TEST_SNAPSHOT__().articles.map((a: any) => ({ ...a, aiAllowed: false })) });
    window.dispatchEvent(new Event("data-changed"));
  });
  await expect(generate).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) => r.op === "summarize"))).toEqual([]);
});

test("fixture: a compatible provider can request sector quotations after reviewing permitted inputs", async ({ page }) => {
  await fixture(page, { v02: true });
  await page.evaluate(provider => {
    (window as any).__TEST_PATCH__({ providers: [provider] });
    window.dispatchEvent(new Event("data-changed"));
  }, compatible);
  await page.getByRole("button", { name: "Daily briefing", exact: true }).click();
  const panel = page.getByRole("region", { name: "Science source quotations", exact: true });
  const generate = panel.getByRole("button", { name: "Generate sector summary", exact: true });
  await expect(generate).toBeDisabled();
  await panel.locator("summary").filter({ hasText: "Review selected source inputs" }).click();
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect(panel.getByRole("heading", { name: "AI-selected source quotations · unverified", exact: true })).toBeVisible();
  const calls = await page.evaluate(() => (window as any).__TEST_CALLS__.filter((r: any) => r.op === "sector_summarize"));
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ profileId: "default", sectorId: "science" });
  expect(calls[0]).not.toHaveProperty("sources");
});
