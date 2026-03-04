import { describe, it, expect, beforeEach, vi } from "vitest";
import { ContractEngine } from "../contracts/contract-engine.js";
import { InMemoryBus } from "../bus/clawbus.js";
import type { AgentIdentity, ContractState, ContractEvent } from "@clawdia/types";

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

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

describe("ContractEngine", () => {
  let bus: InMemoryBus;
  let engine: ContractEngine;
  let requester: AgentIdentity;
  let provider: AgentIdentity;

  beforeEach(async () => {
    bus = new InMemoryBus();
    await bus.connect();
    engine = new ContractEngine(bus);
    requester = createMockIdentity("requester-agent");
    provider = createMockIdentity("provider-agent");
  });

  // ── create ──────────────────────────────────────────────

  describe("create", () => {
    it("creates a contract in draft state with a unique id", () => {
      const contract = engine.create(makeContractSpec(requester));
      expect(contract.id).toBeDefined();
      expect(contract.state).toBe("draft");
      expect(contract.requester.name).toBe("requester-agent");
      expect(contract.capability).toBe("test.capability");
      expect(contract.history).toEqual([]);
      expect(contract.signatures).toEqual({});
    });

    it("assigns unique ids to different contracts", () => {
      const a = engine.create(makeContractSpec(requester));
      const b = engine.create(makeContractSpec(requester));
      expect(a.id).not.toBe(b.id);
    });

    it("returns a defensive copy", () => {
      const contract = engine.create(makeContractSpec(requester));
      contract.state = "settled" as ContractState;
      const stored = engine.get(contract.id);
      expect(stored?.state).toBe("draft");
    });

    it("stores timestamps", () => {
      const contract = engine.create(makeContractSpec(requester));
      expect(contract.createdAt).toBeDefined();
      expect(contract.updatedAt).toBeDefined();
      expect(contract.createdAt).toBe(contract.updatedAt);
    });

    it("accepts an optional provider", () => {
      const spec = { ...makeContractSpec(requester), provider };
      const contract = engine.create(spec);
      expect(contract.provider?.name).toBe("provider-agent");
    });
  });

  // ── transition ──────────────────────────────────────────

  describe("transition", () => {
    it("transitions draft → offered via OFFER", async () => {
      const contract = engine.create(makeContractSpec(requester));
      const updated = await engine.transition(contract.id, "OFFER", "requester-agent");
      expect(updated.state).toBe("offered");
      expect(updated.history).toHaveLength(1);
      expect(updated.history[0].from).toBe("draft");
      expect(updated.history[0].to).toBe("offered");
      expect(updated.history[0].event).toBe("OFFER");
      expect(updated.history[0].triggeredBy).toBe("requester-agent");
    });

    it("walks the full happy path: draft → settled", async () => {
      const contract = engine.create(makeContractSpec(requester));
      const id = contract.id;

      await engine.transition(id, "OFFER", "requester");
      await engine.transition(id, "ACCEPT", "provider");
      await engine.transition(id, "FUND", "requester");
      await engine.transition(id, "DELIVER", "provider");
      await engine.transition(id, "VERIFY", "verifier");
      const settled = await engine.transition(id, "SETTLE", "system");

      expect(settled.state).toBe("settled");
      expect(settled.history).toHaveLength(6);
    });

    it("rejects invalid transitions", async () => {
      const contract = engine.create(makeContractSpec(requester));
      await expect(
        engine.transition(contract.id, "DELIVER", "someone"),
      ).rejects.toThrow(/Invalid transition.*cannot apply "DELIVER" to contract in "draft"/);
    });

    it("throws on unknown contract id", async () => {
      await expect(
        engine.transition("nonexistent-id", "OFFER", "someone"),
      ).rejects.toThrow('Contract "nonexistent-id" not found');
    });

    it("publishes state change to ClawBus", async () => {
      const messages: unknown[] = [];
      bus.subscribe("task.request", async (msg) => {
        messages.push(msg.payload);
      });

      const contract = engine.create(makeContractSpec(requester));
      await engine.transition(contract.id, "OFFER", "requester");

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        contractId: contract.id,
        event: "OFFER",
        previousState: "draft",
        newState: "offered",
        triggeredBy: "requester",
      });
    });

    it("records metadata in history entries", async () => {
      const contract = engine.create(makeContractSpec(requester));
      const meta = { reason: "test" };
      const updated = await engine.transition(contract.id, "OFFER", "requester", meta);
      expect(updated.history[0].metadata).toEqual(meta);
    });

    it("updates the updatedAt timestamp", async () => {
      const contract = engine.create(makeContractSpec(requester));
      const beforeTransition = contract.updatedAt;

      // Small delay to ensure different timestamp
      await new Promise((r) => setTimeout(r, 5));
      const updated = await engine.transition(contract.id, "OFFER", "requester");
      expect(updated.updatedAt).not.toBe(beforeTransition);
    });

    it("returns a defensive copy from transition", async () => {
      const contract = engine.create(makeContractSpec(requester));
      const offered = await engine.transition(contract.id, "OFFER", "requester");
      offered.state = "settled" as ContractState;
      expect(engine.get(contract.id)?.state).toBe("offered");
    });

    it("rejects events on terminal states", async () => {
      const contract = engine.create(makeContractSpec(requester));
      await engine.transition(contract.id, "CANCEL", "requester");
      await expect(
        engine.transition(contract.id, "OFFER", "someone"),
      ).rejects.toThrow(/none \(terminal state\)/);
    });

    it("handles dispute path: in_progress → disputed via FAIL", async () => {
      const contract = engine.create(makeContractSpec(requester));
      await engine.transition(contract.id, "OFFER", "r");
      await engine.transition(contract.id, "ACCEPT", "p");
      await engine.transition(contract.id, "FUND", "r");
      const disputed = await engine.transition(contract.id, "FAIL", "p");
      expect(disputed.state).toBe("disputed");
    });

    it("handles dispute resolution: disputed → settled via RESOLVE", async () => {
      const contract = engine.create(makeContractSpec(requester));
      await engine.transition(contract.id, "OFFER", "r");
      await engine.transition(contract.id, "ACCEPT", "p");
      await engine.transition(contract.id, "FUND", "r");
      await engine.transition(contract.id, "FAIL", "p");
      const resolved = await engine.transition(contract.id, "RESOLVE", "arbiter");
      expect(resolved.state).toBe("settled");
    });

    it("handles REJECT from delivered → disputed", async () => {
      const contract = engine.create(makeContractSpec(requester));
      await engine.transition(contract.id, "OFFER", "r");
      await engine.transition(contract.id, "ACCEPT", "p");
      await engine.transition(contract.id, "FUND", "r");
      await engine.transition(contract.id, "DELIVER", "p");
      const rejected = await engine.transition(contract.id, "REJECT", "r");
      expect(rejected.state).toBe("disputed");
    });
  });

  // ── setProvider ─────────────────────────────────────────

  describe("setProvider", () => {
    it("sets provider on offered contracts", async () => {
      const contract = engine.create(makeContractSpec(requester));
      await engine.transition(contract.id, "OFFER", "requester");
      engine.setProvider(contract.id, provider);
      expect(engine.get(contract.id)?.provider?.name).toBe("provider-agent");
    });

    it("throws when contract is not in offered state", () => {
      const contract = engine.create(makeContractSpec(requester));
      expect(() => engine.setProvider(contract.id, provider)).toThrow(
        /Can only set provider on "offered" contracts/,
      );
    });

    it("throws on unknown contract id", () => {
      expect(() => engine.setProvider("nope", provider)).toThrow(
        'Contract "nope" not found',
      );
    });
  });

  // ── setOutput ───────────────────────────────────────────

  describe("setOutput", () => {
    it("attaches output to a contract", () => {
      const contract = engine.create(makeContractSpec(requester));
      const output = { result: "done" };
      engine.setOutput(contract.id, output);
      expect(engine.get(contract.id)?.output).toEqual(output);
    });

    it("throws on unknown contract id", () => {
      expect(() => engine.setOutput("nope", {})).toThrow(
        'Contract "nope" not found',
      );
    });
  });

  // ── get ─────────────────────────────────────────────────

  describe("get", () => {
    it("returns undefined for non-existent contracts", () => {
      expect(engine.get("nonexistent")).toBeUndefined();
    });

    it("returns a defensive copy", () => {
      const contract = engine.create(makeContractSpec(requester));
      const copy = engine.get(contract.id)!;
      copy.capability = "mutated";
      expect(engine.get(contract.id)?.capability).toBe("test.capability");
    });
  });

  // ── list ────────────────────────────────────────────────

  describe("list", () => {
    it("returns all contracts when no filter", () => {
      engine.create(makeContractSpec(requester));
      engine.create(makeContractSpec(requester));
      expect(engine.list()).toHaveLength(2);
    });

    it("filters by state", async () => {
      const a = engine.create(makeContractSpec(requester));
      engine.create(makeContractSpec(requester));
      await engine.transition(a.id, "OFFER", "r");
      expect(engine.list({ state: "offered" })).toHaveLength(1);
      expect(engine.list({ state: "draft" })).toHaveLength(1);
    });

    it("filters by requester name", () => {
      const other = createMockIdentity("other-agent");
      engine.create(makeContractSpec(requester));
      engine.create(makeContractSpec(other));
      expect(engine.list({ requester: "requester-agent" })).toHaveLength(1);
    });

    it("filters by provider name", async () => {
      const c = engine.create({ ...makeContractSpec(requester), provider });
      engine.create(makeContractSpec(requester));
      expect(engine.list({ provider: "provider-agent" })).toHaveLength(1);
    });

    it("returns empty array when nothing matches", () => {
      expect(engine.list({ state: "settled" })).toEqual([]);
    });
  });

  // ── stats ───────────────────────────────────────────────

  describe("stats", () => {
    it("counts contracts by state", async () => {
      const a = engine.create(makeContractSpec(requester));
      const b = engine.create(makeContractSpec(requester));
      engine.create(makeContractSpec(requester));

      await engine.transition(a.id, "OFFER", "r");
      await engine.transition(b.id, "CANCEL", "r");

      const s = engine.stats();
      expect(s.draft).toBe(1);
      expect(s.offered).toBe(1);
      expect(s.cancelled).toBe(1);
    });

    it("returns empty-ish stats when no contracts", () => {
      const s = engine.stats();
      expect(s.draft).toBeUndefined();
    });
  });
});
