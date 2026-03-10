import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryBus } from "@clawdia/core";
import type { AgentIdentity, TaskContract } from "@clawdia/types";
import { ReputationEngine } from "../reputation/reputation-engine.js";

function createMockIdentity(name: string): AgentIdentity {
  return {
    name,
    displayName: name.replace(/-/g, " "),
    description: `Mock agent ${name}`,
    version: "1.0.0",
    operator: "test-operator",
    publicKey: `ed25519:mock-key-${name}`,
    capabilities: [
      {
        taxonomy: "test.capability",
        description: "A test capability",
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        sla: { maxLatencyMs: 5000, availability: 0.99 },
        pricing: { model: "per_request" as const, amount: 1.0, currency: "USDC" },
      },
    ],
    requirements: [],
    runtime: { model: "test-model" },
  };
}

function makeContract(
  requester: AgentIdentity,
  provider: AgentIdentity,
  overrides?: Partial<TaskContract>,
): TaskContract {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    state: "settled",
    requester,
    provider,
    capability: "test.capability",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    payment: { amount: 10, currency: "USDC" },
    sla: { deadlineMs: 60_000, maxRetries: 2 },
    verification: { method: "schema_match" },
    signatures: {},
    createdAt: now,
    updatedAt: now,
    history: [],
    ...overrides,
  };
}

