/**
 * Clawdia Broker Daemon — production entry point
 *
 * Boots the full Clawdia Framework and runs indefinitely:
 *   - ClawBus (InMemoryBus, NATS-ready)
 *   - ServiceRegistry + 6 specialist agents
 *   - ContractEngine + RiskEngine
 *   - Telegram notifier plugin
 *   - Web dashboard on port 3000 (status page)
 *   - REST API on port 3001 (POST /api/broker)
 *   - BrokerScheduler (8 scheduled tasks replacing old crons)
 *   - StateManager (crash recovery, 60s auto-save)
 *
 * Handles SIGTERM/SIGINT gracefully: drain bus, save state, close servers.
 * Writes structured JSON logs to /var/log/clawdia/daemon.log.
 */

import * as fs from "node:fs";
import * as http from "node:http";
import { InMemoryBus, ContractEngine, RiskEngine } from "@clawdia/core";
import { ServiceRegistry } from "./registry/service-registry.js";
import { StateManager } from "./state.js";
import { BrokerScheduler } from "./scheduler.js";
import type { AgentIdentity, Notification } from "@clawdia/types";
import type { INotifierPlugin } from "@clawdia/types";
import type { ClawMessage } from "@clawdia/types";

// ─────────────────────────────────────────────────────────
// Bootstrap: load credentials from known env files on disk
// ─────────────────────────────────────────────────────────

const TELEGRAM_ENV_SEARCH_PATHS = [
  "/root/.openclaw/workspace/config/.env",
  "/root/.openclaw/workspace/clawdia-trading/config/.env",
  "/root/.openclaw/workspace/missions/agent-stack/.env",
  "/root/clawdia-v3/config/.env",
  "/root/.env",
];

function loadTelegramCredsFromDisk(): void {
  if (process.env["TELEGRAM_BOT_TOKEN"]) return; // already set

  for (const envPath of TELEGRAM_ENV_SEARCH_PATHS) {
    if (!fs.existsSync(envPath)) continue;
    try {
      const lines = fs.readFileSync(envPath, "utf-8").split("\n");
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const eqIdx = line.indexOf("=");
        if (eqIdx === -1) continue;
        const key = line.slice(0, eqIdx).trim();
        const val = line.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
        if ((key === "TELEGRAM_BOT_TOKEN" || key === "TELEGRAM_CHAT_ID") && val) {
          process.env[key] = val;
        }
      }
      if (process.env["TELEGRAM_BOT_TOKEN"]) {
        console.log(`[daemon] Loaded Telegram credentials from ${envPath}`);
        break;
      }
    } catch {
      // skip unreadable files
    }
  }
}

loadTelegramCredsFromDisk();

// ─────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────

const LOG_DIR = process.env["LOG_DIR"] ?? "/var/log/clawdia";
const LOG_FILE = `${LOG_DIR}/daemon.log`;
const PORT_DASHBOARD = parseInt(process.env["PORT"] ?? "3000", 10);
const PORT_API = parseInt(process.env["API_PORT"] ?? "3001", 10);

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function log(
  level: "INFO" | "WARN" | "ERROR" | "EVENT",
  component: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    component,
    message,
    ...(data ? { data } : {}),
  };

  const line = JSON.stringify(entry);
  console.log(line);

  try {
    fs.appendFileSync(LOG_FILE, line + "\n", "utf-8");
  } catch {
    // If we can't write to log file, stdout is our fallback
  }
}

// ─────────────────────────────────────────────────────────
// Specialist agent identities (inline — no soul.md parsing needed)
// ─────────────────────────────────────────────────────────

const MOCK_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

function makeSpecialist(
  name: string,
  displayName: string,
  description: string,
  capabilities: AgentIdentity["capabilities"],
): AgentIdentity {
  return {
    name,
    displayName,
    description,
    version: "1.0.0",
    operator: "clawdia-labs",
    publicKey: MOCK_KEY,
    capabilities,
    requirements: [],
    runtime: { model: "claude-haiku-4-5-20251001", memoryMb: 512, cpus: 1, timeoutS: 120 },
    reputation: {
      registry: "clawdia-mainnet",
      score: 0.85 + Math.random() * 0.10,
      minimumStake: 10,
      dimensions: { reliability: 0.9, quality: 0.85, speed: 0.88, costEfficiency: 0.82 },
      attestations: [],
    },
  };
}

