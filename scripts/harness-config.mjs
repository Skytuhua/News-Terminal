import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));

export function browserHarnessOptions(env = process.env) {
  const selected = env.NEWS_TERMINAL_E2E_PORT ?? "1420";
  const port = Number(selected);
  if (!/^[0-9]+$/.test(selected) || !Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("NEWS_TERMINAL_E2E_PORT must be an integer from 1024 to 65535.");
  }
  const resultsRoot = path.join(root, "test-results");
  const outputDir = path.resolve(root, env.NEWS_TERMINAL_E2E_OUTPUT_DIR || "test-results");
  const relative = path.relative(resultsRoot, outputDir);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("NEWS_TERMINAL_E2E_OUTPUT_DIR must be test-results or a folder beneath it; Playwright clears this directory.");
  }
  return {
    port,
    baseURL: `http://127.0.0.1:${port}`,
    outputDir,
    htmlReportDir: outputDir === resultsRoot ? path.join(root, "playwright-report") : `${outputDir}-report`,
    // Keep generated dependencies under a node_modules segment so React's
    // source transform does not Babel-process the prebundled React runtime.
    cacheDir: path.join(root, ".cache", "node_modules", `vite-e2e-${port}`),
    executablePath: env.NEWS_TERMINAL_BROWSER_EXECUTABLE
      ? path.resolve(root, env.NEWS_TERMINAL_BROWSER_EXECUTABLE)
      : undefined,
  };
}
