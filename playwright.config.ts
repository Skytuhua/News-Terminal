import { defineConfig } from "@playwright/test";
const externalServer = process.env.NEWS_TERMINAL_E2E_SERVER === "external";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:1420",
    viewport: { width: 1440, height: 960 },
    screenshot: "only-on-failure",
  },
  webServer: externalServer
    ? undefined
    : {
        command: "node scripts/playwright-vite-server.mjs",
        url: "http://127.0.0.1:1420",
        reuseExistingServer: false,
        gracefulShutdown: { signal: "SIGTERM", timeout: 500 },
      },
  reporter: [["list"], ["html", { open: "never" }]],
});
