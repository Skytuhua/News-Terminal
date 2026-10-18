import { test, expect, type TestInfo } from "@playwright/test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { timeout: 5000, stdio: "ignore" });
  } else {
    child.kill("SIGKILL");
  }
}

async function runStartupProbe(info: TestInfo, brokenAsset = false) {
  const directory = info.outputPath("startup-probe");
  mkdirSync(directory, { recursive: true });
  let compilation: Promise<void> | undefined;
  let compileTimer: NodeJS.Timeout | undefined;
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (request.url === "/entry.js") {
      if (brokenAsset) {
        response.writeHead(500, { "Content-Type": "text/javascript" });
        response.end("Synthetic startup transform failure");
        return;
      }
      // Simulate one cold transform that takes longer than the ordinary test's
      // 5-second budget. Later requests reuse the completed work.
      compilation ??= new Promise(resolve => { compileTimer = setTimeout(resolve, 7000); });
      await compilation;
      response.writeHead(200, { "Content-Type": "text/javascript" });
      response.end("document.body.innerHTML = '<h2>Desktop runtime required</h2>';");
    } else {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end('<!doctype html><script type="module" src="/entry.js"></script>');
    }
  });
  let child: ChildProcess | undefined;
  let timeout: NodeJS.Timeout | undefined;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Probe did not receive a loopback port");
    const baseURL = `http://127.0.0.1:${address.port}`;
    const marker = path.join(directory, "ordinary-test-started.txt");
    const report = path.join(directory, "report.json");
    const config = path.join(directory, "playwright.config.ts");
    writeFileSync(config, `
import base from ${JSON.stringify(pathToFileURL(path.join(root, "playwright.config.ts")).href)};
export default {
  ...base,
  testDir: ${JSON.stringify(path.join(root, "tests/e2e"))},
  timeout: 5000,
  webServer: undefined,
  outputDir: ${JSON.stringify(path.join(directory, "nested-results"))},
  use: { ...base.use, baseURL: ${JSON.stringify(baseURL)} },
  projects: (base.projects ?? [{}]).map(project => project.name === "startup"
    ? project
    : { ...project, testDir: ${JSON.stringify(directory)}, testMatch: "probe.spec.ts" }),
};
`);
    writeFileSync(path.join(directory, "probe.spec.ts"), `
import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
test("ordinary navigation retains its five-second budget", async ({ page }, info) => {
  writeFileSync(${JSON.stringify(marker)}, "ordinary test started");
  expect(info.timeout).toBe(5000);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Desktop runtime required" })).toBeVisible();
});
`);
    child = spawn(process.execPath, [path.join(root, "node_modules/playwright/cli.js"),
      "test", "--config", config, "probe.spec.ts", "--reporter=line,json"], {
      cwd: root,
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: report },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", chunk => { output = (output + chunk).slice(-100000); });
    child.stderr?.on("data", chunk => { output = (output + chunk).slice(-100000); });
    let timedOut = false;
    timeout = setTimeout(() => { timedOut = true; if (child) stopChild(child); }, 45000);
    const [code] = await once(child, "exit");
    expect(timedOut, output).toBe(false);
    expect(existsSync(report), output).toBe(true);
    return { code, output, report, marker, result: JSON.parse(readFileSync(report, "utf8")) };
  } finally {
    if (timeout) clearTimeout(timeout);
    if (compileTimer) clearTimeout(compileTimer);
    if (child) stopChild(child);
    if (server.listening) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }
}

test("cold startup finishes before the ordinary navigation budget begins", async ({}, info) => {
  test.setTimeout(60000);
  const probe = await runStartupProbe(info);
  expect(probe.code, probe.output).toBe(0);
  expect(probe.result.stats.unexpected).toBe(0);
  expect(existsSync(probe.marker)).toBe(true);
});

test("startup asset failure stops ordinary tests and remains reportable", async ({}, info) => {
  test.setTimeout(60000);
  const probe = await runStartupProbe(info, true);
  expect(probe.code, probe.output).toBe(1);
  expect(probe.result.stats.unexpected).toBe(1);
  expect(probe.result.stats.skipped).toBe(1);
  expect(existsSync(probe.marker)).toBe(false);
  const annotation = spawnSync(process.execPath,
    [path.join(root, "scripts/report-playwright-failures.mjs"), probe.report], { encoding: "utf8" });
  expect(annotation.status, annotation.stderr).toBe(0);
  expect(annotation.stdout).toContain("::error ");
  expect(annotation.stdout).toContain("[startup]");
  expect(annotation.stdout).toContain("HTTP 500");
});