const CLAWDIA_IDENTITY: AgentIdentity = {
  name: "clawdia-broker",
  displayName: "Clawdia — Agent Services Broker",
  description: "The flagship orchestrator agent. Takes complex requests, decomposes them into DAGs, hires specialists through task contracts, and assembles results.",
  version: "1.0.0",
  operator: "clawdia-labs",
  publicKey: MOCK_KEY,
  capabilities: [
    {
      taxonomy: "orchestration.job.broker",
      description: "Full orchestration pipeline with 15% margin",
      inputSchema: { type: "object", properties: { request: { type: "string" } } },
      outputSchema: { type: "object" },
      sla: { maxLatencyMs: 300_000, availability: 0.99 },
      pricing: { model: "percentage_of_total", amount: 0.15, currency: "USDC" },
    },
    {
      taxonomy: "trading.polymarket.portfolio",
      description: "Prediction market portfolio management via specialist delegation",
      inputSchema: {},
      outputSchema: {},
      sla: { maxLatencyMs: 120_000, availability: 0.95 },
      pricing: { model: "per_request", amount: 0.01, currency: "USDC" },
    },
  ],
  requirements: [
    { taxonomy: "research.web.search" },
    { taxonomy: "analysis.data.csv" },
    { taxonomy: "trading.market.scan", optional: true },
  ],
  runtime: { model: "claude-sonnet-4-6", memoryMb: 1024, cpus: 2, timeoutS: 300 },
  reputation: {
    registry: "clawdia-mainnet",
    score: 0.97,
    minimumStake: 50,
    dimensions: { reliability: 0.99, quality: 0.95, speed: 0.94, costEfficiency: 0.92 },
    attestations: [
      {
        signer: "clawdia-labs",
        claim: "Flagship orchestrator agent — production certified",
        timestamp: "2026-03-06T00:00:00Z",
      },
    ],
  },
};

const SPECIALIST_AGENTS: AgentIdentity[] = [
  makeSpecialist(
    "trading-specialist",
    "Trading Specialist",
    "Prediction market scanning, position management, and trade execution",
    [
      {
        taxonomy: "trading.market.scan",
        description: "Scans prediction markets for opportunities",
        inputSchema: {},
        outputSchema: {},
        sla: { maxLatencyMs: 30_000, availability: 0.95 },
        pricing: { model: "per_request", amount: 0.005, currency: "USDC" },
      },
      {
        taxonomy: "trading.polymarket.execute",
        description: "Executes prediction market trades",
        inputSchema: {},
        outputSchema: {},
        sla: { maxLatencyMs: 10_000, availability: 0.98 },
        pricing: { model: "per_request", amount: 0.01, currency: "USDC" },
      },
    ],
  ),
  makeSpecialist(
    "research-specialist",
    "Research Specialist",
    "Web search, multi-source intelligence gathering, and synthesis",
    [
      {
        taxonomy: "research.web.search",
        description: "Searches the web for relevant information",
        inputSchema: {},
        outputSchema: {},
        sla: { maxLatencyMs: 15_000, availability: 0.97 },
        pricing: { model: "per_request", amount: 0.003, currency: "USDC" },
      },
      {
        taxonomy: "research.synthesis",
        description: "Synthesizes multiple sources into structured findings",
        inputSchema: {},
        outputSchema: {},
        sla: { maxLatencyMs: 30_000, availability: 0.96 },
        pricing: { model: "per_request", amount: 0.008, currency: "USDC" },
      },
      {
        taxonomy: "orchestration.job.broker",
        description: "Brokers research-type orchestration jobs",
        inputSchema: {},
        outputSchema: {},
        sla: { maxLatencyMs: 60_000, availability: 0.95 },
        pricing: { model: "per_request", amount: 0.01, currency: "USDC" },
      },
    ],
  ),
  makeSpecialist(
    "data-analyst",
    "Data Analyst",
    "Statistical analysis, trend detection, and CSV/JSON data processing",
    [
      {
        taxonomy: "analysis.data.csv",
        description: "Performs statistical analysis on structured data",
        inputSchema: {},
        outputSchema: {},
        sla: { maxLatencyMs: 20_000, availability: 0.97 },
        pricing: { model: "per_request", amount: 0.006, currency: "USDC" },
      },
    ],
  ),
  makeSpecialist(
    "content-writer",
    "Content Writer",
    "Technical writing, report generation, and content formatting",
    [
      {
        taxonomy: "content.writing.technical",
        description: "Writes and formats technical content and reports",
        inputSchema: {},
        outputSchema: {},
        sla: { maxLatencyMs: 45_000, availability: 0.96 },
        pricing: { model: "per_request", amount: 0.008, currency: "USDC" },
      },
    ],
  ),
  makeSpecialist(
    "code-builder",
    "Code Builder",
    "Full-stack implementation, code review, and deployment automation",
    [
      {
        taxonomy: "coding.implementation.fullstack",
        description: "Implements code across the full stack",
        inputSchema: {},
        outputSchema: {},
        sla: { maxLatencyMs: 120_000, availability: 0.94 },
        pricing: { model: "per_request", amount: 0.02, currency: "USDC" },
      },
    ],
  ),
];

