import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryBus } from "@clawdia/core";
import type { AgentIdentity, TaskContract, DisputeRuling } from "@clawdia/types";
import { InMemoryEscrow } from "../escrow/in-memory-escrow.js";

function createMockIdentity(name: string): AgentIdentity {
  return {
    name,
    displayName: name,
    description: `Mock ${name}`,
    version: "1.0.0",
    operator: "test",
    publicKey: `key-${name}`,
    capabilities: [{
      taxonomy: "test.cap",
      description: "test",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      sla: { maxLatencyMs: 5000, availability: 0.99 },
      pricing: { model: "per_request" as const, amount: 1.0, currency: "USDC" },
    }],
    requirements: [],
    runtime: {},
  };
}

function makeContract(overrides?: Partial<TaskContract>): TaskContract {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    state: "accepted",
    requester: createMockIdentity("requester"),
    provider: createMockIdentity("provider"),
    capability: "test.cap",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    payment: { amount: 100, currency: "USDC" },
    sla: { deadlineMs: 60_000, maxRetries: 2 },
    verification: { method: "schema_match" },
    signatures: {},
    createdAt: now,
    updatedAt: now,
    history: [],
    ...overrides,
  };
}

describe("InMemoryEscrow", () => {
  let bus: InMemoryBus;
  let escrow: InMemoryEscrow;

  beforeEach(async () => {
    bus = new InMemoryBus();
    await bus.connect();
    escrow = new InMemoryEscrow(bus);
  });

  describe("createEscrow", () => {
    it("creates an escrow with 'created' status", () => {
      const contract = makeContract();
      const handle = escrow.createEscrow(contract);
      expect(handle.id).toBeDefined();
      expect(handle.contractId).toBe(contract.id);
      expect(handle.status).toBe("created");
      expect(handle.currency).toBe("USDC");
      expect(handle.amount).toBe(BigInt(100_000_000)); // 100 * 1M micro-units
    });
  });

  describe("fundEscrow", () => {
    it("transitions to funded and returns tx hash", async () => {
      const contract = makeContract();
      const handle = escrow.createEscrow(contract);
      const txHash = await escrow.fundEscrow(handle);
      expect(txHash).toMatch(/^0x/);

      const updated = escrow.getEscrow(handle.id)!;
      expect(updated.status).toBe("funded");
    });

    it("publishes settlement.request on fund", async () => {
      const messages: unknown[] = [];
      bus.subscribe("settlement.request", async (msg) => messages.push(msg.payload));

      const contract = makeContract();
      const handle = escrow.createEscrow(contract);
      await escrow.fundEscrow(handle);

      expect(messages).toHaveLength(1);
    });

    it("throws if escrow not in created status", async () => {
      const contract = makeContract();
      const handle = escrow.createEscrow(contract);
      await escrow.fundEscrow(handle);

      await expect(escrow.fundEscrow(handle)).rejects.toThrow("Cannot fund escrow");
    });
  });

  describe("releaseEscrow", () => {
    it("transitions to released and credits recipient", async () => {
      const contract = makeContract();
      const handle = escrow.createEscrow(contract);
      await escrow.fundEscrow(handle);

      const txHash = await escrow.releaseEscrow(handle, "provider");
      expect(txHash).toMatch(/^0x/);

      const updated = escrow.getEscrow(handle.id)!;
      expect(updated.status).toBe("released");

      const balance = escrow.getBalance("provider");
      expect(balance).toBe(BigInt(100_000_000));
    });

    it("publishes settlement.complete on release", async () => {
      const messages: unknown[] = [];
      bus.subscribe("settlement.complete", async (msg) => messages.push(msg.payload));

      const contract = makeContract();
      const handle = escrow.createEscrow(contract);
      await escrow.fundEscrow(handle);
      await escrow.releaseEscrow(handle, "provider");

      expect(messages).toHaveLength(1);
    });

    it("throws if escrow not funded", async () => {
      const contract = makeContract();
      const handle = escrow.createEscrow(contract);
      await expect(escrow.releaseEscrow(handle, "provider")).rejects.toThrow(
        "Cannot release escrow",
      );
    });
  });

  describe("disputeEscrow", () => {
    it("creates a dispute at automated tier", async () => {
      const contract = makeContract();
      const handle = escrow.createEscrow(contract);
      await escrow.fundEscrow(handle);

      const dispute = await escrow.disputeEscrow(handle, "Output did not match schema");
      expect(dispute.id).toBeDefined();
      expect(dispute.currentTier).toBe("automated");
      expect(dispute.reason).toBe("Output did not match schema");

      const updated = escrow.getEscrow(handle.id)!;
      expect(updated.status).toBe("disputed");
    });

    it("publishes escalation event", async () => {
      const messages: unknown[] = [];
      bus.subscribe("escalation", async (msg) => messages.push(msg.payload));

      const contract = makeContract();
      const handle = escrow.createEscrow(contract);
      await escrow.fundEscrow(handle);
      await escrow.disputeEscrow(handle, "Bad output");

      expect(messages).toHaveLength(1);
    });
  });

  describe("escalateDispute", () => {
    it("escalates from automated to arbitrator_agent", async () => {
      const contract = makeContract();
      const handle = escrow.createEscrow(contract);
      await escrow.fundEscrow(handle);
      const dispute = await escrow.disputeEscrow(handle, "reason");

      const nextTier = await escrow.escalateDispute(dispute.id);
      expect(nextTier).toBe("arbitrator_agent");

      const updated = escrow.getDispute(dispute.id)!;
      expect(updated.currentTier).toBe("arbitrator_agent");
    });

    it("escalates from arbitrator_agent to human", async () => {
      const contract = makeContract();
      const handle = escrow.createEscrow(contract);
      await escrow.fundEscrow(handle);
      const dispute = await escrow.disputeEscrow(handle, "reason");
      await escrow.escalateDispute(dispute.id);

      const nextTier = await escrow.escalateDispute(dispute.id);
      expect(nextTier).toBe("human");
    });

    it("throws at highest tier", async () => {
      const contract = makeContract();
      const handle = escrow.createEscrow(contract);
      await escrow.fundEscrow(handle);
      const dispute = await escrow.disputeEscrow(handle, "reason");
      await escrow.escalateDispute(dispute.id); // → arbitrator_agent
      await escrow.escalateDispute(dispute.id); // → human

      await expect(escrow.escalateDispute(dispute.id)).rejects.toThrow("highest");
    });
  });

  describe("resolveDispute", () => {
    it("requester_wins refunds escrow", async () => {
      const contract = makeContract();
      const handle = escrow.createEscrow(contract);
      await escrow.fundEscrow(handle);
      const dispute = await escrow.disputeEscrow(handle, "reason");

      const ruling: DisputeRuling = {
        tier: "automated",
        decision: "requester_wins",
        reasoning: "Output invalid",
        ruledBy: "system",
        timestamp: new Date().toISOString(),
      };
      await escrow.resolveDispute(dispute.id, ruling);

      const resolved = escrow.getDispute(dispute.id)!;
      expect(resolved.resolvedAt).toBeDefined();
      expect(resolved.ruling!.decision).toBe("requester_wins");

      const updated = escrow.getEscrow(handle.id)!;
      expect(updated.status).toBe("refunded");
    });

    it("provider_wins releases escrow", async () => {
      const contract = makeContract();
      const handle = escrow.createEscrow(contract);
      await escrow.fundEscrow(handle);
      const dispute = await escrow.disputeEscrow(handle, "reason");

      const ruling: DisputeRuling = {
        tier: "automated",
        decision: "provider_wins",
        reasoning: "Output was valid",
        ruledBy: "system",
        timestamp: new Date().toISOString(),
      };
      await escrow.resolveDispute(dispute.id, ruling);

      const updated = escrow.getEscrow(handle.id)!;
      expect(updated.status).toBe("released");
    });

    it("split divides funds between parties", async () => {
      const contract = makeContract();
      const handle = escrow.createEscrow(contract);
      await escrow.fundEscrow(handle);
      const dispute = await escrow.disputeEscrow(handle, "partial");

      const ruling: DisputeRuling = {
        tier: "human",
        decision: "split",
        splitPercent: 60,
        reasoning: "Partial delivery",
        ruledBy: "human-reviewer",
        timestamp: new Date().toISOString(),
      };
      await escrow.resolveDispute(dispute.id, ruling);

      // 60% to requester, 40% to provider
      const reqBalance = escrow.getBalance("requester");
      const provBalance = escrow.getBalance("provider");
      expect(reqBalance + provBalance).toBe(BigInt(100_000_000));
      expect(reqBalance).toBe(BigInt(60_000_000));
      expect(provBalance).toBe(BigInt(40_000_000));
    });

    it("publishes settlement.complete on resolution", async () => {
      const messages: unknown[] = [];
      bus.subscribe("settlement.complete", async (msg) => messages.push(msg.payload));

      const contract = makeContract();
      const handle = escrow.createEscrow(contract);
      await escrow.fundEscrow(handle);
      const dispute = await escrow.disputeEscrow(handle, "reason");

      await escrow.resolveDispute(dispute.id, {
        tier: "automated",
        decision: "provider_wins",
        reasoning: "Valid",
        ruledBy: "system",
        timestamp: new Date().toISOString(),
      });

      expect(messages).toHaveLength(1);
    });
  });

  describe("addEvidence", () => {
    it("adds evidence to a dispute", async () => {
      const contract = makeContract();
      const handle = escrow.createEscrow(contract);
      await escrow.fundEscrow(handle);
      const dispute = await escrow.disputeEscrow(handle, "reason");

      escrow.addEvidence(dispute.id, {
        submittedBy: "requester",
        type: "output_data",
        content: { result: "invalid" },
        timestamp: new Date().toISOString(),
      });

      const updated = escrow.getDispute(dispute.id)!;
      expect(updated.evidence).toHaveLength(1);
    });
  });

  describe("stats", () => {
    it("returns correct aggregate stats", async () => {
      const c1 = makeContract();
      const c2 = makeContract();
      const h1 = escrow.createEscrow(c1);
      const h2 = escrow.createEscrow(c2);
      await escrow.fundEscrow(h1);
      await escrow.fundEscrow(h2);
      await escrow.releaseEscrow(h1, "provider");

      const stats = escrow.stats();
      expect(stats.totalEscrows).toBe(2);
      expect(stats.funded).toBe(1);
      expect(stats.released).toBe(1);
      expect(stats.disputed).toBe(0);
    });
  });

  describe("listEscrows / listDisputes", () => {
    it("lists all escrows", async () => {
      escrow.createEscrow(makeContract());
      escrow.createEscrow(makeContract());
      expect(escrow.listEscrows()).toHaveLength(2);
    });

    it("lists all disputes", async () => {
      const contract = makeContract();
      const handle = escrow.createEscrow(contract);
      await escrow.fundEscrow(handle);
      await escrow.disputeEscrow(handle, "r1");
      expect(escrow.listDisputes()).toHaveLength(1);
    });
  });
});
