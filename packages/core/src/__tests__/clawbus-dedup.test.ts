import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryBus } from "../bus/clawbus.js";
import type { AgentIdentity } from "@clawdia/types";

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function mockSender(name = "test-agent"): AgentIdentity {
  return {
    name,
    displayName: name,
    description: "test",
    version: "1.0.0",
    operator: "test",
    publicKey: "test-key",
    capabilities: [],
    requirements: [],
    runtime: { model: "test-model" },
  };
}

// ─────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────

describe("InMemoryBus — message deduplication", () => {
  let bus: InMemoryBus;
  const sender = mockSender();

  beforeEach(async () => {
    bus = new InMemoryBus();
    await bus.connect();
  });

  // ── getSeenIdsCount ────────────────────────────────────

  describe("getSeenIdsCount()", () => {
    it("starts at zero before any publishes", () => {
      expect(bus.getSeenIdsCount()).toBe(0);
    });

    it("grows by 1 with each unique publish", async () => {
      await bus.publish("heartbeat", { ping: 1 }, sender);
      expect(bus.getSeenIdsCount()).toBe(1);

      await bus.publish("heartbeat", { ping: 2 }, sender);
      expect(bus.getSeenIdsCount()).toBe(2);

      await bus.publish("heartbeat", { ping: 3 }, sender);
      expect(bus.getSeenIdsCount()).toBe(3);
    });
  });

  // ── FIFO eviction at 10,000 cap ────────────────────────

  describe("FIFO eviction", () => {
    it("caps seenIds at 10,000 after 10,001 publishes", async () => {
      const count = 10_001;
      for (let i = 0; i < count; i++) {
        await bus.publish("heartbeat", { i }, sender);
      }
      // The eviction triggers when length exceeds 10,000, so after 10,001 messages
      // one entry has been evicted → size should be exactly 10,000
      expect(bus.getSeenIdsCount()).toBe(10_000);
    });

    it("handler is called 10,001 times for 10,001 distinct messages (no false dedup)", async () => {
      let callCount = 0;
      bus.subscribe("heartbeat", async () => {
        callCount++;
      });

      const count = 10_001;
      for (let i = 0; i < count; i++) {
        await bus.publish("heartbeat", { i }, sender);
      }

      // All 10,001 messages are unique (different UUIDs), so handler runs each time
      expect(callCount).toBe(count);
      // But only 10,000 IDs are retained after eviction
      expect(bus.getSeenIdsCount()).toBe(10_000);
    });
  });

  // ── Handler invocation count ───────────────────────────

  describe("Handler invocation", () => {
    it("delivers each message to subscribed handler exactly once", async () => {
      let callCount = 0;
      bus.subscribe("task.request", async () => {
        callCount++;
      });

      await bus.publish("task.request", { a: 1 }, sender);
      await bus.publish("task.request", { b: 2 }, sender);
      await bus.publish("task.request", { c: 3 }, sender);

      expect(callCount).toBe(3);
    });

    it("does not deliver to handlers on other channels", async () => {
      let heartbeatCount = 0;
      let taskCount = 0;

      bus.subscribe("heartbeat", async () => { heartbeatCount++; });
      bus.subscribe("task.request", async () => { taskCount++; });

      await bus.publish("heartbeat", { ping: true }, sender);
      await bus.publish("heartbeat", { ping: true }, sender);

      expect(heartbeatCount).toBe(2);
      expect(taskCount).toBe(0);
    });
  });

  // ── Large batch correctness ────────────────────────────

  describe("Large batch correctness", () => {
    it("correctly tracks 5,000 publishes without eviction", async () => {
      for (let i = 0; i < 5_000; i++) {
        await bus.publish("heartbeat", { i }, sender);
      }
      expect(bus.getSeenIdsCount()).toBe(5_000);
    });

    it("correctly handles eviction boundary at exactly 10,000", async () => {
      // Publish exactly 10,000 — no eviction yet
      for (let i = 0; i < 10_000; i++) {
        await bus.publish("heartbeat", { i }, sender);
      }
      expect(bus.getSeenIdsCount()).toBe(10_000);

      // One more triggers eviction
      await bus.publish("heartbeat", { i: 10_000 }, sender);
      expect(bus.getSeenIdsCount()).toBe(10_000); // still 10,000 after eviction
    });
  });
});
