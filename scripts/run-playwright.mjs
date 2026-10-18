import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import process from "node:process";
import { createServer } from "vite";
import { browserHarnessOptions, root } from "./harness-config.mjs";

let server;
let child;
let closing;
let stopping = false;

async function closeServer() {
  if (!closing) closing = server?.close() ?? Promise.resolve();
  await closing;
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  try {
    if (child && child.exitCode === null && child.signalCode === null) {
      if (process.platform === "win32" && child.pid) {
        // Only this runner's child tree, including its browser workers.
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        await once(killer, "exit").catch(() => child.kill(signal));
      } else {
        child.kill(signal);
      }
    }
  } finally {
    await closeServer();
    process.exit(signal === "SIGINT" ? 130 : 143);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGHUP", () => void shutdown("SIGHUP"));

try {
  const options = browserHarnessOptions();
  const args = process.argv.slice(2);
  if (!args.some(arg => ["--list", "--help", "-h"].includes(arg))) {
    server = await createServer({
      root,
      configFile: path.join(root, "vite.config.ts"),
      mode: "test",
      cacheDir: options.cacheDir,
      server: { host: "127.0.0.1", port: options.port, strictPort: true },
    });
    await server.listen();
    server.printUrls();
  }
  const playwrightCli = path.join(root, "node_modules", "playwright", "cli.js");
  child = spawn(process.execPath, [playwrightCli, "test", ...args], {
    cwd: root,
    env: { ...process.env, NEWS_TERMINAL_E2E_SERVER: "external" },
    stdio: "inherit",
  });
  const [code, signal] = await once(child, "exit");
  process.exitCode = signal ? 1 : (code ?? 1);
} catch (error) {
  console.error(`[browser harness] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await closeServer();
}