// ─────────────────────────────────────────────────────────
// Null notifier (used if Telegram is not configured)
// ─────────────────────────────────────────────────────────

class NullNotifier implements INotifierPlugin {
  readonly name = "notifier-null";
  async send(_n: Notification): Promise<void> {}
  async sendBatch(_ns: Notification[]): Promise<void> {}
}

// ─────────────────────────────────────────────────────────
// BrokerDaemon
// ─────────────────────────────────────────────────────────

class BrokerDaemon {
  private readonly bus = new InMemoryBus();
  private readonly contracts: ContractEngine;
  private readonly risk: RiskEngine;
  private readonly registry: ServiceRegistry;
  private readonly state = new StateManager();
  private notifier: INotifierPlugin = new NullNotifier();
  private scheduler?: BrokerScheduler;
  private dashboardServer?: http.Server;
  private apiServer?: http.Server;
  private recentEvents: Array<{ ts: string; channel: string; summary: string }> = [];
  private shuttingDown = false;
  private heartbeatInterval?: NodeJS.Timeout;

  constructor() {
    this.contracts = new ContractEngine(this.bus);
    this.risk = new RiskEngine(this.bus);
    this.registry = new ServiceRegistry(this.bus);
  }

  async boot(): Promise<void> {
    ensureLogDir();
    log("INFO", "daemon", "Clawdia Broker Daemon starting up", {
      nodeVersion: process.version,
      pid: process.pid,
      env: process.env["NODE_ENV"] ?? "development",
    });

    // 1. Connect bus
    await this.bus.connect();
    log("INFO", "daemon", "ClawBus (InMemory) connected — NATS-ready");

    // 2. Start risk engine
    this.risk.start();

    // 3. Load persisted state (crash recovery)
    this.state.load();

    // 4. Load Telegram notifier if configured
    const hasTelegram =
      process.env["TELEGRAM_BOT_TOKEN"] && process.env["TELEGRAM_CHAT_ID"];
    if (hasTelegram) {
      try {
        // From packages/orchestrator/dist/daemon.js → ../../../ = repo root → plugins/
        // CJS default export is double-wrapped: import().default.default = { name, create }
        const raw = await import(
          "../../../plugins/notifier-telegram/dist/index.js" as string
        ) as Record<string, unknown>;
        type PluginDef = { create: () => INotifierPlugin };
        const outer = raw["default"] as Record<string, unknown> | null;
        const pluginDef: PluginDef | null =
          typeof outer?.["create"] === "function"
            ? (outer as PluginDef)
            : typeof (outer?.["default"] as PluginDef | null)?.create === "function"
              ? (outer?.["default"] as PluginDef)
              : null;
        if (!pluginDef) throw new Error("Plugin create() not found — unexpected module shape");
        this.notifier = pluginDef.create();
        log("INFO", "daemon", "Telegram notifier loaded");
      } catch (err) {
        log("WARN", "daemon", `Telegram plugin not loaded: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      log("WARN", "daemon", "TELEGRAM_BOT_TOKEN/CHAT_ID not set — notifications disabled");
    }

    // 5. Subscribe to all ClawBus channels for logging and Telegram routing
    this.subscribeToAllChannels();

    // 6. Register Clawdia + all specialist agents
    this.registry.register(CLAWDIA_IDENTITY);
    for (const agent of SPECIALIST_AGENTS) {
      this.registry.register(agent);
    }
    log("INFO", "daemon", `Registered ${1 + SPECIALIST_AGENTS.length} agents`, {
      agents: [CLAWDIA_IDENTITY.name, ...SPECIALIST_AGENTS.map((a) => a.name)],
    });

    // 7. Start HTTP servers
    this.startDashboardServer();
    this.startApiServer();

    // 8. Start scheduler
    const specialistsByName = new Map<string, AgentIdentity>(
      SPECIALIST_AGENTS.map((a) => [a.name, a]),
    );
    this.scheduler = new BrokerScheduler({
      bus: this.bus,
      contracts: this.contracts,
      registry: this.registry,
      state: this.state,
      notifier: this.notifier,
      clawdiaIdentity: CLAWDIA_IDENTITY,
      specialistsByName,
    });
    this.scheduler.start();

    // 9. Start state auto-save
    this.state.startAutoSave(60_000);

    // 10. Periodic heartbeats — keep all in-process agents online in the registry
    this.heartbeatInterval = setInterval(() => {
      const allAgents = [CLAWDIA_IDENTITY, ...SPECIALIST_AGENTS];
      for (const agent of allAgents) {
        this.registry.heartbeat(agent.name);
      }
      // Update contract and registry stats in state
      const contractStats = this.contracts.stats() as Record<string, number>;
      const total = Object.values(contractStats).reduce((s, n) => s + n, 0);
      this.state.updateContractStats(total, contractStats);
      const regEntries = this.registry.list();
      this.state.updateRegistryStats(
        regEntries.map((e) => ({ name: e.identity.name, status: e.status, registeredAt: e.registeredAt })),
      );
    }, 60_000);
    this.heartbeatInterval?.unref();

    // 10. Send startup notification
    await this.notifier
      .send({
        level: "info",
        title: "Clawdia Broker ONLINE",
        body: `Daemon started. ${1 + SPECIALIST_AGENTS.length} agents registered. Dashboard: http://localhost:${PORT_DASHBOARD}`,
      })
      .catch(() => { /* non-fatal */ });

    log("INFO", "daemon", "Boot complete", {
      dashboardPort: PORT_DASHBOARD,
      apiPort: PORT_API,
      agents: 1 + SPECIALIST_AGENTS.length,
    });
  }

  async shutdown(signal = "SIGTERM"): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    log("INFO", "daemon", `Shutdown initiated (${signal})`);

    // Stop accepting new jobs
    this.scheduler?.stop();
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Send shutdown notification
    await this.notifier
      .send({
        level: "warning",
        title: "Clawdia Broker OFFLINE",
        body: `Daemon shutting down (${signal}). State saved.`,
      })
      .catch(() => { /* non-fatal */ });

    // Save final state
    this.state.destroy();

    // Stop risk engine
    this.risk.stop();

    // Disconnect bus
    await this.bus.disconnect();

    // Close HTTP servers
    await Promise.allSettled([
      new Promise<void>((r) => this.dashboardServer?.close(() => r())),
      new Promise<void>((r) => this.apiServer?.close(() => r())),
    ]);

    // Cleanup registry
    this.registry.destroy();

    log("INFO", "daemon", "Shutdown complete");
    process.exit(0);
  }

