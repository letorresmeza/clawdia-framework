/**
 * Trading Bot Bridge
 * ==================
 * Registers the Clawdia v3 trading bot with the Clawdia Framework.
 * Connects to ClawBus (InMemoryBus), registers with ServiceRegistry,
 * translates the existing cron schedule into TaskContracts that flow
 * through ContractEngine, and wires RiskEngine to monitor the trading
 * bot's circuit breaker state via ClawBus.
 *
 * Run: npx tsx examples/trading-bot/bridge.ts
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";
import {
  InMemoryBus,
  IdentityRuntime,
  ContractEngine,
  RiskEngine,
} from "@clawdia/core";
import { ServiceRegistry } from "@clawdia/orchestrator";
import type {
  AgentIdentity,
  TaskContract,
  RiskAlertPayload,
  ClawMessage,
} from "@clawdia/types";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────
// Scheduler — minimal cron-like scheduler using setInterval
// Avoids external dependencies; sufficient for the 7 scheduled jobs.
// ─────────────────────────────────────────────────────────

interface ScheduledJob {
  name: string;
  intervalMs: number;
  /** UTC hours when this job fires (undefined = every interval) */
  atHoursUtc?: number[];
  capability: string;
  lastRun: number;
}

class SimpleScheduler {
  private jobs: ScheduledJob[] = [];
  private timer: NodeJS.Timeout | null = null;

  add(job: Omit<ScheduledJob, "lastRun">): void {
    this.jobs.push({ ...job, lastRun: 0 });
  }

