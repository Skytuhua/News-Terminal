import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";

const script = fileURLToPath(new URL("../scripts/report-playwright-failures.mjs", import.meta.url));
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function runReport(report?: unknown, raw?: string) {
  const directory = mkdtempSync(path.join(tmpdir(), "playwright-failures-"));
  directories.push(directory);
  const reportFile = path.join(directory, "results.json");
  if (report !== undefined || raw !== undefined) writeFileSync(reportFile, raw ?? JSON.stringify(report));
  return spawnSync(process.execPath, [script, reportFile], { encoding: "utf8", cwd: directory });
}

function reportWithTests(tests: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    suites: [{ title: "reader.spec.ts", specs: [], suites: [{
      title: "Reader", specs: [{
        title: "opens the story", file: "tests/e2e/reader.spec.ts", line: 11, column: 3, tests,
      }],
    }] }],
    errors: [],
    ...overrides,
  };
}

test("annotates unexpected failures with nested names and assertion locations", () => {
  const result = runReport(reportWithTests([{
    status: "unexpected", expectedStatus: "passed", projectName: "chromium",
    results: [{ status: "failed", errors: [
      { message: "Expected: visible\nReceived: hidden", location: { file: "tests/e2e/reader.spec.ts", line: 24, column: 7 } },
      { message: "Second assertion failed" },
    ] }],
  }]));

  expect(result.status).toBe(0);
  expect(result.stdout).toContain("::error file=tests/e2e/reader.spec.ts,line=24,col=7,title=[chromium] reader.spec.ts > Reader > opens the story::Expected: visible%0AReceived: hidden");
  expect(result.stdout).toContain("file=tests/e2e/reader.spec.ts,line=11,col=3");
  expect(result.stdout).toContain("::Second assertion failed");
  expect(result.stdout.match(/::error /g)).toHaveLength(2);
});

test("uses the final result rather than repeating earlier retry failures", () => {
  const result = runReport(reportWithTests([{
    status: "unexpected", expectedStatus: "passed", projectName: "",
    results: [
      { status: "failed", errors: [{ message: "First attempt" }] },
      { status: "timedOut", error: { message: "Final timeout" }, errorLocation: { file: "tests/e2e/reader.spec.ts", line: 31, column: 2 } },
    ],
  }]));

  expect(result.status).toBe(0);
  expect(result.stdout).toContain("file=tests/e2e/reader.spec.ts,line=31,col=2");
  expect(result.stdout).toContain("::Final timeout");
  expect(result.stdout).not.toContain("First attempt");
});

test("does not label expected failures, skipped tests or flaky successes as failures", () => {
  const result = runReport(reportWithTests([
    { status: "expected", expectedStatus: "failed", results: [{ status: "failed", errors: [{ message: "Expected failure" }] }] },
    { status: "skipped", expectedStatus: "skipped", results: [{ status: "skipped" }] },
    { status: "flaky", expectedStatus: "passed", results: [{ status: "failed", errors: [{ message: "Recovered failure" }] }, { status: "passed" }] },
    { status: "expected", expectedStatus: "passed", results: [{ status: "passed" }] },
  ]));

  expect(result.status).toBe(0);
  expect(result.stdout).not.toContain("::error");
  expect(result.stdout).toContain("no unexpected test failures or global errors");
});

test("explains an unexpected pass without inventing an assertion error", () => {
  const result = runReport(reportWithTests([{
    status: "unexpected", expectedStatus: "failed", results: [{ status: "passed" }],
  }]));

  expect(result.status).toBe(0);
  expect(result.stdout).toContain("Expected status failed; actual status passed.");
});

test("resolves test-definition locations against Playwright's root directory", () => {
  const rootDir = fileURLToPath(new URL("../tests/e2e/", import.meta.url));
  const report = reportWithTests([{
    status: "unexpected", expectedStatus: "failed", results: [{ status: "passed" }],
  }], { config: { rootDir } });
  report.suites[0].suites[0].specs[0].file = "reader.spec.ts";
  const result = runReport(report);

  expect(result.status).toBe(0);
  expect(result.stdout).toContain(`file=${path.resolve(rootDir, "reader.spec.ts").replaceAll(":", "%3A")},line=11,col=3`);
});

test("escapes workflow command data and properties and removes terminal colors", () => {
  const result = runReport(reportWithTests([{
    status: "unexpected", projectName: "100%,:browser\r\n::error::injected",
    results: [{ status: "failed", errors: [{
      message: "\u001b[31m50% failed\u001b[0m\r\n::error::injected",
      location: { file: "tests/a%,:b\r\n.spec.ts", line: 9, column: 4 },
    }] }],
  }]));

  expect(result.status).toBe(0);
  expect(result.stdout.trim().split("\n")).toHaveLength(1);
  expect(result.stdout).toContain("file=tests/a%25%2C%3Ab%0D%0A.spec.ts");
  expect(result.stdout).toContain("title=[100%25%2C%3Abrowser%0D%0A%3A%3Aerror%3A%3Ainjected]");
  expect(result.stdout).toContain("::50%25 failed%0D%0A::error::injected");
  expect(result.stdout).not.toContain("\u001b");
});

test("annotates global setup errors even when no tests ran", () => {
  const result = runReport({ suites: [], errors: [
    { message: "Server did not start", location: { file: "playwright.config.ts", line: 18, column: 1 } },
    { value: "Unknown worker error" },
  ] });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain("file=playwright.config.ts,line=18,col=1,title=Playwright global error::Server did not start");
  expect(result.stdout).toContain("title=Playwright global error::Unknown worker error");
  expect(result.stdout.match(/::error /g)).toHaveLength(2);
});

test("reports missing JSON output honestly", () => {
  const result = runReport();

  expect(result.status).toBe(1);
  expect(result.stdout).toContain("::error title=Playwright diagnostics::Could not read Playwright report");
  expect(result.stdout).not.toContain("no unexpected test failures");
});

test("reports malformed JSON honestly", () => {
  const result = runReport(undefined, "{broken");

  expect(result.status).toBe(1);
  expect(result.stdout).toContain("::error title=Playwright diagnostics::Invalid Playwright report");
});

test.each([null, {}, { suites: {}, errors: [] }, { suites: [], errors: null }])("rejects an invalid report structure: %j", report => {
  const result = runReport(report);

  expect(result.status).toBe(1);
  expect(result.stdout).toContain("::error title=Playwright diagnostics::Invalid Playwright report");
});
