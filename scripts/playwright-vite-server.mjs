import { createServer } from "vite";

const server = await createServer({
  mode: "test",
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
});

await server.listen();
server.printUrls();

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