  // ─── ClawBus subscriptions ───

  private subscribeToAllChannels(): void {
    const channels: Array<Parameters<typeof this.bus.subscribe>[0]> = [
      "task.request",
      "task.result",
      "task.failed",
      "task.progress",
      "heartbeat",
      "escalation",
      "settlement.request",
      "settlement.complete",
      "registry.update",
      "risk.alert",
      "risk.budget.exceeded",
      "workflow.step.complete",
      "workflow.complete",
    ];

    for (const channel of channels) {
      this.bus.subscribe(channel, async (msg: ClawMessage) => {
        await this.onBusMessage(channel, msg);
      });
    }
  }

  private async onBusMessage(channel: string, msg: ClawMessage): Promise<void> {
    const summary = this.summarizeMessage(channel, msg);
    log("EVENT", channel, summary, { messageId: msg.id });

    // Track recent events for dashboard
    this.recentEvents.unshift({ ts: msg.timestamp, channel, summary });
    if (this.recentEvents.length > 100) this.recentEvents.pop();

    // Route to Telegram based on channel
    try {
      if (channel === "risk.alert") {
        await this.notifier.send({
          level: "critical",
          title: "Risk Alert",
          body: summary,
        });
      } else if (channel === "escalation") {
        const payload = msg.payload as { reason?: string; severity?: string };
        await this.notifier.send({
          level: payload.severity === "critical" ? "critical" : "warning",
          title: "Escalation Required",
          body: payload.reason ?? summary,
        });
      } else if (channel === "risk.budget.exceeded") {
        await this.notifier.send({
          level: "critical",
          title: "Budget Exceeded",
          body: summary,
        });
      } else if (channel === "settlement.complete") {
        const payload = msg.payload as { amount?: number; currency?: string };
        const amount = payload.amount ?? 0;
        if (amount >= 1) {
          await this.notifier.send({
            level: "info",
            title: "Settlement",
            body: `${amount} ${payload.currency ?? "USDC"} settled — ${summary}`,
          });
          this.state.addPnl({ brokeredUsdc: amount });
        }
      }
    } catch {
      // Notifier failures are non-fatal
    }
  }

