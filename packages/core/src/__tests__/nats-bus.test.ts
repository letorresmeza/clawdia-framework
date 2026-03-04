import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { connect } from "nats";
import { NatsBus } from "../bus/nats-bus.js";
import type { AgentIdentity, ClawMessage } from "@clawdia/types";

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

const NATS_URL = "nats://localhost:4222";

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────
// Pre-flight: ensure NATS is reachable
// ─────────────────────────────────────────────────────────

beforeAll(async () => {
  try {
    const nc = await connect({ servers: NATS_URL, timeout: 3000 });
    await nc.close();
  } catch {
    throw new Error(
      "NATS is not running. Start it with: docker compose up -d nats",
    );
  }
});

// ─────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────

describe("NatsBus", () => {
  let bus: NatsBus;
  let sender: AgentIdentity;

  beforeEach(() => {
    bus = new NatsBus();
    sender = createMockIdentity("test-agent");
  });

  afterEach(async () => {
    try {
      await bus.disconnect();
    } catch {
      // Already disconnected
    }
  });

  // ─── Connection lifecycle ───

  describe("connect / disconnect", () => {
    it("connects to the default NATS URL", async () => {
      await bus.connect();
      // No error means success
    });

    it("connects to an explicit URL", async () => {
      await bus.connect(NATS_URL);
    });

    it("disconnects cleanly", async () => {
      await bus.connect();
      await bus.disconnect();
    });

    it("allows reconnection after disconnect", async () => {
      await bus.connect();
      await bus.disconnect();
      await bus.connect();
    });
  });

  // ─── Publish ───

  describe("publish", () => {
    it("throws if bus is not connected", async () => {
      await expect(
        bus.publish("heartbeat", { test: true }, sender),
      ).rejects.toThrow("Bus not connected");
    });

    it("returns a message ID", async () => {
      await bus.connect();
      const id = await bus.publish("heartbeat", { test: true }, sender);
      expect(id).toBeDefined();
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    });

    it("returns unique IDs for each message", async () => {
      await bus.connect();
      const id1 = await bus.publish("heartbeat", { a: 1 }, sender);
      const id2 = await bus.publish("heartbeat", { a: 2 }, sender);
      expect(id1).not.toBe(id2);
    });
  });

  // ─── Subscribe ───

  describe("subscribe", () => {
    it("throws if bus is not connected", () => {
      expect(() =>
        bus.subscribe("heartbeat", async () => {}),
      ).toThrow("Bus not connected");
    });

    it("returns a subscription ID", async () => {
      await bus.connect();
      const subId = bus.subscribe("heartbeat", async () => {});
      expect(subId).toBeDefined();
      expect(typeof subId).toBe("string");
    });

    it("delivers published messages to subscribers", async () => {
      await bus.connect();

      const received: ClawMessage<unknown>[] = [];
      bus.subscribe("task.request", async (msg) => {
        received.push(msg);
      });

      await bus.publish("task.request", { hello: "world" }, sender);
      await delay(200);

      expect(received).toHaveLength(1);
      expect(received[0]?.payload).toEqual({ hello: "world" });
    });

    it("delivers to multiple subscribers on the same channel", async () => {
      await bus.connect();

      const received1: unknown[] = [];
      const received2: unknown[] = [];

      bus.subscribe("task.progress", async (msg) => {
        received1.push(msg.payload);
      });
      bus.subscribe("task.progress", async (msg) => {
        received2.push(msg.payload);
      });

      await bus.publish("task.progress", { step: 1 }, sender);
      await delay(200);

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
    });

    it("isolates messages to the correct channel", async () => {
      await bus.connect();

      const heartbeats: unknown[] = [];
      const alerts: unknown[] = [];

      bus.subscribe("heartbeat", async (msg) => {
        heartbeats.push(msg.payload);
      });
      bus.subscribe("risk.alert", async (msg) => {
        alerts.push(msg.payload);
      });

      await bus.publish("heartbeat", { ping: true }, sender);
      await delay(200);

      expect(heartbeats).toHaveLength(1);
      expect(alerts).toHaveLength(0);
    });
  });

  // ─── Unsubscribe ───

  describe("unsubscribe", () => {
    it("stops delivery after unsubscribe", async () => {
      await bus.connect();

      const received: unknown[] = [];
      const subId = bus.subscribe("escalation", async (msg) => {
        received.push(msg.payload);
      });

      await bus.publish("escalation", { before: true }, sender);
      await delay(200);
      expect(received).toHaveLength(1);

      bus.unsubscribe(subId);
      await delay(50);

      await bus.publish("escalation", { after: true }, sender);
      await delay(200);

      expect(received).toHaveLength(1);
    });

    it("handles unsubscribe of non-existent ID gracefully", () => {
      // Should not throw
      bus.unsubscribe("non-existent-id");
    });
  });

  // ─── Message envelope ───

  describe("message envelope", () => {
    it("includes all envelope fields", async () => {
      await bus.connect();

      let captured: ClawMessage<unknown> | undefined;
      bus.subscribe("registry.update", async (msg) => {
        captured = msg;
      });

      await bus.publish("registry.update", { name: "agent-1" }, sender, {
        recipient: "target-agent",
        correlationId: "corr-123",
        ttl: 60,
        metadata: { trace: "abc" },
      });
      await delay(200);

      expect(captured).toBeDefined();
      expect(captured?.id).toBeDefined();
      expect(captured?.channel).toBe("registry.update");
      expect(captured?.timestamp).toBeDefined();
      expect(captured?.sender.name).toBe("test-agent");
      expect(captured?.recipient).toBe("target-agent");
      expect(captured?.correlationId).toBe("corr-123");
      expect(captured?.payload).toEqual({ name: "agent-1" });
      expect(captured?.ttl).toBe(60);
      expect(captured?.metadata).toEqual({ trace: "abc" });
    });

    it("generates correlationId when not provided", async () => {
      await bus.connect();

      let captured: ClawMessage<unknown> | undefined;
      bus.subscribe("heartbeat", async (msg) => {
        captured = msg;
      });

      await bus.publish("heartbeat", {}, sender);
      await delay(200);

      expect(captured?.correlationId).toBeDefined();
      expect(typeof captured?.correlationId).toBe("string");
      expect(captured!.correlationId.length).toBeGreaterThan(0);
    });
  });

  // ─── Error resilience ───

  describe("error resilience", () => {
    it("continues processing after a handler error", async () => {
      await bus.connect();

      const received: unknown[] = [];
      let callCount = 0;

      bus.subscribe("task.result", async (msg) => {
        callCount++;
        if (callCount === 1) {
          throw new Error("handler error");
        }
        received.push(msg.payload);
      });

      await bus.publish("task.result", { first: true }, sender);
      await delay(200);

      await bus.publish("task.result", { second: true }, sender);
      await delay(200);

      expect(callCount).toBe(2);
      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ second: true });
    });
  });
});
