import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";
test("fixture: AI is opt-in, cancellation discards late results, successful output names provenance", async ({
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
    page.getByRole("button", { name: "Summarize excerpt", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Configure AI" }).click();
  await page.getByLabel("Enable Ollama").check();
  await page.getByLabel("I consent to sending excerpts to Ollama").check();
  await page.getByRole("button", { name: "Save Ollama" }).click();
  await expect(page.getByText("Provider settings saved.")).toBeVisible();
  await page.getByRole("button", { name: "Close settings" }).click();
  await page
    .getByRole("button", { name: "Summarize excerpt", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel summary", exact: true })
    .click();
  await expect(page.getByText("Summary cancelled.")).toBeVisible();
  await expect(
    page.getByText("Fixture summary of the lunar observations.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Summarize excerpt", exact: true })
    .click();
  await expect(
    page.getByText("Fixture summary of the lunar observations.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Ollama · llama3.2 · feed excerpt"),
  ).toBeVisible();
});
test("fixture: a failed summary leaves the publisher excerpt readable", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", {
      name: "Researchers map a new lunar water reserve",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Configure AI" }).click();
  await page.getByLabel("Enable Ollama").check();
  await page.getByLabel("I consent to sending excerpts to Ollama").check();
  await page.getByRole("button", { name: "Save Ollama" }).click();
  await expect(page.getByText("Provider settings saved.")).toBeVisible();
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.evaluate(() => ((window as any).__FAIL_OP__ = "summarize"));
  await page
    .getByRole("button", { name: "Summarize excerpt", exact: true })
    .click();
  await expect(
    page.getByText("Fixture service unavailable", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "A research team has published its observations of water near the lunar south pole.",
      { exact: true },
    ),
  ).toBeVisible();
});
