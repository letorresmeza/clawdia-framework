import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryBus, ContractEngine } from "@clawdia/core";
import type { AgentIdentity } from "@clawdia/types";
import { ReputationEngine } from "../reputation/reputation-engine.js";
import { InMemoryEscrow } from "../escrow/in-memory-escrow.js";
import { BillingEngine } from "../billing/billing-engine.js";

function createMockIdentity(name: string): AgentIdentity {
  return {
    name,
    displayName: name.replace(/-/g, " "),
    description: `Mock agent ${name}`,
    version: "1.0.0",
    operator: "test-operator",
    publicKey: `ed25519:mock-key-${name}`,
    capabilities: [{
      taxonomy: "test.capability",
      description: "A test capability",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      sla: { maxLatencyMs: 5000, availability: 0.99 },
      pricing: { model: "per_request" as const, amount: 1.0, currency: "USDC" },
    }],
    requirements: [],
    runtime: { model: "test-model" },
  };
}

describe("Economy Integration", () => {
  let bus: InMemoryBus;
  let contracts: ContractEngine;
  let reputation: ReputationEngine;
  let escrowService: InMemoryEscrow;
  let billing: BillingEngine;
  let requester: AgentIdentity;
  let provider: AgentIdentity;

  beforeEach(async () => {
    bus = new InMemoryBus();
    await bus.connect();

    contracts = new ContractEngine(bus);
    reputation = new ReputationEngine(bus);
    escrowService = new InMemoryEscrow(bus);
    billing = new BillingEngine(bus);

    // Start all engines listening to the bus
    reputation.start();
    escrowService.start();
    billing.start();

    requester = createMockIdentity("requester-agent");
    provider = createMockIdentity("provider-agent");

    // Initialize reputation records
    reputation.initAgent("requester-agent", 20);
    reputation.initAgent("provider-agent", 20);

    // Register operator for billing
    billing.registerOperator("provider-agent", "test-operator");
  });

  it("full lifecycle: create → fund → deliver → settle → economy updated", async () => {
    // Create contract
    const contract = contracts.create({
      requester,
      provider,
      capability: "test.capability",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      input: { task: "analyze data" },
      payment: { amount: 50, currency: "USDC" },
      sla: { deadlineMs: 60_000, maxRetries: 2 },
      verification: { method: "schema_match" },
    });

    // Create and fund escrow manually (the bus listener auto-creates a minimal one,
    // but we want the full contract data attached)
    const escrowHandle = escrowService.createEscrow(contract);
    await escrowService.fundEscrow(escrowHandle);

    // Progress through contract lifecycle
    await contracts.transition(contract.id, "OFFER", "requester-agent");
    await contracts.transition(contract.id, "ACCEPT", "provider-agent");
    await contracts.transition(contract.id, "FUND", "requester-agent");
    contracts.setOutput(contract.id, { result: "analysis complete" });
    await contracts.transition(contract.id, "DELIVER", "provider-agent");
    await contracts.transition(contract.id, "VERIFY", "requester-agent");

    // Release escrow (with contract data for reputation + billing)
    const settledContract = contracts.get(contract.id)!;
    await escrowService.releaseEscrow(escrowHandle, "provider-agent", settledContract);

    // Settle the contract
    await contracts.transition(contract.id, "SETTLE", "requester-agent");

    // Verify escrow was released
    const finalEscrow = escrowService.getEscrow(escrowHandle.id)!;
    expect(finalEscrow.status).toBe("released");

    // Verify provider balance credited
    const balance = escrowService.getBalance("provider-agent");
    expect(balance).toBeGreaterThan(0n);

    // Verify reputation updated (settlement.complete triggers auto-update)
    const providerRep = reputation.getRecord("provider-agent")!;
    expect(providerRep.contractsCompleted).toBe(1);
    expect(providerRep.dimensions.reliability).toBeGreaterThan(0.5);

    // Verify billing recorded
    const billingRecords = billing.listRecords();
    expect(billingRecords.length).toBeGreaterThanOrEqual(1);
  });

  it("dispute flow: fund → fail → dispute → resolve", async () => {
    const contract = contracts.create({
      requester,
      provider,
      capability: "test.capability",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      payment: { amount: 30, currency: "USDC" },
      sla: { deadlineMs: 60_000, maxRetries: 2 },
      verification: { method: "schema_match" },
    });

    // Create and fund escrow
    const escrowHandle = escrowService.createEscrow(contract);
    await escrowService.fundEscrow(escrowHandle);

    // Dispute the escrow
    const dispute = await escrowService.disputeEscrow(escrowHandle, "Output was garbage");

    expect(dispute.currentTier).toBe("automated");

    // Escalate through tiers
    await escrowService.escalateDispute(dispute.id);
    const escalated = escrowService.getDispute(dispute.id)!;
    expect(escalated.currentTier).toBe("arbitrator_agent");

    // Resolve with provider wins
    await escrowService.resolveDispute(dispute.id, {
      tier: "arbitrator_agent",
      decision: "provider_wins",
      reasoning: "Output met requirements on review",
      ruledBy: "arbitrator-agent",
      timestamp: new Date().toISOString(),
    });

    const resolved = escrowService.getDispute(dispute.id)!;
    expect(resolved.resolvedAt).toBeDefined();
    expect(resolved.ruling!.decision).toBe("provider_wins");
  });

  it("multiple contracts accumulate reputation", async () => {
    // Complete 3 contracts
    for (let i = 0; i < 3; i++) {
      const contract = contracts.create({
        requester,
        provider,
        capability: "test.capability",
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        payment: { amount: 10, currency: "USDC" },
        sla: { deadlineMs: 60_000, maxRetries: 2 },
        verification: { method: "schema_match" },
      });

      reputation.recordSettledContract({
        ...contract,
        state: "settled",
        provider,
      });
    }

    const providerRep = reputation.getRecord("provider-agent")!;
    expect(providerRep.contractsCompleted).toBe(3);
    expect(providerRep.dimensions.reliability).toBeGreaterThan(0.5);
    // Each settled contract pushes reliability up
    expect(providerRep.history.length).toBeGreaterThan(0);
  });

  it("economy stats aggregate correctly", async () => {
    // Create some escrows
    const c1 = contracts.create({
      requester,
      provider,
      capability: "test.capability",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      payment: { amount: 25, currency: "USDC" },
      sla: { deadlineMs: 60_000, maxRetries: 2 },
      verification: { method: "schema_match" },
    });

    const h1 = escrowService.createEscrow(c1);
    await escrowService.fundEscrow(h1);

    billing.recordUsage({
      agentName: "provider-agent",
      resourceType: "task_cost",
      quantity: 1,
      unit: "task",
      cost: 25,
    });

    const repStats = reputation.stats();
    expect(repStats.totalAgents).toBe(2);

    const escrowStats = escrowService.stats();
    expect(escrowStats.totalEscrows).toBe(1);
    expect(escrowStats.funded).toBe(1);

    const billingStats = billing.stats();
    expect(billingStats.totalRecords).toBe(1);
    expect(billingStats.totalRevenue).toBe(25);
    expect(billingStats.totalFees).toBeCloseTo(0.75, 2); // 3% of 25
  });
});
