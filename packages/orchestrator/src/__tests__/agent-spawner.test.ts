import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AgentSpawner } from "../spawner/agent-spawner.js";
import { InMemoryBus } from "@clawdia/core";
import type { AgentIdentity, IRuntimeProvider, RuntimeHandle } from "@clawdia/types";

function makeIdentity(name: string): AgentIdentity {
  return {
    name,
    displayName: name,
    description: `Test agent ${name}`,
    version: "1.0.0",
    operator: "test-operator",
    publicKey: `key-${name}`,
    capabilities: [],
    requirements: [],
    runtime: { image: "node:20-slim", memoryMb: 256, cpus: 0.5 },
  };
}

function makeRuntime(alive = true): IRuntimeProvider {
  return {
    name: "mock-runtime",
    async spawn(opts) {
      return { id: `container-${opts.name}`, name: opts.name, runtime: "mock" };
    },
    async destroy(_handle: RuntimeHandle) {},
    async exec(_handle: RuntimeHandle) {
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    logs(_handle: RuntimeHandle): AsyncIterable<string> {
      return (async function* () {})();
    },
    async healthCheck(_handle: RuntimeHandle) {
      return { alive, uptime: 1000 };
    },
  };
}

describe("AgentSpawner", () => {
  let bus: InMemoryBus;
  let spawner: AgentSpawner;

  beforeEach(async () => {
    bus = new InMemoryBus();
    await bus.connect();
    // Use a very large heartbeat interval so timers don't fire during tests
    spawner = new AgentSpawner(makeRuntime(), bus, { heartbeatIntervalMs: 2_147_483_647 });
  });

  afterEach(async () => {
    await spawner.destroyAll();
    await bus.disconnect();
  });

  describe("spawn()", () => {
    it("creates a running session", async () => {
      const identity = makeIdentity("worker-1");
      const session = await spawner.spawn({ identity });

      expect(session.id).toBeDefined();
      expect(session.identity.name).toBe("worker-1");
      expect(session.state).toBe("running");
      expect(session.tasksCompleted).toBe(0);
      expect(session.activeContracts).toEqual([]);
    });

    it("spawned session appears in list()", async () => {
      const identity = makeIdentity("worker-2");
      const session = await spawner.spawn({ identity });

      const all = spawner.list();
      expect(all.length).toBe(1);
      expect(all[0]!.id).toBe(session.id);
    });

    it("publishes heartbeat on spawn", async () => {
      const messages: unknown[] = [];
      bus.subscribe("heartbeat", async (msg) => { messages.push(msg.payload); });

      await spawner.spawn({ identity: makeIdentity("hb-worker") });

      await new Promise((r) => setTimeout(r, 5));
      expect(messages.length).toBeGreaterThan(0);
    });

    it("spawns multiple agents independently", async () => {
      await spawner.spawn({ identity: makeIdentity("a") });
      await spawner.spawn({ identity: makeIdentity("b") });
      await spawner.spawn({ identity: makeIdentity("c") });

      expect(spawner.list().length).toBe(3);
    });
  });

  describe("get()", () => {
    it("returns session by id", async () => {
      const session = await spawner.spawn({ identity: makeIdentity("getter") });
      const fetched = spawner.get(session.id);
      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(session.id);
    });

    it("returns undefined for unknown id", () => {
      expect(spawner.get("nonexistent")).toBeUndefined();
    });
  });

  describe("kill()", () => {
    it("marks session as dead", async () => {
      const session = await spawner.spawn({ identity: makeIdentity("mortal") });
      await spawner.kill(session.id);

      const fetched = spawner.get(session.id);
      expect(fetched!.state).toBe("dead");
    });

    it("is idempotent for unknown session", async () => {
      await expect(spawner.kill("ghost")).resolves.toBeUndefined();
    });
  });

  describe("pause() / resume()", () => {
    it("pauses a running session", async () => {
      const session = await spawner.spawn({ identity: makeIdentity("pausable") });
      spawner.pause(session.id);
      expect(spawner.get(session.id)!.state).toBe("paused");
    });

    it("resumes a paused session", async () => {
      const session = await spawner.spawn({ identity: makeIdentity("resumable") });
      spawner.pause(session.id);
      spawner.resume(session.id);
      expect(spawner.get(session.id)!.state).toBe("running");
    });

    it("pause is no-op for non-running session", async () => {
      const session = await spawner.spawn({ identity: makeIdentity("dead-pause") });
      await spawner.kill(session.id);
      spawner.pause(session.id); // should not error or change state
      expect(spawner.get(session.id)!.state).toBe("dead");
    });

    it("resume is no-op for non-paused session", async () => {
      const session = await spawner.spawn({ identity: makeIdentity("no-resume") });
      spawner.resume(session.id); // already running, no-op
      expect(spawner.get(session.id)!.state).toBe("running");
    });
  });

  describe("list()", () => {
    it("filters by state", async () => {
      const s1 = await spawner.spawn({ identity: makeIdentity("f1") });
      const s2 = await spawner.spawn({ identity: makeIdentity("f2") });
      await spawner.spawn({ identity: makeIdentity("f3") });

      spawner.pause(s1.id);
      await spawner.kill(s2.id);

      expect(spawner.list({ state: "running" }).length).toBe(1);
      expect(spawner.list({ state: "paused" }).length).toBe(1);
      expect(spawner.list({ state: "dead" }).length).toBe(1);
    });
  });

  describe("destroyAll()", () => {
    it("kills all sessions", async () => {
      await spawner.spawn({ identity: makeIdentity("d1") });
      await spawner.spawn({ identity: makeIdentity("d2") });
      await spawner.spawn({ identity: makeIdentity("d3") });

      await spawner.destroyAll();

      const alive = spawner.list().filter((s) => s.state !== "dead");
      expect(alive.length).toBe(0);
    });
  });

  describe("health monitoring (dead container)", () => {
    it("marks session dead and emits risk.alert when container dies", async () => {
      vi.useFakeTimers();

      let alive = true;
      const flappyRuntime: IRuntimeProvider = {
        name: "flappy",
        async spawn(opts) {
          return { id: `c-${opts.name}`, name: opts.name, runtime: "flappy" };
        },
        async destroy() {},
        async exec() { return { stdout: "", stderr: "", exitCode: 0 }; },
        logs(): AsyncIterable<string> { return (async function* () {})(); },
        async healthCheck() { return { alive, uptime: alive ? 100 : 0 }; },
      };

      const alerts: unknown[] = [];
      bus.subscribe("risk.alert", async (msg) => { alerts.push(msg.payload); });

      const flappySpawner = new AgentSpawner(flappyRuntime, bus, { heartbeatIntervalMs: 10 });
      const session = await flappySpawner.spawn({ identity: makeIdentity("flappy-agent") });

      // Container dies
      alive = false;

      // Advance timer past heartbeat interval
      await vi.advanceTimersByTimeAsync(50);

      expect(flappySpawner.get(session.id)!.state).toBe("dead");
      expect(alerts.length).toBeGreaterThan(0);

      await flappySpawner.destroyAll();
      vi.useRealTimers();
    });
  });
});
