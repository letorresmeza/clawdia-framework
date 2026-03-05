import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryBus } from "@clawdia/core";
import type { AgentIdentity, TaskContract } from "@clawdia/types";
import { BillingEngine } from "../billing/billing-engine.js";

function createMockIdentity(name: string): AgentIdentity {
  return {
    name,
    displayName: name,
    description: `Mock ${name}`,
    version: "1.0.0",
    operator: "test-operator",
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
    state: "settled",
    requester: createMockIdentity("requester"),
    provider: createMockIdentity("provider"),
    capability: "test.cap",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    payment: { amount: 50, currency: "USDC" },
    sla: { deadlineMs: 60_000, maxRetries: 2 },
    verification: { method: "schema_match" },
    signatures: {},
    createdAt: now,
    updatedAt: now,
    history: [],
    ...overrides,
  };
}

describe("BillingEngine", () => {
  let bus: InMemoryBus;
  let billing: BillingEngine;

  beforeEach(async () => {
    bus = new InMemoryBus();
    await bus.connect();
    billing = new BillingEngine(bus);
  });

  describe("recordUsage", () => {
    it("creates a usage record with UUID and timestamp", () => {
      const record = billing.recordUsage({
        agentName: "agent-1",
        resourceType: "compute_ms",
        quantity: 5000,
        unit: "ms",
        cost: 0.01,
      });

      expect(record.id).toBeDefined();
      expect(record.agentName).toBe("agent-1");
      expect(record.resourceType).toBe("compute_ms");
      expect(record.quantity).toBe(5000);
      expect(record.cost).toBe(0.01);
      expect(record.currency).toBe("USDC");
      expect(record.timestamp).toBeDefined();
    });

    it("accepts custom currency", () => {
      const record = billing.recordUsage({
        agentName: "a",
        resourceType: "tokens",
        quantity: 100,
        unit: "tokens",
        cost: 1,
        currency: "ETH",
      });
      expect(record.currency).toBe("ETH");
    });
  });

  describe("meterTaskExecution", () => {
    it("creates duration, tokens, and cost records", () => {
      const contract = makeContract();
      const records = billing.meterTaskExecution(contract, {
        durationMs: 3000,
        tokensUsed: 1500,
        cost: 0.05,
      });

      expect(records).toHaveLength(3);
      expect(records[0]!.resourceType).toBe("compute_ms");
      expect(records[0]!.quantity).toBe(3000);
      expect(records[1]!.resourceType).toBe("tokens");
      expect(records[1]!.quantity).toBe(1500);
      expect(records[2]!.resourceType).toBe("task_cost");
      expect(records[2]!.cost).toBe(0.05);
    });

    it("skips tokens record when tokensUsed is 0", () => {
      const contract = makeContract();
      const records = billing.meterTaskExecution(contract, {
        durationMs: 1000,
        tokensUsed: 0,
        cost: 0.01,
      });
      expect(records).toHaveLength(2);
    });

    it("skips tokens record when tokensUsed is undefined", () => {
      const contract = makeContract();
      const records = billing.meterTaskExecution(contract, {
        durationMs: 1000,
        cost: 0.01,
      });
      expect(records).toHaveLength(2);
    });
  });

  describe("getUsageByAgent", () => {
    it("filters records by agent name", () => {
      billing.recordUsage({ agentName: "a", resourceType: "r", quantity: 1, unit: "u", cost: 1 });
      billing.recordUsage({ agentName: "b", resourceType: "r", quantity: 1, unit: "u", cost: 2 });
      billing.recordUsage({ agentName: "a", resourceType: "r", quantity: 1, unit: "u", cost: 3 });

      const records = billing.getUsageByAgent("a");
      expect(records).toHaveLength(2);
    });

    it("filters by time range", () => {
      const past = new Date("2024-01-01").toISOString();
      billing.recordUsage({ agentName: "a", resourceType: "r", quantity: 1, unit: "u", cost: 1 });

      // Records created "now" should be after 2024-01-01
      const records = billing.getUsageByAgent("a", { from: past });
      expect(records).toHaveLength(1);

      // No records before 2024-01-01
      const empty = billing.getUsageByAgent("a", { to: past });
      expect(empty).toHaveLength(0);
    });
  });

  describe("generateInvoice", () => {
    it("aggregates usage records into an invoice with line items", () => {
      billing.registerOperator("agent-1", "acme-corp");
      billing.recordUsage({
        agentName: "agent-1",
        resourceType: "task_cost",
        quantity: 1,
        unit: "task",
        cost: 10,
      });
      billing.recordUsage({
        agentName: "agent-1",
        resourceType: "task_cost",
        quantity: 1,
        unit: "task",
        cost: 20,
      });

      const now = new Date();
      const start = new Date(now.getTime() - 86400_000).toISOString();
      const end = new Date(now.getTime() + 86400_000).toISOString();

      const invoice = billing.generateInvoice("acme-corp", { start, end });
      expect(invoice.operator).toBe("acme-corp");
      expect(invoice.lineItems).toHaveLength(1);
      expect(invoice.lineItems[0]!.total).toBe(30);
      // Total includes 3% platform fee: 30 + 0.9 = 30.9
      expect(invoice.total).toBeCloseTo(30.9, 1);
      expect(invoice.status).toBe("draft");
    });

    it("groups by agent + resourceType", () => {
      billing.registerOperator("a", "corp");
      billing.registerOperator("b", "corp");
      billing.recordUsage({ agentName: "a", resourceType: "r1", quantity: 1, unit: "u", cost: 5 });
      billing.recordUsage({ agentName: "b", resourceType: "r1", quantity: 1, unit: "u", cost: 10 });

      const now = new Date();
      const invoice = billing.generateInvoice("corp", {
        start: new Date(now.getTime() - 86400_000).toISOString(),
        end: new Date(now.getTime() + 86400_000).toISOString(),
      });
      expect(invoice.lineItems).toHaveLength(2);
    });
  });

  describe("calculatePlatformFee", () => {
    it("calculates 3% by default", () => {
      expect(billing.calculatePlatformFee(100)).toBe(3);
    });

    it("uses custom fee percentage", async () => {
      const customBilling = new BillingEngine(bus, { transactionFeePercent: 5 });
      expect(customBilling.calculatePlatformFee(100)).toBe(5);
    });
  });

  describe("stats", () => {
    it("returns correct aggregate stats", () => {
      billing.recordUsage({ agentName: "a", resourceType: "r", quantity: 1, unit: "u", cost: 10 });
      billing.recordUsage({ agentName: "b", resourceType: "r", quantity: 1, unit: "u", cost: 20 });

      const stats = billing.stats();
      expect(stats.totalRecords).toBe(2);
      expect(stats.totalRevenue).toBe(30);
      expect(stats.totalFees).toBeCloseTo(0.9, 1); // 3% of 30
      expect(stats.invoiceCount).toBe(0);
    });
  });

  describe("listInvoices", () => {
    it("returns all generated invoices", () => {
      billing.registerOperator("a", "corp");
      billing.recordUsage({ agentName: "a", resourceType: "r", quantity: 1, unit: "u", cost: 10 });

      const now = new Date();
      billing.generateInvoice("corp", {
        start: new Date(now.getTime() - 86400_000).toISOString(),
        end: new Date(now.getTime() + 86400_000).toISOString(),
      });

      expect(billing.listInvoices()).toHaveLength(1);
    });
  });

  describe("bus integration", () => {
    it("auto-meters on settlement.complete", async () => {
      billing.start();

      const contract = makeContract();
      await bus.publish(
        "settlement.complete",
        {
          contractId: contract.id,
          action: "release",
          amount: 50,
          currency: "USDC",
          contract,
        },
        { name: "escrow" } as AgentIdentity,
      );

      const records = billing.listRecords();
      expect(records.length).toBeGreaterThanOrEqual(1);
      expect(records[0]!.resourceType).toBe("settlement");
      billing.stop();
    });
  });
});
