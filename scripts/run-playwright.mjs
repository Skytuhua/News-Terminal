import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import process from "node:process";
import { createServer } from "vite";

const server = await createServer({
  mode: "test",
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
});

let child;
let closing = false;

async function closeServer() {
  if (closing) return;
  closing = true;
  await server.close();
}

async function shutdown(signal) {
  if (child && !child.killed) {
    child.kill(signal);
  }
  await closeServer();
  process.exit(signal === "SIGINT" ? 130 : 1);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGHUP", () => void shutdown("SIGHUP"));

await server.listen();
server.printUrls();

const playwrightCli = path.resolve("node_modules", "playwright", "cli.js");
child = spawn(process.execPath, [playwrightCli, "test", ...process.argv.slice(2)], {
  env: {
    ...process.env,
    NEWS_TERMINAL_E2E_SERVER: "external",
  },
  stdio: "inherit",
});

const [code, signal] = await once(child, "exit");
await closeServer();

if (signal) {
  process.exit(1);
}
process.exit(code ?? 0);
