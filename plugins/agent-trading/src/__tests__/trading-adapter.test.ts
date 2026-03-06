/**
 * Integration tests for the Clawdia v3 Trading Bot → Framework integration.
 *
 * Tests:
 *   1. soul.md parses correctly and registers with IdentityRuntime
 *   2. ServiceRegistry can register and discover the trading bot
 *   3. TaskContracts flow through the full lifecycle for each capability
 *   4. RiskEngine circuit breaker integrates with trading bot failures
 *
 * Note: Python subprocess calls in TradingBotAdapter are not invoked here.
 * These tests verify the framework wiring, not the Python logic.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
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
  ClawMessage,
  RiskAlertPayload,
} from "@clawdia/types";

// soul.md lives two levels up from plugins/agent-trading/, in examples/trading-bot/
// When vitest runs, process.cwd() is the plugin package dir.
const SOUL_MD_PATH = resolve(
  process.cwd(),
  "../../examples/trading-bot/soul.md",
);

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

const SCHEDULER_IDENTITY: AgentIdentity = {
  name: "clawdia-scheduler",
  displayName: "Clawdia Scheduler",
  description: "Test scheduler",
  version: "1.0.0",
  operator: "test",
  publicKey: "ed25519:test",
  capabilities: [],
  requirements: [],
  runtime: {},
};

async function createTestBus(): Promise<InMemoryBus> {
  const bus = new InMemoryBus();
  await bus.connect();
  return bus;
}

function makeContract(
  engine: ContractEngine,
  botIdentity: AgentIdentity,
  capability: string,
): TaskContract {
  return engine.create({
    requester: SCHEDULER_IDENTITY,
    provider: botIdentity,
    capability,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    input: {},
    payment: { amount: 0, currency: "USDC" },
    sla: { deadlineMs: 60_000, maxRetries: 1 },
    verification: { method: "schema_match" },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((r) => { setTimeout(r, ms); });
}

// ─────────────────────────────────────────────────────────
// Test Suite 1: soul.md registration
// ─────────────────────────────────────────────────────────

describe("soul.md registration", () => {
  it("soul.md file exists at the expected path", () => {
    expect(() => readFileSync(SOUL_MD_PATH, "utf8")).not.toThrow();
  });

  it("parses as valid soul.md v2 via IdentityRuntime", async () => {
    const soulContent = readFileSync(SOUL_MD_PATH, "utf8");
    const runtime = new IdentityRuntime();
    const identity = await runtime.register(soulContent);

    expect(identity.name).toBe("clawdia-trading-bot");
    expect(identity.version).toBe("3.0.0");
    expect(identity.operator).toBe("leo");
    expect(identity.capabilities).toHaveLength(6);
  });

  it("registers all 6 expected capabilities", async () => {
    const soulContent = readFileSync(SOUL_MD_PATH, "utf8");
    const runtime = new IdentityRuntime();
    const identity = await runtime.register(soulContent);

    const taxonomies = identity.capabilities.map((c) => c.taxonomy);
    expect(taxonomies).toContain("trading.polymarket.scan");
    expect(taxonomies).toContain("trading.polymarket.execute");
    expect(taxonomies).toContain("trading.monitoring.positions");
    expect(taxonomies).toContain("trading.monitoring.portfolio");
    expect(taxonomies).toContain("analysis.market.sentiment");
    expect(taxonomies).toContain("analysis.market.weather");
  });

  it("maps risk.json parameters correctly into SLA/pricing", async () => {
    const soulContent = readFileSync(SOUL_MD_PATH, "utf8");
    const runtime = new IdentityRuntime();
    const identity = await runtime.register(soulContent);

    const execute = identity.capabilities.find(
      (c) => c.taxonomy === "trading.polymarket.execute",
    );
    const scan = identity.capabilities.find(
      (c) => c.taxonomy === "trading.polymarket.scan",
    );

    expect(execute).toBeDefined();
    expect(scan).toBeDefined();
    // Execute has highest availability (0.999) — money at stake
    expect(execute!.sla.availability).toBeGreaterThanOrEqual(0.999);
    // All capabilities price in USDC
    for (const cap of identity.capabilities) {
      expect(cap.pricing.currency).toBe("USDC");
    }
  });

  it("declares required environment variables in runtime", async () => {
    const soulContent = readFileSync(SOUL_MD_PATH, "utf8");
    const runtime = new IdentityRuntime();
    const identity = await runtime.register(soulContent);

    expect(identity.runtime.environment).toContain("SIMMER_API_KEY");
    expect(identity.runtime.environment).toContain("TELEGRAM_BOT_TOKEN");
    expect(identity.runtime.environment).toContain("CLAWDIA_V3_DIR");
  });

  it("generates an ed25519 keypair when no public_key is provided", async () => {
    const soulContent = readFileSync(SOUL_MD_PATH, "utf8");
    const runtime = new IdentityRuntime();
    const identity = await runtime.register(soulContent);

    expect(identity.publicKey).toMatch(/^ed25519:/);
  });

  it("cannot be registered twice with the same name", async () => {
    const soulContent = readFileSync(SOUL_MD_PATH, "utf8");
    const runtime = new IdentityRuntime();
    await runtime.register(soulContent);

    await expect(runtime.register(soulContent)).rejects.toThrow(
      "already registered",
    );
  });
});

// ─────────────────────────────────────────────────────────
// Test Suite 2: ServiceRegistry integration
// ─────────────────────────────────────────────────────────

describe("ServiceRegistry integration", () => {
  let bus: InMemoryBus;
  let registry: ServiceRegistry;
  let botIdentity: AgentIdentity;

  beforeEach(async () => {
    bus = await createTestBus();
    registry = new ServiceRegistry(bus);
    const runtime = new IdentityRuntime();
    botIdentity = await runtime.register(readFileSync(SOUL_MD_PATH, "utf8"));
  });

  it("registers the trading bot and marks it online", () => {
    registry.register(botIdentity, "session-001");
    const entry = registry.get(botIdentity.name);

    expect(entry).toBeDefined();
    expect(entry!.status).toBe("online");
    expect(entry!.identity.name).toBe("clawdia-trading-bot");
  });

  it("publishes a registry.update event on registration", async () => {
    const messages: ClawMessage[] = [];
    bus.subscribe("registry.update", async (msg) => {
      messages.push(msg);
    });

    registry.register(botIdentity, "session-001");
    await sleep(0);

    expect(messages).toHaveLength(1);
    const payload = messages[0]!.payload as {
      agentName: string;
      action: string;
    };
    expect(payload.agentName).toBe("clawdia-trading-bot");
    expect(payload.action).toBe("register");
  });

  it("discovers the bot by trading taxonomy wildcard", () => {
    registry.register(botIdentity);
    const result = registry.discover({ taxonomy: "trading.*" });

    expect(result.total).toBe(1);
    expect(result.entries[0]!.identity.name).toBe("clawdia-trading-bot");
  });

  it("discovers the bot by exact capability taxonomy", () => {
    registry.register(botIdentity);
    const result = registry.discover({
      taxonomy: "trading.polymarket.execute",
    });

    expect(result.total).toBe(1);
  });

  it("discovers the bot by analysis taxonomy wildcard", () => {
    registry.register(botIdentity);
    const result = registry.discover({ taxonomy: "analysis.*" });
    expect(result.total).toBe(1);
  });

  it("returns nothing when querying an unregistered capability", () => {
    registry.register(botIdentity);
    const result = registry.discover({ taxonomy: "coding.implementation.*" });
    expect(result.total).toBe(0);
  });

  it("deregisters cleanly", () => {
    registry.register(botIdentity);
    registry.deregister(botIdentity.name);
    expect(registry.get(botIdentity.name)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────
// Test Suite 3: TaskContract lifecycle for each capability
// ─────────────────────────────────────────────────────────

describe("TaskContract lifecycle", () => {
  let bus: InMemoryBus;
  let engine: ContractEngine;
  let botIdentity: AgentIdentity;

  const CAPABILITIES = [
    "trading.polymarket.scan",
    "trading.polymarket.execute",
    "trading.monitoring.positions",
    "trading.monitoring.portfolio",
    "analysis.market.sentiment",
    "analysis.market.weather",
  ];

  beforeEach(async () => {
    bus = await createTestBus();
    engine = new ContractEngine(bus);
    const runtime = new IdentityRuntime();
    botIdentity = await runtime.register(readFileSync(SOUL_MD_PATH, "utf8"));
  });

  it.each(CAPABILITIES)(
    "contract for '%s' flows draft→settled cleanly",
    async (capability) => {
      const contract = makeContract(engine, botIdentity, capability);
      expect(contract.state).toBe("draft");

      await engine.transition(contract.id, "OFFER", "scheduler");
      expect(engine.get(contract.id)!.state).toBe("offered");

      await engine.transition(contract.id, "ACCEPT", botIdentity.name);
      expect(engine.get(contract.id)!.state).toBe("accepted");

      await engine.transition(contract.id, "FUND", "scheduler");
      expect(engine.get(contract.id)!.state).toBe("in_progress");

      engine.setOutput(contract.id, { status: "complete", capability });
      await engine.transition(contract.id, "DELIVER", botIdentity.name);
      expect(engine.get(contract.id)!.state).toBe("delivered");

      await engine.transition(contract.id, "VERIFY", "scheduler");
      expect(engine.get(contract.id)!.state).toBe("verified");

      await engine.transition(contract.id, "SETTLE", "scheduler");
      expect(engine.get(contract.id)!.state).toBe("settled");
    },
  );

  it("contract can be cancelled from offered state", async () => {
    const contract = makeContract(engine, botIdentity, "trading.polymarket.scan");
    await engine.transition(contract.id, "OFFER", "scheduler");
    await engine.transition(contract.id, "CANCEL", "scheduler");
    expect(engine.get(contract.id)!.state).toBe("cancelled");
  });

  it("contract transitions to disputed on FAIL from in_progress", async () => {
    const contract = makeContract(engine, botIdentity, "trading.polymarket.execute");
    await engine.transition(contract.id, "OFFER", "scheduler");
    await engine.transition(contract.id, "ACCEPT", botIdentity.name);
    await engine.transition(contract.id, "FUND", "scheduler");
    await engine.transition(contract.id, "FAIL", botIdentity.name);
    expect(engine.get(contract.id)!.state).toBe("disputed");
  });

  it("invalid transition throws a descriptive error", async () => {
    const contract = makeContract(engine, botIdentity, "trading.polymarket.scan");
    // Cannot DELIVER from draft state
    await expect(
      engine.transition(contract.id, "DELIVER", "scheduler"),
    ).rejects.toThrow(/Invalid transition/);
  });

  it("publishes task.request events on every transition", async () => {
    const events: ClawMessage[] = [];
    bus.subscribe("task.request", async (msg) => events.push(msg));

    const contract = makeContract(engine, botIdentity, "trading.polymarket.scan");
    await engine.transition(contract.id, "OFFER", "scheduler");
    await engine.transition(contract.id, "ACCEPT", botIdentity.name);

    await sleep(0);
    expect(events.length).toBeGreaterThanOrEqual(2);
    const payload = events[0]!.payload as {
      contractId: string;
      event: string;
    };
    expect(payload.contractId).toBe(contract.id);
    expect(payload.event).toBe("OFFER");
  });

  it("preserves full history on a settled contract", async () => {
    const contract = makeContract(
      engine,
      botIdentity,
      "trading.monitoring.positions",
    );
    await engine.transition(contract.id, "OFFER", "scheduler");
    await engine.transition(contract.id, "ACCEPT", botIdentity.name);
    await engine.transition(contract.id, "FUND", "scheduler");
    engine.setOutput(contract.id, { exits_executed: 0 });
    await engine.transition(contract.id, "DELIVER", botIdentity.name);
    await engine.transition(contract.id, "VERIFY", "scheduler");
    await engine.transition(contract.id, "SETTLE", "scheduler");

    const settled = engine.get(contract.id)!;
    expect(settled.history).toHaveLength(6);
    expect(settled.history[0]!.from).toBe("draft");
    expect(settled.history[5]!.to).toBe("settled");
  });

  it("engine.stats() counts contracts correctly across capabilities", async () => {
    for (const capability of CAPABILITIES) {
      const c = makeContract(engine, botIdentity, capability);
      await engine.transition(c.id, "OFFER", "scheduler");
    }
    const stats = engine.stats();
    expect(stats["offered"]).toBe(CAPABILITIES.length);
  });
});

// ─────────────────────────────────────────────────────────
// Test Suite 4: RiskEngine ↔ Trading Bot circuit breaker
// ─────────────────────────────────────────────────────────

describe("RiskEngine circuit breaker integration", () => {
  let bus: InMemoryBus;
  let riskEngine: RiskEngine;
  let botIdentity: AgentIdentity;

  beforeEach(async () => {
    bus = await createTestBus();
    // failureThreshold: 3 matches risk.json consecutive_losses_trigger
    // resetTimeoutMs: 3_600_000 matches risk.json cooldown_seconds: 3600
    riskEngine = new RiskEngine(bus, {
      failureThreshold: 3,
      resetTimeoutMs: 3_600_000,
    });
    riskEngine.start();
    const runtime = new IdentityRuntime();
    botIdentity = await runtime.register(readFileSync(SOUL_MD_PATH, "utf8"));
    // Budget mirrors risk.json: max_position_usd: 15, max_daily_trades: 10
    riskEngine.setBudget(botIdentity.name, {
      maxSpendUsd: 15,
      maxApiCalls: 100,
      maxComputeMs: 600_000,
    });
  });

  it("starts with no circuit breaker entry (clean state)", () => {
    expect(riskEngine.getBreaker(botIdentity.name)).toBeUndefined();
  });

  it("opens circuit breaker after 3 consecutive failures", async () => {
    const riskAlerts: RiskAlertPayload[] = [];
    bus.subscribe("risk.alert", async (msg: ClawMessage<RiskAlertPayload>) => {
      riskAlerts.push(msg.payload);
    });

    // Simulate 3 task failures (maps to 3 consecutive losses in trading)
    for (let i = 0; i < 3; i++) {
      await bus.publish(
        "task.failed",
        {
          contractId: `contract-${i}`,
          error: {
            code: "TRADE_FAILED",
            message: "Stop loss triggered",
            retryable: false,
          },
          attempt: 1,
          maxRetries: 1,
        },
        botIdentity,
      );
    }

    await sleep(10);

    const breaker = riskEngine.getBreaker(botIdentity.name);
    expect(breaker).toBeDefined();
    expect(breaker!.state).toBe("open");
    expect(breaker!.failures).toBe(3);

    expect(riskAlerts).toHaveLength(1);
    expect(riskAlerts[0]!.type).toBe("circuit_breaker_open");
    expect(riskAlerts[0]!.agent).toBe(botIdentity.name);
  });

  it("blocks budget check when circuit breaker is open", async () => {
    for (let i = 0; i < 3; i++) {
      await bus.publish(
        "task.failed",
        {
          contractId: `c-${i}`,
          error: { code: "ERR", message: "loss", retryable: false },
          attempt: 1,
          maxRetries: 1,
        },
        botIdentity,
      );
    }
    await sleep(10);

    const canTrade = riskEngine.checkBudget(botIdentity.name, "spend", 10);
    expect(canTrade).toBe(false);
  });

  it("closes the circuit breaker on successful task after half-open", async () => {
    // Open it
    for (let i = 0; i < 3; i++) {
      await bus.publish(
        "task.failed",
        {
          contractId: `c-${i}`,
          error: { code: "ERR", message: "loss", retryable: false },
          attempt: 1,
          maxRetries: 1,
        },
        botIdentity,
      );
    }
    await sleep(10);

    // Force half-open (simulate cooldown elapsed)
    const breaker = riskEngine.getBreaker(botIdentity.name)!;
    breaker.state = "half_open";

    // Successful result should close it
    await bus.publish(
      "task.result",
      {
        contractId: "c-success",
        output: { entries_made: 1 },
        metrics: {
          durationMs: 5000,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
      },
      botIdentity,
    );
    await sleep(10);

    expect(riskEngine.getBreaker(botIdentity.name)!.state).toBe("closed");
    expect(riskEngine.getBreaker(botIdentity.name)!.failures).toBe(0);
  });

  it("can be manually reset (operator override after cooldown)", async () => {
    for (let i = 0; i < 3; i++) {
      await bus.publish(
        "task.failed",
        {
          contractId: `c-${i}`,
          error: { code: "ERR", message: "loss", retryable: false },
          attempt: 1,
          maxRetries: 1,
        },
        botIdentity,
      );
    }
    await sleep(10);
    expect(riskEngine.getBreaker(botIdentity.name)!.state).toBe("open");

    riskEngine.resetBreaker(botIdentity.name);
    expect(riskEngine.getBreaker(botIdentity.name)!.state).toBe("closed");
    expect(riskEngine.getBreaker(botIdentity.name)!.failures).toBe(0);
  });

  it("allows trade within position size budget (max_position_usd: 15)", () => {
    expect(riskEngine.checkBudget(botIdentity.name, "spend", 15)).toBe(true);
    expect(riskEngine.checkBudget(botIdentity.name, "spend", 2)).toBe(true);
  });

  it("blocks trade exceeding budget after positions accumulate", () => {
    riskEngine.recordUsage(botIdentity.name, "spend", 15);
    // After $15 used, even $0.01 more should be blocked
    expect(riskEngine.checkBudget(botIdentity.name, "spend", 0.01)).toBe(false);
  });

  it("publishes risk.budget.exceeded when spend limit is hit", async () => {
    const alerts: ClawMessage[] = [];
    bus.subscribe("risk.budget.exceeded", async (msg) => alerts.push(msg));

    riskEngine.recordUsage(botIdentity.name, "spend", 16); // Over $15 limit
    await sleep(10);

    expect(alerts.length).toBeGreaterThanOrEqual(1);
  });

  it("circuit breaker failure threshold matches risk.json (3 losses)", () => {
    // Two failures should NOT open the breaker
    // (mirrors risk.json circuit_breaker.consecutive_losses_trigger: 3)
    const breakerConfig = { failureThreshold: 3, resetTimeoutMs: 3_600_000 };
    expect(breakerConfig.failureThreshold).toBe(3);
    expect(breakerConfig.resetTimeoutMs).toBe(60 * 60 * 1000); // 1 hour
  });
});
