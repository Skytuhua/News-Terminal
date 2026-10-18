import { test, expect } from "@playwright/test";

test("load the browser application before ordinary tests", async ({ page, baseURL }, info) => {
  const origin = new URL(baseURL!).origin;
  const errors: string[] = [];
  const record = (message: string) => { if (errors.length < 20) errors.push(message.slice(0, 2000)); };
  const isAsset = (url: string, type: string) => new URL(url).origin === origin
    && ["document", "script", "stylesheet"].includes(type);
  page.on("pageerror", error => record(error.message));
  page.on("requestfailed", request => {
    if (isAsset(request.url(), request.resourceType())) {
      record(`${request.url()}: ${request.failure()?.errorText ?? "request failed"}`);
    }
  });
  page.on("response", response => {
    if (response.status() >= 400 && isAsset(response.url(), response.request().resourceType())) {
      record(`HTTP ${response.status()} ${response.url()}`);
    }
  });
  const started = Date.now();
  try {
    // No fixture or IPC injection: this renders the existing safe browser screen
    // while loading the same HTML, styles and static modules as the real tests.
    const response = await page.goto("/", { waitUntil: "load" });
    expect(response?.ok(), "The browser entry document must load successfully").toBe(true);
    expect(errors, "Browser startup assets must load without errors").toEqual([]);
    await expect(page.getByRole("heading", { name: "Desktop runtime required", exact: true })).toBeVisible();
    expect(errors, "Browser startup must finish without page errors").toEqual([]);
  } finally {
    // Keep useful diagnostics even when navigation or the render assertion times out.
    await info.attach("browser-startup.json", {
      body: Buffer.from(JSON.stringify({ baseURL, elapsedMs: Date.now() - started, errors }, null, 2)),
      contentType: "application/json",
    });
  }
});
