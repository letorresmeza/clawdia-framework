import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ServiceRegistry } from "../registry/service-registry.js";
import { InMemoryBus } from "@clawdia/core";
import type { AgentIdentity } from "@clawdia/types";

function makeIdentity(name: string, overrides?: Partial<AgentIdentity>): AgentIdentity {
  return {
    name,
    displayName: name,
    description: `Test agent ${name}`,
    version: "1.0.0",
    operator: "test-operator",
    publicKey: `key-${name}`,
    capabilities: [
      {
        taxonomy: "test.capability",
        description: "A capability",
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        sla: { maxLatencyMs: 1000, availability: 0.99 },
        pricing: { model: "per_request", amount: 1.0, currency: "USDC" },
      },
    ],
    requirements: [],
    runtime: {},
    ...overrides,
  };
}

describe("ServiceRegistry", () => {
  let registry: ServiceRegistry;
  let bus: InMemoryBus;

  beforeEach(async () => {
    bus = new InMemoryBus();
    await bus.connect();
    registry = new ServiceRegistry(bus, {
      healthCheckIntervalMs: 30_000,
      deregisterAfterMs: 120_000,
    });
  });

  afterEach(() => {
    registry.destroy();
  });

  describe("register / deregister", () => {
    it("registers an agent and returns it via get()", () => {
      const identity = makeIdentity("agent-a");
      registry.register(identity, "session-1");
      const entry = registry.get("agent-a");
      expect(entry).toBeDefined();
      expect(entry!.identity.name).toBe("agent-a");
      expect(entry!.status).toBe("online");
      expect(entry!.sessionId).toBe("session-1");
    });

    it("deregisters an agent", () => {
      const identity = makeIdentity("agent-b");
      registry.register(identity);
      expect(registry.get("agent-b")).toBeDefined();
      const removed = registry.deregister("agent-b");
      expect(removed).toBe(true);
      expect(registry.get("agent-b")).toBeUndefined();
    });

    it("deregister returns false for unknown agent", () => {
      expect(registry.deregister("nobody")).toBe(false);
    });

    it("publishes registry.update on register", async () => {
      const messages: unknown[] = [];
      bus.subscribe("registry.update", async (msg) => {
        messages.push(msg.payload);
      });

      const identity = makeIdentity("agent-c");
      registry.register(identity);

      // Give async publish a tick
      await new Promise((r) => setTimeout(r, 0));
      expect(messages.length).toBeGreaterThan(0);
    });
  });

  describe("list()", () => {
    it("returns all registered agents", () => {
      registry.register(makeIdentity("x"));
      registry.register(makeIdentity("y"));
      registry.register(makeIdentity("z"));
      const all = registry.list();
      expect(all.length).toBe(3);
    });
  });

  describe("heartbeat()", () => {
    it("updates lastSeen timestamp", async () => {
      registry.register(makeIdentity("hb-agent"));
      const before = registry.get("hb-agent")!.lastSeen;
      await new Promise((r) => setTimeout(r, 5));
      registry.heartbeat("hb-agent");
      const after = registry.get("hb-agent")!.lastSeen;
      expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
    });

    it("revives offline agent to online", () => {
      registry.register(makeIdentity("sleeping"));
      registry.setStatus("sleeping", "offline");
      expect(registry.get("sleeping")!.status).toBe("offline");
      registry.heartbeat("sleeping");
      expect(registry.get("sleeping")!.status).toBe("online");
    });

    it("silently ignores unknown agent", () => {
      expect(() => registry.heartbeat("ghost")).not.toThrow();
    });
  });

  describe("setStatus()", () => {
    it("changes agent status", () => {
      registry.register(makeIdentity("busy-agent"));
      registry.setStatus("busy-agent", "busy");
      expect(registry.get("busy-agent")!.status).toBe("busy");
    });

    it("silently ignores unknown agent", () => {
      expect(() => registry.setStatus("ghost", "busy")).not.toThrow();
    });
  });

  describe("discover()", () => {
    beforeEach(() => {
      registry.register(
        makeIdentity("coder", {
          capabilities: [
            {
              taxonomy: "code.write.typescript",
              description: "Write TypeScript",
              inputSchema: {},
              outputSchema: {},
              sla: { maxLatencyMs: 5000, availability: 0.99 },
              pricing: { model: "per_request", amount: 2.0, currency: "USDC" },
            },
          ],
        }),
      );
      registry.register(
        makeIdentity("analyst", {
          capabilities: [
            {
              taxonomy: "data.analysis",
              description: "Analyze data",
              inputSchema: {},
              outputSchema: {},
              sla: { maxLatencyMs: 10_000, availability: 0.95 },
              pricing: { model: "per_request", amount: 0.5, currency: "ETH" },
            },
          ],
        }),
      );
      registry.register(
        makeIdentity("cheapcoder", {
          capabilities: [
            {
              taxonomy: "code.write.python",
              description: "Write Python",
              inputSchema: {},
              outputSchema: {},
              sla: { maxLatencyMs: 3000, availability: 0.98 },
              pricing: { model: "per_request", amount: 0.1, currency: "USDC" },
            },
          ],
        }),
      );
    });

    it("discovers all online agents with empty query", () => {
      const { entries, total } = registry.discover({});
      expect(total).toBe(3);
      expect(entries.length).toBe(3);
    });

    it("filters by exact taxonomy", () => {
      const { entries } = registry.discover({ taxonomy: "data.analysis" });
      expect(entries.length).toBe(1);
      expect(entries[0]!.identity.name).toBe("analyst");
    });

    it("filters by wildcard taxonomy prefix", () => {
      const { entries } = registry.discover({ taxonomy: "code.*" });
      expect(entries.length).toBe(2);
      const names = entries.map((e) => e.identity.name);
      expect(names).toContain("coder");
      expect(names).toContain("cheapcoder");
    });

    it("filters by maxPrice", () => {
      const { entries } = registry.discover({ maxPrice: 1.0 });
      // cheapcoder (0.1) and analyst (0.5) qualify; coder (2.0) does not
      expect(entries.length).toBe(2);
    });

    it("filters by currency", () => {
      const { entries } = registry.discover({ currency: "ETH" });
      expect(entries.length).toBe(1);
      expect(entries[0]!.identity.name).toBe("analyst");
    });

    it("filters by minReputation", () => {
      // Give coder a reputation score
      const entry = registry.get("coder")!;
      entry.identity.reputation = {
        registry: "test",
        score: 0.9,
        minimumStake: 0,
        dimensions: { reliability: 0.9, quality: 0.9, speed: 0.9, costEfficiency: 0.9 },
        attestations: [],
      };
      registry.register(entry.identity); // re-register with reputation

      const { entries } = registry.discover({ minReputation: 0.8 });
      expect(entries.length).toBe(1);
      expect(entries[0]!.identity.name).toBe("coder");
    });

    it("respects limit", () => {
      const { entries, total } = registry.discover({ limit: 2 });
      expect(total).toBe(3);
      expect(entries.length).toBe(2);
    });

    it("excludes offline agents by default", () => {
      registry.setStatus("analyst", "offline");
      const { entries } = registry.discover({});
      expect(entries.every((e) => e.status !== "offline")).toBe(true);
    });

    it("includes offline agents when onlineOnly: false", () => {
      registry.setStatus("analyst", "offline");
      const { entries } = registry.discover({ onlineOnly: false });
      expect(entries.some((e) => e.status === "offline")).toBe(true);
    });
  });

  describe("stats()", () => {
    it("counts agents by status", () => {
      registry.register(makeIdentity("s1"));
      registry.register(makeIdentity("s2"));
      registry.register(makeIdentity("s3"));
      registry.setStatus("s2", "offline");
      registry.setStatus("s3", "busy");

      const stats = registry.stats();
      expect(stats["online"]).toBe(1);
      expect(stats["offline"]).toBe(1);
      expect(stats["busy"]).toBe(1);
    });
  });
});
