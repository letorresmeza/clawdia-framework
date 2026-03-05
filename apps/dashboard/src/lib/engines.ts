import { InMemoryBus, NatsBus, ContractEngine } from "@clawdia/core";
import type { IClawBus } from "@clawdia/core";
import { ServiceRegistry, AgentSpawner } from "@clawdia/orchestrator";
import { ReputationEngine, InMemoryEscrow, BillingEngine } from "@clawdia/economy";
import type { ClawChannel } from "@clawdia/types";

// In-memory runtime stub for dashboard (no Docker needed)
const inMemoryRuntime = {
  name: "in-memory" as const,
  async spawn() {
    return { id: "stub", name: "stub", runtime: "in-memory" };
  },
  async destroy() {},
  async exec() {
    return { stdout: "", stderr: "", exitCode: 0 };
  },
  async *logs(): AsyncIterable<string> {},
  async healthCheck() {
    return { alive: false, uptime: 0 };
  },
};

export const ALL_CHANNELS: ClawChannel[] = [
  "task.request",
  "task.result",
  "task.failed",
  "task.progress",
  "heartbeat",
  "escalation",
  "settlement.request",
  "settlement.complete",
  "registry.update",
  "registry.query",
  "risk.alert",
  "risk.budget.exceeded",
  "workflow.step.complete",
  "workflow.complete",
];

interface Engines {
  bus: IClawBus;
  registry: ServiceRegistry;
  spawner: AgentSpawner;
  contracts: ContractEngine;
  reputation: ReputationEngine;
  escrow: InMemoryEscrow;
  billing: BillingEngine;
}

// Use globalThis to survive Next.js hot reloads
const g = globalThis as typeof globalThis & { __clawdia_engines?: Engines; __clawdia_init?: Promise<Engines> };

export async function initEngines(): Promise<Engines> {
  if (g.__clawdia_engines) return g.__clawdia_engines;
  if (g.__clawdia_init) return g.__clawdia_init;

  g.__clawdia_init = (async () => {
    const natsUrl = process.env["CLAWBUS_URL"] ?? "nats://localhost:4222";
    const useNats = process.env["BUS_TYPE"] !== "in-memory";

    let bus: IClawBus;
    if (useNats) {
      bus = new NatsBus();
      try {
        await bus.connect(natsUrl);
        console.log(`[engines] Connected to NATS at ${natsUrl}`);
      } catch {
        console.warn("[engines] NATS unavailable, falling back to InMemoryBus");
        bus = new InMemoryBus();
        await bus.connect();
      }
    } else {
      bus = new InMemoryBus();
      await bus.connect();
      console.log("[engines] Using InMemoryBus");
    }

    const registry = new ServiceRegistry(bus, {
      healthCheckIntervalMs: 30_000,
      deregisterAfterMs: 120_000,
    });

    const spawner = new AgentSpawner(inMemoryRuntime, bus, {
      heartbeatIntervalMs: 2_147_483_647,
    });

    const contracts = new ContractEngine(bus);

    const reputation = new ReputationEngine(bus);
    const escrow = new InMemoryEscrow(bus);
    const billing = new BillingEngine(bus);

    // Start economy engines listening to bus events
    reputation.start();
    escrow.start();
    billing.start();

    const engines: Engines = { bus, registry, spawner, contracts, reputation, escrow, billing };
    g.__clawdia_engines = engines;
    return engines;
  })();

  return g.__clawdia_init;
}

/** Get engines — initializes lazily if needed */
export async function getEngines(): Promise<Engines> {
  return g.__clawdia_engines ?? initEngines();
}
