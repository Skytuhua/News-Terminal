import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const script = path.join(root, "scripts/run-playwright.mjs");
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  return (server.address() as { port: number }).port;
}

async function freePort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function run(port: string, cwd = root, args = ["--list", "tests/e2e/reader.spec.ts", "--reporter=line"], extraEnv: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    env: { ...process.env, NEWS_TERMINAL_E2E_PORT: port, ...extraEnv },
    encoding: "utf8",
    timeout: 45000,
    maxBuffer: 2 * 1024 * 1024,
  });
}

test("lists the checkout's real tests when launched from a different folder with spaces", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "news terminal harness "));
  directories.push(directory);
  const result = run(String(await freePort()), directory);
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toContain("reader.spec.ts");
  expect(result.stdout).toContain("Total:");
}, 60000);

test("rejects a malformed selected port before starting the test server", () => {
  const result = run("1420-invalid");
  expect(result.status, result.stdout + result.stderr).toBe(1);
  expect(result.stderr).toContain("NEWS_TERMINAL_E2E_PORT");
}, 60000);

test("rejects the checkout itself as a directory that Playwright would clear", async () => {
  const result = run(String(await freePort()), root, ["--list", "tests/e2e/reader.spec.ts", "--reporter=line"], { NEWS_TERMINAL_E2E_OUTPUT_DIR: "." });
  expect(result.status, result.stdout + result.stderr).toBe(1);
  expect(result.stderr).toContain("NEWS_TERMINAL_E2E_OUTPUT_DIR");
}, 60000);

test("fails on an occupied selected port without using or stopping its owner", async () => {
  const owner = createServer();
  const port = await listen(owner);
  try {
    const result = run(String(port), root, ["tests/e2e/reader.spec.ts", "--reporter=line"]);
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stderr).toContain(`Port ${port} is already in use`);
    expect(owner.listening).toBe(true);
  } finally {
    await new Promise<void>((resolve, reject) => owner.close(error => error ? reject(error) : resolve()));
  }
}, 60000);

test("preserves a real test-discovery failure and releases its selected port", async () => {
  const port = await freePort();
  const result = run(String(port), root, ["--list", "no-such-harness-test.spec.ts", "--reporter=line"]);
  expect(result.status, result.stdout + result.stderr).toBe(1);
  expect(result.stdout + result.stderr).toContain("No tests found");
  const probe = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(port, "127.0.0.1", () => resolve());
    });
    expect(probe.listening).toBe(true);
  } finally {
    if (probe.listening) await new Promise<void>(resolve => probe.close(() => resolve()));
  }
}, 60000);