describe("ReputationEngine", () => {
  let bus: InMemoryBus;
  let engine: ReputationEngine;

  beforeEach(async () => {
    bus = new InMemoryBus();
    await bus.connect();
    engine = new ReputationEngine(bus);
  });

  describe("initAgent", () => {
    it("creates a record with default 0.5 scores", () => {
      const record = engine.initAgent("agent-1");
      expect(record.agentName).toBe("agent-1");
      expect(record.overallScore).toBe(0.5);
      expect(record.dimensions.reliability).toBe(0.5);
      expect(record.dimensions.quality).toBe(0.5);
      expect(record.dimensions.speed).toBe(0.5);
      expect(record.dimensions.costEfficiency).toBe(0.5);
      expect(record.contractsCompleted).toBe(0);
      expect(record.contractsFailed).toBe(0);
      expect(record.stakedAmount).toBe(0);
    });

    it("accepts a custom stake amount", () => {
      const record = engine.initAgent("agent-1", 50);
      expect(record.stakedAmount).toBe(50);
    });
  });

  describe("updateReputation", () => {
    it("adjusts dimensional scores", () => {
      engine.initAgent("agent-1");
      engine.updateReputation("agent-1", "contract-1", { reliability: 1.0 });
      const record = engine.getRecord("agent-1")!;
      expect(record.dimensions.reliability).toBeGreaterThan(0.5);
    });

    it("clamps scores to [0, 1]", () => {
      engine.initAgent("agent-1");
      // Apply extreme positive
      for (let i = 0; i < 20; i++) {
        engine.updateReputation("agent-1", `c-${i}`, { quality: 1.0 });
      }
      const record = engine.getRecord("agent-1")!;
      expect(record.dimensions.quality).toBeLessThanOrEqual(1.0);
      expect(record.dimensions.quality).toBeGreaterThanOrEqual(0);
    });

    it("records history events", () => {
      engine.initAgent("agent-1");
      engine.updateReputation("agent-1", "c-1", { reliability: 0.5, speed: -0.2 });
      const record = engine.getRecord("agent-1")!;
      expect(record.history).toHaveLength(2);
      expect(record.history[0]!.dimension).toBe("reliability");
      expect(record.history[1]!.dimension).toBe("speed");
    });

    it("auto-initializes agent if not registered", () => {
      engine.updateReputation("new-agent", "c-1", { reliability: 1.0 });
      const record = engine.getRecord("new-agent");
      expect(record).toBeDefined();
    });

    it("recalculates overall score as average of dimensions", () => {
      engine.initAgent("agent-1");
      engine.updateReputation("agent-1", "c-1", {
        reliability: 1.0,
        quality: 1.0,
        speed: 1.0,
        costEfficiency: 1.0,
      });
      const record = engine.getRecord("agent-1")!;
      // All dimensions were pushed up from 0.5
      expect(record.overallScore).toBeGreaterThan(0.5);
      // Overall should equal average of 4 dimensions
      const dims = record.dimensions;
      const expectedAvg = (dims.reliability + dims.quality + dims.speed + dims.costEfficiency) / 4;
      expect(record.overallScore).toBeCloseTo(expectedAvg, 5);
    });
  });

  describe("recordSettledContract", () => {
    it("updates both agents' reputation on settled contract", () => {
      const requester = createMockIdentity("requester");
      const provider = createMockIdentity("provider");
      engine.initAgent("requester");
      engine.initAgent("provider");

      const contract = makeContract(requester, provider);
      engine.recordSettledContract(contract);

      const providerRec = engine.getRecord("provider")!;
      expect(providerRec.contractsCompleted).toBe(1);
      expect(providerRec.dimensions.reliability).toBeGreaterThan(0.5);

      const requesterRec = engine.getRecord("requester")!;
      expect(requesterRec.dimensions.reliability).toBeGreaterThan(0.5);
    });

    it("ignores contracts without a provider", () => {
      const requester = createMockIdentity("requester");
      const contract = makeContract(requester, createMockIdentity("provider"));
      contract.provider = undefined;
      engine.recordSettledContract(contract);
      // Should not throw or create records
      expect(engine.listRecords()).toHaveLength(0);
    });
  });

  describe("recordFailedContract", () => {
    it("penalizes provider reliability, increments failures, and slashes stake", () => {
      const provider = createMockIdentity("provider");
      engine.initAgent("provider", 20);
      const contract = makeContract(createMockIdentity("requester"), provider);
      engine.recordFailedContract(contract);

      const rec = engine.getRecord("provider")!;
      expect(rec.contractsFailed).toBe(1);
      expect(rec.dimensions.reliability).toBeLessThan(0.5);
      expect(rec.stakedAmount).toBe(18);
    });
  });

  describe("stake management", () => {
    it("adds stake to an agent record", () => {
      engine.initAgent("agent-1", 10);
      const record = engine.stake("agent-1", 5);
      expect(record.stakedAmount).toBe(15);
    });

    it("removes stake from an agent record", () => {
      engine.initAgent("agent-1", 10);
      const record = engine.unstake("agent-1", 4);
      expect(record.stakedAmount).toBe(6);
    });

    it("slashes stake and records the event", () => {
      engine.initAgent("agent-1", 12);
      const record = engine.slashStake("agent-1", 3, "contract-1", "manual ruling");
      expect(record.stakedAmount).toBe(9);
      expect(record.history.at(-1)?.reason).toContain("stake slashed");
    });
  });

  describe("checkStake", () => {
    it("returns false when stake below minimum", () => {
      engine.initAgent("agent-1", 5);
      expect(engine.checkStake("agent-1")).toBe(false);
    });

    it("returns true when stake meets minimum", () => {
      engine.initAgent("agent-1", 10);
      expect(engine.checkStake("agent-1")).toBe(true);
    });

    it("returns false for unknown agent", () => {
      expect(engine.checkStake("unknown")).toBe(false);
    });
  });

  describe("score decay", () => {
    it("recent updates have more weight than old updates", () => {
      engine.initAgent("agent-1");

      // First: negative update
      engine.updateReputation("agent-1", "c-1", { quality: -1.0 });
      const afterNeg = engine.getRecord("agent-1")!.dimensions.quality;

      // Then: positive update (should recover strongly due to recency weight)
      engine.updateReputation("agent-1", "c-2", { quality: 1.0 });
      const afterPos = engine.getRecord("agent-1")!.dimensions.quality;

      // The positive recovery should bring it above the original 0.5
      // since recent weight is 2x
      expect(afterPos).toBeGreaterThan(afterNeg);
    });
  });

  describe("stats", () => {
    it("returns correct aggregate stats", () => {
      engine.initAgent("a", 20);
      engine.initAgent("b", 5);
      engine.initAgent("c", 15);

      const stats = engine.stats();
      expect(stats.totalAgents).toBe(3);
      expect(stats.averageScore).toBeCloseTo(0.5, 5);
      expect(stats.aboveThreshold).toBe(2); // a and c meet minimum stake of 10
    });
  });

  describe("listRecords", () => {
    it("returns all records", () => {
      engine.initAgent("a");
      engine.initAgent("b");
      expect(engine.listRecords()).toHaveLength(2);
    });

    it("returns defensive copies", () => {
      engine.initAgent("a");
      const list = engine.listRecords();
      list[0]!.overallScore = 999;
      expect(engine.getRecord("a")!.overallScore).toBe(0.5);
    });
  });

  describe("bus integration", () => {
    it("auto-updates reputation on settlement.complete", async () => {
      engine.start();
      engine.initAgent("provider");
      engine.initAgent("requester");

      const requester = createMockIdentity("requester");
      const provider = createMockIdentity("provider");
      const contract = makeContract(requester, provider);

      await bus.publish("settlement.complete", { contract, action: "release" }, {
        name: "escrow",
      } as AgentIdentity);

      const rec = engine.getRecord("provider")!;
      expect(rec.contractsCompleted).toBe(1);
      engine.stop();
    });
  });
});
