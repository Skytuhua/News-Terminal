import { createServer } from "vite";
import path from "node:path";
import { browserHarnessOptions, root } from "./harness-config.mjs";

const options = browserHarnessOptions();
const server = await createServer({
  root,
  configFile: path.join(root, "vite.config.ts"),
  cacheDir: options.cacheDir,
  mode: "test",
  server: {
    host: "127.0.0.1",
    port: options.port,
    strictPort: true,
  },
});

async function shutdown() {
  try {
    await server.close();
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
process.on("SIGHUP", () => void shutdown());

try {
  await server.listen();
  server.printUrls();
} catch (error) {
  await server.close();
  console.error(`[browser harness] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
