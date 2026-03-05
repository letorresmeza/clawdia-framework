import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import { initEngines, ALL_CHANNELS } from "./src/lib/engines.js";
import type { ClawMessage } from "@clawdia/types";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env["DASHBOARD_PORT"] ?? "3000", 10);

const app = next({ dev });
const handle = app.getRequestHandler();

async function main(): Promise<void> {
  // Initialize engines (connects to NATS or InMemoryBus)
  const engines = await initEngines();

  await app.prepare();

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url ?? "/", true);
    handle(req, res, parsedUrl);
  });

  // WebSocket server on /ws path
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
  });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url ?? "/", true);
    if (pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  // Subscribe to all ClawBus channels and broadcast to WS clients
  for (const channel of ALL_CHANNELS) {
    engines.bus.subscribe(channel, async (msg: ClawMessage) => {
      const data = JSON.stringify(msg);
      for (const client of clients) {
        if (client.readyState === 1) {
          client.send(data);
        }
      }
    });
  }

  server.listen(port, () => {
    console.log(`[dashboard] Ready on http://localhost:${port}`);
    console.log(`[dashboard] WebSocket on ws://localhost:${port}/ws`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n[dashboard] Shutting down...");
    for (const client of clients) {
      client.close();
    }
    server.close();
    await engines.bus.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
