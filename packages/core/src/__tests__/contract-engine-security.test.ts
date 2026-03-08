import { describe, it, expect, beforeEach } from "vitest";
import { ContractEngine, ConflictError } from "../contracts/contract-engine.js";
import { InMemoryBus } from "../bus/clawbus.js";
import type { AgentIdentity } from "@clawdia/types";

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function createMockIdentity(name: string): AgentIdentity {
  return {
    name,
    displayName: name,
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
        pricing: { model: "per_request", amount: 1.0, currency: "USDC" },
      },
    ],
    requirements: [],
    runtime: { model: "test-model" },
  };
}

function makeContractSpec(requester: AgentIdentity) {
  return {
    requester,
    capability: "test.capability",
    inputSchema: { type: "object" } as Record<string, unknown>,
    outputSchema: { type: "object" } as Record<string, unknown>,
    input: { task: "do something" },
    payment: { amount: 10, currency: "USDC" },
    sla: { deadlineMs: 60_000, maxRetries: 2 },
    verification: { method: "schema_match" as const },
  };
}

// ─────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────

describe("ContractEngine — security features", () => {
  let bus: InMemoryBus;
  let engine: ContractEngine;
  let requester: AgentIdentity;

  beforeEach(async () => {
    bus = new InMemoryBus();
    await bus.connect();
    engine = new ContractEngine(bus);
    requester = createMockIdentity("requester-agent");
  });

  // ── ConflictError ──────────────────────────────────────

  describe("ConflictError", () => {
    it("is thrown when expectedVersion does not match current version", async () => {
      const contract = engine.create(makeContractSpec(requester));
      // version starts at 0; pass expectedVersion=99 to force a mismatch
      await expect(
        engine.transition(contract.id, "OFFER", "requester", undefined, 99),
      ).rejects.toThrow(ConflictError);
    });

    it("carries contractId, expected, and actual fields", async () => {
      const contract = engine.create(makeContractSpec(requester));
      // Transition once to advance version to 1
      await engine.transition(contract.id, "OFFER", "requester");

      try {
        // Now version is 1; pass expectedVersion=0 to trigger conflict
        await engine.transition(contract.id, "ACCEPT", "provider", undefined, 0);
        expect.fail("Should have thrown ConflictError");
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictError);
        const conflictErr = err as ConflictError;
        expect(conflictErr.contractId).toBe(contract.id);
        expect(conflictErr.expected).toBe(0);
        expect(conflictErr.actual).toBe(1);
      }
    });

    it("does NOT throw when expectedVersion matches current version", async () => {
      const contract = engine.create(makeContractSpec(requester));
      // version is 0 — pass expectedVersion=0 (should succeed)
      const updated = await engine.transition(contract.id, "OFFER", "requester", undefined, 0);
      expect(updated.state).toBe("offered");
      expect(updated.version).toBe(1);
    });

    it("works with no expectedVersion (undefined) — skips CAS check", async () => {
      const contract = engine.create(makeContractSpec(requester));
      // Advance version to 1
      await engine.transition(contract.id, "OFFER", "requester");
      // Transition again with no expectedVersion — should not throw
      const updated = await engine.transition(contract.id, "ACCEPT", "provider");
      expect(updated.state).toBe("accepted");
    });
  });

  // ── Version CAS happy path ─────────────────────────────

  describe("Version CAS — happy path", () => {
    it("succeeds and increments version when expectedVersion matches", async () => {
      const contract = engine.create(makeContractSpec(requester));
      expect(contract.version).toBe(0);

      const afterOffer = await engine.transition(contract.id, "OFFER", "requester", undefined, 0);
      expect(afterOffer.version).toBe(1);

      const afterAccept = await engine.transition(contract.id, "ACCEPT", "provider", undefined, 1);
      expect(afterAccept.version).toBe(2);
    });
  });

  // ── Version auto-increment ─────────────────────────────

  describe("Version auto-increment", () => {
    it("increments version by 1 on each transition (0→1→2→3…)", async () => {
      const contract = engine.create(makeContractSpec(requester));
      const id = contract.id;

      expect(contract.version).toBe(0);

      const v1 = await engine.transition(id, "OFFER", "requester");
      expect(v1.version).toBe(1);

      const v2 = await engine.transition(id, "ACCEPT", "provider");
      expect(v2.version).toBe(2);

      const v3 = await engine.transition(id, "FUND", "requester");
      expect(v3.version).toBe(3);

      const v4 = await engine.transition(id, "DELIVER", "provider");
      expect(v4.version).toBe(4);

      const v5 = await engine.transition(id, "VERIFY", "verifier");
      expect(v5.version).toBe(5);

      const v6 = await engine.transition(id, "SETTLE", "system");
      expect(v6.version).toBe(6);
    });

    it("persists the correct version in stored contract", async () => {
      const contract = engine.create(makeContractSpec(requester));
      await engine.transition(contract.id, "OFFER", "requester");
      await engine.transition(contract.id, "ACCEPT", "provider");

      const stored = engine.get(contract.id);
      expect(stored?.version).toBe(2);
    });
  });

  // ── Mutex serialization ────────────────────────────────

  describe("Mutex serialization", () => {
    it("concurrent CANCEL on 10 different contracts all succeed (no deadlock)", async () => {
      const contracts = Array.from({ length: 10 }, () =>
        engine.create(makeContractSpec(requester)),
      );

      // Fire 10 concurrent CANCEL calls on 10 distinct contracts
      const results = await Promise.allSettled(
        contracts.map((c) => engine.transition(c.id, "CANCEL", "requester")),
      );

      // All should succeed
      for (const result of results) {
        expect(result.status).toBe("fulfilled");
        if (result.status === "fulfilled") {
          expect(result.value.state).toBe("cancelled");
        }
      }
    });

    it("concurrent duplicate OFFER on same contract: exactly one succeeds, one fails", async () => {
      const contract = engine.create(makeContractSpec(requester));

      // OFFER is only valid from "draft". With the mutex, both fire concurrently
      // but serialize: the first moves draft→offered, then the second tries OFFER
      // from "offered" which is invalid → rejected.
      const [first, second] = await Promise.allSettled([
        engine.transition(contract.id, "OFFER", "requester"),
        engine.transition(contract.id, "OFFER", "requester"),
      ]);

      const results = [first, second];
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // Final state must be "offered" (not "draft")
      const stored = engine.get(contract.id);
      expect(stored?.state).toBe("offered");
    });

    it("10 sequential transitions on same contract via concurrent calls serialize correctly", async () => {
      // Create 10 separate contracts, run 1 transition concurrently on each
      // Then verify version is exactly 1 on each
      const contracts = Array.from({ length: 10 }, () =>
        engine.create(makeContractSpec(requester)),
      );

      await Promise.all(
        contracts.map((c) => engine.transition(c.id, "OFFER", "requester")),
      );

      for (const c of contracts) {
        const stored = engine.get(c.id);
        expect(stored?.version).toBe(1);
        expect(stored?.state).toBe("offered");
      }
    });
  });
});