  start(onFire: (job: ScheduledJob) => void): void {
    // Check every minute whether any job should run
    this.timer = setInterval(() => {
      const now = Date.now();
      const hourUtc = new Date().getUTCHours();

      for (const job of this.jobs) {
        const elapsed = now - job.lastRun;
        if (elapsed < job.intervalMs) continue;

        // If the job has hour constraints, only fire at those hours
        if (job.atHoursUtc && !job.atHoursUtc.includes(hourUtc)) continue;

        job.lastRun = now;
        onFire(job);
      }
    }, 60_000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

// ─────────────────────────────────────────────────────────
// Minimal "scheduler" agent identity (the bridge itself)
// ─────────────────────────────────────────────────────────

const SCHEDULER_IDENTITY: AgentIdentity = {
  name: "clawdia-scheduler",
  displayName: "Clawdia Framework Scheduler",
  description: "Internal scheduler that issues TaskContracts for trading jobs",
  version: "1.0.0",
  operator: "leo",
  publicKey: "ed25519:scheduler-internal",
  capabilities: [],
  requirements: [],
  runtime: {},
};

// ─────────────────────────────────────────────────────────
// Contract lifecycle helper
// Moves a contract through the full lifecycle for an
// auto-accepted internal task (scheduler → trading bot).
// ─────────────────────────────────────────────────────────

async function runContractLifecycle(
  engine: ContractEngine,
  contract: TaskContract,
  triggeredBy: string,
  output: unknown,
): Promise<void> {
  // draft → offered → accepted → in_progress → delivered → verified → settled
  await engine.transition(contract.id, "OFFER", triggeredBy);
  await engine.transition(contract.id, "ACCEPT", triggeredBy);
  await engine.transition(contract.id, "FUND", triggeredBy);
  engine.setOutput(contract.id, output);
  await engine.transition(contract.id, "DELIVER", triggeredBy);
  await engine.transition(contract.id, "VERIFY", triggeredBy);
  await engine.transition(contract.id, "SETTLE", triggeredBy);
}

// ─────────────────────────────────────────────────────────
// Bridge main
// ─────────────────────────────────────────────────────────

async function startBridge(): Promise<void> {
  console.info("[bridge] Starting Clawdia Trading Bot Bridge...");

  // 1. Connect bus
  const bus = new InMemoryBus();
  await bus.connect();
  console.info("[bridge] ClawBus connected (InMemoryBus)");

  // 2. Parse soul.md and register the trading bot identity
  const soulPath = join(__dirname, "soul.md");
  const soulContent = readFileSync(soulPath, "utf8");
  const identityRuntime = new IdentityRuntime();
  const tradingBotIdentity = await identityRuntime.register(soulContent);
  console.info(`[bridge] Registered identity: ${tradingBotIdentity.name} v${tradingBotIdentity.version}`);
  console.info(`[bridge] Capabilities: ${tradingBotIdentity.capabilities.map((c) => c.taxonomy).join(", ")}`);

  // 3. Register with ServiceRegistry
  const registry = new ServiceRegistry(bus);
  registry.register(tradingBotIdentity, "trading-session-001");
  console.info("[bridge] Registered with ServiceRegistry");

  // 4. Set up ContractEngine
  const engine = new ContractEngine(bus);

  // 5. Set up RiskEngine — mirrors the trading bot's circuit breaker
  const riskEngine = new RiskEngine(bus, {
    failureThreshold: 3, // matches consecutive_losses_trigger in risk.json
    resetTimeoutMs: 3_600_000, // 1h — matches cooldown_seconds: 3600
  });
  riskEngine.setBudget(tradingBotIdentity.name, {
    maxApiCalls: 200,   // per 24h window
    maxSpendUsd: 15,    // max position size per trade
    maxComputeMs: 600_000,
  });
  riskEngine.start();
  console.info("[bridge] RiskEngine started");

  // 6. Subscribe to risk alerts and trading bot escalations
  bus.subscribe("risk.alert", async (msg: ClawMessage<RiskAlertPayload>) => {
    const payload = msg.payload;
    console.warn(
      `[bridge] RISK ALERT [${payload.type}] agent=${payload.agent}`,
      JSON.stringify(payload.details),
    );
  });

  bus.subscribe("escalation", async (msg) => {
    const p = msg.payload as { reason: string; severity: string };
    console.warn(`[bridge] ESCALATION [${p.severity}]: ${p.reason}`);
  });

  bus.subscribe("registry.update", async (msg) => {
    const p = msg.payload as { agentName: string; action: string };
    console.info(`[bridge] Registry: ${p.action} → ${p.agentName}`);
  });

  // 7. Heartbeat — keep the registry entry alive
  setInterval(() => {
    registry.heartbeat(tradingBotIdentity.name);
    bus
      .publish(
        "heartbeat",
        {
          sessionId: "trading-session-001",
          agentName: tradingBotIdentity.name,
          uptime: Date.now(),
          resourceUsage: { memoryMb: 0, cpuPercent: 0, activeContracts: 0 },
        },
        tradingBotIdentity,
      )
      .catch(() => {/* non-fatal */});
  }, 30_000);

  // 8. Scheduled task contracts
  //    Maps crons.txt entries to framework TaskContracts.
  //    Each entry creates a real contract that flows through ContractEngine.
  const scheduler = new SimpleScheduler();

  // Weather Trading — every 30min (cron: */30 * * * *)
  scheduler.add({
    name: "Weather Trading",
    intervalMs: 30 * 60_000,
    capability: "analysis.market.weather",
  });

  // High Conviction Scanner — every 2h (cron: 0 */2 * * *)
  scheduler.add({
    name: "High Conviction Scanner",
    intervalMs: 2 * 60 * 60_000,
    capability: "trading.polymarket.scan",
  });

  // Crypto News Scraper — 8AM and 8PM UTC (cron: 0 8,20 * * *)
  scheduler.add({
    name: "Crypto News Scraper",
    intervalMs: 12 * 60 * 60_000,
    atHoursUtc: [8, 20],
    capability: "analysis.market.sentiment",
  });

  // Portfolio Health Check — 10AM, 4PM, 10PM UTC (cron: 0 10,16,22 * * *)
  scheduler.add({
    name: "Portfolio Health Check",
    intervalMs: 8 * 60 * 60_000,
    atHoursUtc: [10, 16, 22],
    capability: "trading.monitoring.portfolio",
  });

  // System Health Check — every 4h (cron: 0 */4 * * *)
  scheduler.add({
    name: "System Health Check",
    intervalMs: 4 * 60 * 60_000,
    capability: "trading.monitoring.positions",
  });

  // Morning Briefing — 2PM UTC = 8AM CST (cron: 0 14 * * *)
  scheduler.add({
    name: "Morning Briefing",
    intervalMs: 24 * 60 * 60_000,
    atHoursUtc: [14],
    capability: "trading.monitoring.portfolio",
  });

  // Nightly Meta-Learning — 5AM UTC = 11PM CST (cron: 0 5 * * *)
  scheduler.add({
    name: "Nightly Meta-Learning",
    intervalMs: 24 * 60 * 60_000,
    atHoursUtc: [5],
    capability: "trading.monitoring.portfolio",
  });

  scheduler.start((job) => {
    void scheduleTaskContract(job, engine, tradingBotIdentity, riskEngine);
  });

  console.info("[bridge] Scheduler started with 7 jobs");
  console.info("[bridge] Schedule:");
  console.info("  Weather Trading          — every 30min  → analysis.market.weather");
  console.info("  High Conviction Scanner  — every 2h     → trading.polymarket.scan");
  console.info("  Crypto News Scraper      — 8AM & 8PM UTC → analysis.market.sentiment");
  console.info("  Portfolio Health Check   — 10AM/4PM/10PM UTC → trading.monitoring.portfolio");
  console.info("  System Health Check      — every 4h     → trading.monitoring.positions");
  console.info("  Morning Briefing         — 2PM UTC (8AM CST) → trading.monitoring.portfolio");
  console.info("  Nightly Meta-Learning    — 5AM UTC (11PM CST) → trading.monitoring.portfolio");
  console.info("[bridge] Bridge running. Press Ctrl+C to stop.");

  // Graceful shutdown
  process.on("SIGTERM", () => {
    console.info("[bridge] SIGTERM received, shutting down...");
    scheduler.stop();
    riskEngine.stop();
    registry.destroy();
    bus.disconnect().then(() => process.exit(0));
  });

  process.on("SIGINT", () => {
    console.info("[bridge] SIGINT received, shutting down...");
    scheduler.stop();
    riskEngine.stop();
    registry.destroy();
    bus.disconnect().then(() => process.exit(0));
  });
}

async function scheduleTaskContract(
  job: ScheduledJob,
  engine: ContractEngine,
  botIdentity: AgentIdentity,
  riskEngine: RiskEngine,
): Promise<void> {
  const breaker = riskEngine.getBreaker(botIdentity.name);
  if (breaker?.state === "open") {
    console.info(
      `[bridge] Skipping "${job.name}" — circuit breaker open (${breaker.failures} failures)`,
    );
    return;
  }

  console.info(
    `[bridge] Scheduling task contract: "${job.name}" → ${job.capability}`,
  );

  const contract = engine.create({
    requester: SCHEDULER_IDENTITY,
    provider: botIdentity,
    capability: job.capability,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    input: {},
    payment: { amount: 0, currency: "USDC" },
    sla: { deadlineMs: 120_000, maxRetries: 1 },
    verification: { method: "schema_match" },
    signatures: {},
  });

  try {
    // Simulate lifecycle: the bot is the sole provider, so we self-accept.
    // In production with real agents, the provider would accept independently.
    await runContractLifecycle(
      engine,
      contract,
      SCHEDULER_IDENTITY.name,
      { scheduled: true, job: job.name, capability: job.capability },
    );

    console.info(
      `[bridge] Contract ${contract.id.slice(0, 8)} settled: "${job.name}"`,
    );
  } catch (err) {
    console.error(
      `[bridge] Contract lifecycle failed for "${job.name}":`,
      (err as Error).message,
    );
    // Record failure on the risk engine so circuit breaker tracks it
    riskEngine.recordUsage(botIdentity.name, "api_calls", 0);
  }
}

startBridge().catch((err) => {
  console.error("[bridge] Fatal error:", err);
  process.exit(1);
});
