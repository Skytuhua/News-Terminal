import { readFileSync } from "node:fs";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

function escapeData(value) {
  return stripVTControlCharacters(String(value))
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

function escapeProperty(value) {
  return escapeData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

function annotate(title, message, location = {}) {
  const properties = [];
  if (location.file) {
    properties.push(`file=${escapeProperty(location.file)}`);
    if (Number.isInteger(location.line) && location.line > 0) properties.push(`line=${location.line}`);
    if (Number.isInteger(location.column) && location.column > 0) properties.push(`col=${location.column}`);
  }
  properties.push(`title=${escapeProperty(title)}`);
  console.log(`::error ${properties.join(",")}::${escapeData(message)}`);
}

function errorMessage(error) {
  return error.message || error.stack || error.value || "Playwright reported an error without a message.";
}

function reportSuites(suites, rootDir, titles = []) {
  let count = 0;
  for (const suite of suites) {
    if (!suite || !Array.isArray(suite.specs) || (suite.suites !== undefined && !Array.isArray(suite.suites))) {
      throw new Error("Expected suites to contain specs arrays and optional suites arrays.");
    }
    const suiteTitles = suite.title ? [...titles, suite.title] : titles;
    for (const spec of suite.specs) {
      if (!spec || !Array.isArray(spec.tests)) throw new Error("Expected spec tests to be an array.");
      const specLocation = { ...spec, file: rootDir && spec.file ? path.resolve(rootDir, spec.file) : spec.file };
      for (const test of spec.tests) {
        if (!test || !["expected", "unexpected", "skipped", "flaky"].includes(test.status) || !Array.isArray(test.results)) {
          throw new Error("Expected test outcome and results array.");
        }
        if (test.status !== "unexpected") continue;
        const title = `${test.projectName ? `[${test.projectName}] ` : ""}${[...suiteTitles, spec.title].join(" > ")}`;
        const result = test.results.at(-1);
        const errors = result?.errors?.length ? result.errors : result?.error ? [result.error] : [];
        if (errors.length) {
          for (const error of errors) {
            annotate(title, errorMessage(error), error.location ?? result.errorLocation ?? specLocation);
            count++;
          }
        } else {
          annotate(title, `Expected status ${test.expectedStatus ?? "unknown"}; actual status ${result?.status ?? "unavailable"}.`, specLocation);
          count++;
        }
      }
    }
    count += reportSuites(suite.suites ?? [], rootDir, suiteTitles);
  }
  return count;
}

const reportFile = process.argv[2] ?? "test-results/playwright-results.json";
let contents;
try {
  contents = readFileSync(reportFile, "utf8");
} catch (error) {
  annotate("Playwright diagnostics", `Could not read Playwright report ${reportFile}: ${error.message}`);
  process.exit(1);
}

try {
  const report = JSON.parse(contents);
  if (!report || !Array.isArray(report.suites) || !Array.isArray(report.errors)) {
    throw new Error("Expected suites and errors arrays.");
  }
  let count = reportSuites(report.suites, report.config?.rootDir);
  for (const error of report.errors) {
    annotate("Playwright global error", errorMessage(error), error.location);
    count++;
  }
  if (!count) console.log("Playwright report contains no unexpected test failures or global errors; inspect the original test command failure.");
} catch (error) {
  annotate("Playwright diagnostics", `Invalid Playwright report ${reportFile}: ${error.message}`);
  process.exitCode = 1;
}
