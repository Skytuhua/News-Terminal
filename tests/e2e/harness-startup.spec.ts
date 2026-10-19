import { test, expect, type TestInfo } from "@playwright/test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
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

async function runStartupProbe(info: TestInfo, failure?: "startup" | "ordinary") {
  const directory = info.outputPath("startup-probe");
  mkdirSync(directory, { recursive: true });
  let compilation: Promise<void> | undefined;
  let compileTimer: NodeJS.Timeout | undefined;
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (request.url === "/entry.js") {
      if (failure === "startup") {
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
    } else if (request.url === "/ordinary-failure") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(`<!doctype html><h1>Ordinary trace DOM marker</h1><script type="module">
        console.info("Ordinary trace console marker");
        await fetch("/trace-request-failed").catch(() => {});
        throw new Error("Ordinary trace page error marker");
      </script>`);
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
  expect(info.retry).toBe(0);
  expect(info.project.retries).toBe(0);
  if (${failure === "ordinary"}) {
    await page.route("**/trace-request-failed", route => route.abort("failed"));
    const pageError = page.waitForEvent("pageerror");
    await page.goto("/ordinary-failure");
    expect((await pageError).message).toBe("Ordinary trace page error marker");
    await expect(page.getByRole("heading", { name: "Ordinary trace DOM marker", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Deliberately missing ordinary heading", exact: true })).toBeVisible({ timeout: 500 });
    return;
  }
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
    return { code, output, report, marker, directory, result: JSON.parse(readFileSync(report, "utf8")) };
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

function resultsForProject(suites: any[], project: string): any[] {
  return suites.flatMap(suite => [
    ...suite.specs.flatMap((spec: any) => spec.tests
      .filter((test: any) => test.projectName === project)
      .flatMap((test: any) => test.results)),
    ...resultsForProject(suite.suites ?? [], project),
  ]);
}

function traceArchives(directory: string) {
  return readdirSync(path.join(directory, "nested-results"), { recursive: true })
    .filter(name => typeof name === "string" && name.endsWith(".zip"));
}

test("cold startup finishes before the ordinary navigation budget begins", async ({}, info) => {
  test.setTimeout(60000);
  const probe = await runStartupProbe(info);
  expect(probe.code, probe.output).toBe(0);
  expect(probe.result.stats.unexpected).toBe(0);
  expect(existsSync(probe.marker)).toBe(true);
  for (const project of ["startup", "chromium"]) {
    const results = resultsForProject(probe.result.suites, project);
    expect(results).toHaveLength(1);
    expect(results[0].attachments.filter((attachment: any) => attachment.name === "trace")).toEqual([]);
  }
  expect(traceArchives(probe.directory)).toEqual([]);
});

test("startup asset failure stops ordinary tests and remains reportable", async ({}, info) => {
  test.setTimeout(60000);
  const probe = await runStartupProbe(info, "startup");
  expect(probe.code, probe.output).toBe(1);
  expect(probe.result.stats.unexpected).toBe(1);
  expect(probe.result.stats.skipped).toBe(1);
  expect(existsSync(probe.marker)).toBe(false);
  const results = resultsForProject(probe.result.suites, "startup");
  expect(results).toHaveLength(1);
  expect(results[0].attachments.filter((attachment: any) => attachment.name === "trace")).toHaveLength(1);
  expect(traceArchives(probe.directory)).toHaveLength(1);
  const annotation = spawnSync(process.execPath,
    [path.join(root, "scripts/report-playwright-failures.mjs"), probe.report], { encoding: "utf8" });
  expect(annotation.status, annotation.stderr).toBe(0);
  expect(annotation.stdout).toContain("::error ");
  expect(annotation.stdout).toContain("[startup]");
  expect(annotation.stdout).toContain("HTTP 500");
});

test("ordinary first-attempt failure retains an inspectable browser trace", async ({}, info) => {
  test.setTimeout(60000);
  const probe = await runStartupProbe(info, "ordinary");
  expect(probe.code, probe.output).toBe(1);
  expect(probe.result.stats.unexpected).toBe(1);
  expect(probe.result.stats.skipped).toBe(0);
  const results = resultsForProject(probe.result.suites, "chromium");
  expect(results).toHaveLength(1);
  const result = results[0];
  expect(result.status).toBe("failed");
  expect(result.retry).toBe(0);
  expect(result.errors.map((error: any) => error.message).join("\n"))
    .toContain("Deliberately missing ordinary heading");
  const traces = result.attachments.filter((attachment: any) => attachment.name === "trace");
  expect(traces, "The original failed attempt must retain its trace").toHaveLength(1);
  expect(traces[0].contentType).toBe("application/zip");
  expect(statSync(traces[0].path).size).toBeGreaterThan(0);
  expect(traceArchives(probe.directory)).toHaveLength(1);

  // Read the archive through the installed Playwright CLI in this probe's own
  // directory. No private Playwright import or additional browser is needed.
  const inspectTrace = (...args: string[]) => {
    const inspection = spawnSync(process.execPath,
      [path.join(root, "node_modules/playwright/cli.js"), "trace", ...args], {
        cwd: probe.directory, encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024,
      });
    expect(inspection.error, inspection.stderr).toBeUndefined();
    expect(inspection.status, inspection.stdout + inspection.stderr).toBe(0);
    return inspection.stdout;
  };
  try {
    inspectTrace("open", traces[0].path);
    const console = inspectTrace("console", "--browser");
    expect(console).toContain("Ordinary trace console marker");
    expect(console).toContain("Ordinary trace page error marker");
    expect(inspectTrace("errors")).toContain("Deliberately missing ordinary heading");
    const requests = inspectTrace("requests", "--failed", "--grep", "trace-request-failed");
    expect(requests).toContain("trace-request-failed");
    expect(requests).toContain("ERR");
    const extracted = path.join(probe.directory, ".playwright-cli", "trace");
    const snapshots = readdirSync(extracted).filter(name => name.endsWith(".trace"))
      .flatMap(name => readFileSync(path.join(extracted, name), "utf8").split("\n")
        .filter(Boolean).map(line => JSON.parse(line)))
      .filter(event => event.type === "frame-snapshot");
    expect(snapshots.some(event => JSON.stringify(event.snapshot.html).includes("Ordinary trace DOM marker")),
      "The retained trace must include the rendered DOM, not only source text").toBe(true);
  } finally {
    inspectTrace("close");
  }
});
