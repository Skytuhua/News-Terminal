import { defineConfig } from "@playwright/test";
import { browserHarnessOptions } from "./scripts/harness-config.mjs";
const externalServer = process.env.NEWS_TERMINAL_E2E_SERVER === "external";
const harness = browserHarnessOptions();

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  projects: [
    {
      name: "startup",
      testMatch: "**/startup.setup.ts",
      timeout: 60000,
    },
    {
      name: "chromium",
      testMatch: "**/*.spec.ts",
      dependencies: ["startup"],
    },
  ],
  outputDir: harness.outputDir,
  use: {
    baseURL: harness.baseURL,
    launchOptions: { executablePath: harness.executablePath },
    viewport: { width: 1440, height: 960 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: externalServer
    ? undefined
    : {
        command: "node scripts/playwright-vite-server.mjs",
        url: harness.baseURL,
        reuseExistingServer: false,
        gracefulShutdown: { signal: "SIGTERM", timeout: 500 },
      },
  reporter: [["list"], ["html", { open: "never", outputFolder: harness.htmlReportDir }]],
});