  private summarizeMessage(channel: string, msg: ClawMessage): string {
    const p = msg.payload as Record<string, unknown>;
    switch (channel) {
      case "task.request":
        return `Contract ${String(p["contractId"] ?? "?").slice(0, 8)} — event: ${p["event"]} (${p["previousState"]} → ${p["newState"]})`;
      case "risk.alert":
        return `${p["type"]} on agent ${p["agent"]}`;
      case "escalation":
        return `severity=${p["severity"]}: ${p["reason"]}`;
      case "registry.update":
        return `${p["agentName"]} ${p["action"]}`;
      case "heartbeat":
        return `${p["agentName"]} alive`;
      case "workflow.step.complete":
        return `Workflow ${String(p["workflowId"] ?? "?").slice(0, 8)} step ${p["subtaskId"]} done`;
      default:
        return `sender=${msg.sender.name}`;
    }
  }

  // ─── Dashboard server (port 3000) ───

  private startDashboardServer(): void {
    this.dashboardServer = http.createServer((req, res) => {
      if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
        const html = this.renderDashboard();
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } else if (req.method === "GET" && req.url === "/api/status") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(this.getStatus(), null, 2));
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    this.dashboardServer.listen(PORT_DASHBOARD, () => {
      log("INFO", "dashboard", `Dashboard running on http://0.0.0.0:${PORT_DASHBOARD}`);
    });

    this.dashboardServer.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        log("WARN", "dashboard", `Port ${PORT_DASHBOARD} in use — dashboard skipped`);
      } else {
        log("ERROR", "dashboard", `Server error: ${err.message}`);
      }
    });
  }

  // ─── REST API server (port 3001) ───

  private startApiServer(): void {
    this.apiServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${PORT_API}`);

      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/agents") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(this.registry.list(), null, 2));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/contracts") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(this.contracts.list(), null, 2));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/scheduler") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(this.scheduler?.getJobs() ?? [], null, 2));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/broker") {
        this.handleBrokerRequest(req, res);
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    this.apiServer.listen(PORT_API, () => {
      log("INFO", "api", `REST API running on http://0.0.0.0:${PORT_API}`);
    });

    this.apiServer.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        log("WARN", "api", `Port ${PORT_API} in use — API skipped`);
      } else {
        log("ERROR", "api", `Server error: ${err.message}`);
      }
    });
  }

  private handleBrokerRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body) as {
          request?: string;
          budget?: number;
          quality_threshold?: number;
        };

        if (!parsed.request) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "request field required" }));
          return;
        }

        const budget = parsed.budget ?? 1.0;
        const qualityThreshold = parsed.quality_threshold ?? 0.70;

        log("INFO", "api", `Broker request received: "${parsed.request.slice(0, 80)}"`, {
          budget,
          qualityThreshold,
        });

        // Create a top-level broker contract
        const contract = this.contracts.create({
          requester: CLAWDIA_IDENTITY,
          provider: CLAWDIA_IDENTITY, // self-broker
          capability: "orchestration.job.broker",
          inputSchema: {},
          outputSchema: {},
          input: {
            request: parsed.request,
            total_budget_usdc: budget,
            quality_threshold: qualityThreshold,
          },
          payment: { amount: budget * 0.15, currency: "USDC" },
          sla: { deadlineMs: 300_000, maxRetries: 1 },
          verification: { method: "quality_score", minQualityScore: qualityThreshold },
        });

        // Drive through lifecycle asynchronously (non-blocking response)
        this.driveContractAsync(contract.id, parsed.request).catch((err: unknown) => {
          log("ERROR", "api", `Broker contract failed: ${err instanceof Error ? err.message : String(err)}`);
        });

        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            contractId: contract.id,
            status: "accepted",
            message: `Broker job created. Monitor at /api/contracts.`,
          }),
        );
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
  }

  private async driveContractAsync(contractId: string, request: string): Promise<void> {
    await this.contracts.transition(contractId, "OFFER", CLAWDIA_IDENTITY.name);
    await this.contracts.transition(contractId, "ACCEPT", CLAWDIA_IDENTITY.name);
    await this.contracts.transition(contractId, "FUND", CLAWDIA_IDENTITY.name);

    // Simulate broker execution
    const output = {
      request,
      status: "completed",
      message: "Broker job dispatched to specialist agents",
      workflow_id: `wf-${Date.now()}`,
      timestamp: new Date().toISOString(),
    };

    this.contracts.setOutput(contractId, output);
    await this.contracts.transition(contractId, "DELIVER", CLAWDIA_IDENTITY.name);
    await this.contracts.transition(contractId, "VERIFY", CLAWDIA_IDENTITY.name);
    await this.contracts.transition(contractId, "SETTLE", CLAWDIA_IDENTITY.name);

    this.state.addPnl({ settled: 1, marginUsdc: 0.15 });
  }

  // ─── Dashboard HTML ───

  private getStatus(): Record<string, unknown> {
    const stateData = this.state.get();
    const contractStats = this.contracts.stats();
    const registryStats = this.registry.stats();
    return {
      daemon: {
        uptime: process.uptime(),
        pid: process.pid,
        startedAt: stateData.daemonStartedAt,
        nodeVersion: process.version,
      },
      bus: { type: "InMemoryBus", connected: true },
      registry: registryStats,
      contracts: contractStats,
      scheduler: this.scheduler?.getJobs().map((j) => ({
        name: j.name,
        cron: j.cronExpr,
        lastRun: j.lastRun,
      })),
      pnl: stateData.pnl,
    };
  }

  private renderDashboard(): string {
    const status = this.getStatus();
    const pnl = status["pnl"] as Record<string, unknown>;
    const reg = status["registry"] as Record<string, number>;
    const contracts = status["contracts"] as Record<string, number>;
    const daemon = status["daemon"] as Record<string, unknown>;
    const uptimeStr = `${Math.floor((daemon["uptime"] as number) / 60)}m ${Math.floor((daemon["uptime"] as number) % 60)}s`;
    const schedulerJobs = (this.scheduler?.getJobs() ?? []) as Array<{
      name: string; cronExpr: string; description: string; lastRun?: string
    }>;

    const recentEventsHtml = this.recentEvents
      .slice(0, 20)
      .map((e) => `<tr><td>${e.ts.slice(11, 19)}</td><td><code>${e.channel}</code></td><td>${escapeHtml(e.summary)}</td></tr>`)
      .join("\n");

    const schedulerHtml = schedulerJobs
      .map((j) => `<tr><td>${escapeHtml(j.name)}</td><td><code>${j.cronExpr}</code></td><td>${escapeHtml(j.description.slice(0, 60))}</td><td>${j.lastRun ? j.lastRun.slice(11, 19) : "—"}</td></tr>`)
      .join("\n");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="30">
  <title>Clawdia Broker Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'SF Mono', 'Fira Code', monospace; background: #0d1117; color: #e6edf3; padding: 24px; }
    h1 { color: #58a6ff; font-size: 1.5rem; margin-bottom: 4px; }
    .subtitle { color: #8b949e; font-size: 0.85rem; margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; }
    .card h3 { color: #8b949e; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
    .card .value { font-size: 1.75rem; font-weight: 700; color: #e6edf3; }
    .card .sub { color: #8b949e; font-size: 0.8rem; margin-top: 4px; }
    .online { color: #3fb950; }
    .section { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    .section h2 { color: #58a6ff; font-size: 1rem; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    th { color: #8b949e; text-align: left; padding: 6px 8px; border-bottom: 1px solid #30363d; font-weight: 500; }
    td { padding: 6px 8px; border-bottom: 1px solid #21262d; }
    code { background: #21262d; padding: 1px 4px; border-radius: 3px; font-size: 0.75rem; }
    .badge-ok { color: #3fb950; } .badge-warn { color: #d29922; } .badge-err { color: #f85149; }
  </style>
</head>
<body>
  <h1>🦅 Clawdia Broker Dashboard</h1>
  <p class="subtitle">PID ${daemon["pid"]} · Uptime ${uptimeStr} · Node ${daemon["nodeVersion"]} · Auto-refresh 30s</p>

  <div class="grid">
    <div class="card">
      <h3>Agents Online</h3>
      <div class="value online">${reg["online"] ?? 0}</div>
      <div class="sub">${reg["offline"] ?? 0} offline · ${reg["busy"] ?? 0} busy</div>
    </div>
    <div class="card">
      <h3>Contracts Settled</h3>
      <div class="value">${pnl["contractsSettled"]}</div>
      <div class="sub">${pnl["contractsFailed"]} failed</div>
    </div>
    <div class="card">
      <h3>Margin Earned</h3>
      <div class="value">$${Number(pnl["marginEarnedUsdc"]).toFixed(4)}</div>
      <div class="sub">USDC · 15% on all jobs</div>
    </div>
    <div class="card">
      <h3>Total Brokered</h3>
      <div class="value">$${Number(pnl["totalBrokeredUsdc"]).toFixed(4)}</div>
      <div class="sub">USDC lifetime</div>
    </div>
    <div class="card">
      <h3>Active Contracts</h3>
      <div class="value">${(contracts["in_progress"] ?? 0) + (contracts["offered"] ?? 0)}</div>
      <div class="sub">${contracts["settled"] ?? 0} settled · ${contracts["cancelled"] ?? 0} cancelled</div>
    </div>
  </div>

  <div class="section">
    <h2>Scheduled Tasks</h2>
    <table>
      <thead><tr><th>Job</th><th>Schedule</th><th>Description</th><th>Last Run</th></tr></thead>
      <tbody>${schedulerHtml}</tbody>
    </table>
  </div>

  <div class="section">
    <h2>Recent Events</h2>
    <table>
      <thead><tr><th>Time</th><th>Channel</th><th>Summary</th></tr></thead>
      <tbody>${recentEventsHtml || '<tr><td colspan="3" style="color:#8b949e">No events yet</td></tr>'}</tbody>
    </table>
  </div>
</body>
</html>`;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────

const daemon = new BrokerDaemon();

process.on("SIGTERM", () => { void daemon.shutdown("SIGTERM"); });
process.on("SIGINT", () => { void daemon.shutdown("SIGINT"); });
process.on("uncaughtException", (err) => {
  console.error("[daemon] Uncaught exception:", err);
  void daemon.shutdown("uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  console.error("[daemon] Unhandled rejection:", reason);
});

daemon.boot().catch((err: unknown) => {
  console.error("[daemon] Fatal boot error:", err);
  process.exit(1);
});
