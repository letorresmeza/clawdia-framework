import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InMemoryBus, IdentityRuntime } from "@clawdia/core";
import { ServiceRegistry, AgentSpawner } from "@clawdia/orchestrator";
import { InMemoryRuntimeProvider } from "../runtime/in-memory-runtime.js";
import { registerSpawnCommand } from "../commands/spawn.js";
import { registerStatusCommand } from "../commands/status.js";
import { registerSendCommand } from "../commands/send.js";
import { registerRegistryCommand } from "../commands/registry.js";
import type { AgentIdentity, ClawMessage } from "@clawdia/types";

// ─────────────────────────────────────────────────────────
// Test soul.md fixture
// ─────────────────────────────────────────────────────────

const SOUL_MD = `
version: "2.0"
kind: AgentManifest

identity:
  name: test-agent
  display_name: "Test Agent"
  description: "An agent for testing"
  version: "1.0.0"
  operator: "test-operator"

capabilities:
  provides:
    - taxonomy: testing.unit
      description: "Run unit tests"
      input_schema: { type: object }
      output_schema: { type: object }
      sla:
        max_latency_ms: 5000
        availability: 0.99
      pricing:
        model: per_request
        amount: 0.10
        currency: USDC

runtime:
  model: "test-model"
`;

const SOUL_MD_2 = `
version: "2.0"
kind: AgentManifest

identity:
  name: another-agent
  display_name: "Another Agent"
  description: "Second test agent"
  version: "2.0.0"
  operator: "test-operator"

capabilities:
  provides:
    - taxonomy: testing.integration
      description: "Run integration tests"
      input_schema: { type: object }
      output_schema: { type: object }
      sla:
        max_latency_ms: 30000
        availability: 0.95
      pricing:
        model: per_request
        amount: 0.50
        currency: USDC

runtime:
  model: "test-model-2"
`;

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

interface TestContext {
  bus: InMemoryBus;
  identityRuntime: IdentityRuntime;
  registry: ServiceRegistry;
  spawner: AgentSpawner;
  program: Command;
  tmpDir: string;
  logs: string[];
  errors: string[];
}

function setupTestContext(): TestContext {
  const bus = new InMemoryBus();
  const identityRuntime = new IdentityRuntime();
  const runtimeProvider = new InMemoryRuntimeProvider();
  const registry = new ServiceRegistry(bus, {
    healthCheckIntervalMs: 60_000,
    deregisterAfterMs: 600_000,
  });
  const spawner = new AgentSpawner(runtimeProvider, bus, {
    heartbeatIntervalMs: 2_147_483_647,
  });

  const program = new Command();
  program.name("clawdia").exitOverride();

  registerSpawnCommand(program, { identityRuntime, registry, spawner });
  registerStatusCommand(program, { spawner, registry });
  registerSendCommand(program, { bus, spawner });
  registerRegistryCommand(program, { registry });

  const tmpDir = mkdtempSync(join(tmpdir(), "clawdia-test-"));

  const logs: string[] = [];
  const errors: string[] = [];

  return { bus, identityRuntime, registry, spawner, program, tmpDir, logs, errors };
}

async function run(ctx: TestContext, args: string[]): Promise<void> {
  await ctx.bus.connect();
  await ctx.program.parseAsync(["node", "clawdia", ...args]);
}

function writeSoulFile(ctx: TestContext, content: string, name = "soul.md"): string {
  const path = join(ctx.tmpDir, name);
  writeFileSync(path, content, "utf-8");
  return path;
}

// ─────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────

describe("CLI", () => {
  let ctx: TestContext;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    ctx = setupTestContext();
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      ctx.logs.push(args.map(String).join(" "));
    });
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      ctx.errors.push(args.map(String).join(" "));
    });
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await ctx.spawner.destroyAll();
    ctx.registry.destroy();
    await ctx.bus.disconnect();
    rmSync(ctx.tmpDir, { recursive: true, force: true });
  });

  // ─── spawn command ───

  describe("spawn", () => {
    it("registers an identity and spawns a session", async () => {
      const soulPath = writeSoulFile(ctx, SOUL_MD);
      await run(ctx, ["spawn", soulPath]);

      const output = ctx.logs.join("\n");
      expect(output).toContain("Identity registered:");
      expect(output).toContain("Test Agent");
      expect(output).toContain("Session spawned:");
      expect(output).toContain("running");

      // Verify the identity was registered
      const identity = ctx.identityRuntime.get("test-agent");
      expect(identity).toBeDefined();
      expect(identity?.displayName).toBe("Test Agent");

      // Verify the session exists
      const sessions = ctx.spawner.list();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.state).toBe("running");

      // Verify registry entry
      const entry = ctx.registry.get("test-agent");
      expect(entry).toBeDefined();
      expect(entry?.status).toBe("online");
    });

    it("errors on non-existent soul file", async () => {
      await run(ctx, ["spawn", "/tmp/nonexistent-soul.md"]);
      const output = ctx.errors.join("\n");
      expect(output).toContain("Error:");
    });

    it("errors on invalid soul.md content", async () => {
      const soulPath = writeSoulFile(ctx, "invalid yaml: [[[");
      await run(ctx, ["spawn", soulPath]);
      const output = ctx.errors.join("\n");
      expect(output).toContain("Error:");
    });

    it("errors on duplicate registration", async () => {
      const soulPath = writeSoulFile(ctx, SOUL_MD);
      await run(ctx, ["spawn", soulPath]);
      ctx.logs.length = 0;

      await run(ctx, ["spawn", soulPath]);
      const output = ctx.errors.join("\n");
      expect(output).toContain("already registered");
    });
  });

  // ─── status command ───

  describe("status", () => {
    it("shows 'No sessions found' when empty", async () => {
      await run(ctx, ["status"]);
      const output = ctx.logs.join("\n");
      expect(output).toContain("No sessions found");
    });

    it("lists spawned sessions", async () => {
      const soulPath = writeSoulFile(ctx, SOUL_MD);
      await run(ctx, ["spawn", soulPath]);
      ctx.logs.length = 0;

      await run(ctx, ["status"]);
      const output = ctx.logs.join("\n");
      expect(output).toContain("test-agent");
      expect(output).toContain("Sessions");
    });

    it("shows detailed info for a specific session", async () => {
      const soulPath = writeSoulFile(ctx, SOUL_MD);
      await run(ctx, ["spawn", soulPath]);

      const sessions = ctx.spawner.list();
      const sessionId = sessions[0]!.id;
      ctx.logs.length = 0;

      await run(ctx, ["status", sessionId]);
      const output = ctx.logs.join("\n");
      expect(output).toContain("Session Details");
      expect(output).toContain("Test Agent");
      expect(output).toContain(sessionId);
    });

    it("errors on non-existent session ID", async () => {
      await run(ctx, ["status", "nonexistent-id"]);
      const output = ctx.errors.join("\n");
      expect(output).toContain("not found");
    });

    it("shows registry stats", async () => {
      await run(ctx, ["status"]);
      const output = ctx.logs.join("\n");
      expect(output).toContain("Registry");
      expect(output).toContain("Online:");
    });

    it("filters sessions by state", async () => {
      const soulPath = writeSoulFile(ctx, SOUL_MD);
      await run(ctx, ["spawn", soulPath]);
      ctx.logs.length = 0;

      await run(ctx, ["status", "--state", "dead"]);
      const output = ctx.logs.join("\n");
      expect(output).toContain("No sessions found");
    });
  });

  // ─── send command ───

  describe("send", () => {
    it("sends a JSON message to a running session", async () => {
      const soulPath = writeSoulFile(ctx, SOUL_MD);
      await run(ctx, ["spawn", soulPath]);

      const sessions = ctx.spawner.list();
      const sessionId = sessions[0]!.id;
      ctx.logs.length = 0;

      // Subscribe to verify the message arrives
      const received: ClawMessage<unknown>[] = [];
      ctx.bus.subscribe("task.request", async (msg) => {
        received.push(msg);
      });

      await run(ctx, ["send", sessionId, '{"task":"do something"}']);
      const output = ctx.logs.join("\n");
      expect(output).toContain("Message sent");
      expect(output).toContain("test-agent");

      expect(received).toHaveLength(1);
      expect(received[0]?.payload).toEqual({ task: "do something" });
      expect(received[0]?.recipient).toBe("test-agent");
    });

    it("sends a plain text message when not valid JSON", async () => {
      const soulPath = writeSoulFile(ctx, SOUL_MD);
      await run(ctx, ["spawn", soulPath]);

      const sessions = ctx.spawner.list();
      const sessionId = sessions[0]!.id;
      ctx.logs.length = 0;

      const received: ClawMessage<unknown>[] = [];
      ctx.bus.subscribe("task.request", async (msg) => {
        received.push(msg);
      });

      await run(ctx, ["send", sessionId, "hello agent"]);
      const output = ctx.logs.join("\n");
      expect(output).toContain("Message sent");

      expect(received).toHaveLength(1);
      expect(received[0]?.payload).toEqual({ message: "hello agent" });
    });

    it("errors when session does not exist", async () => {
      await run(ctx, ["send", "nonexistent-id", "hello"]);
      const output = ctx.errors.join("\n");
      expect(output).toContain("not found");
    });

    it("errors when session is not running", async () => {
      const soulPath = writeSoulFile(ctx, SOUL_MD);
      await run(ctx, ["spawn", soulPath]);

      const sessions = ctx.spawner.list();
      const sessionId = sessions[0]!.id;
      await ctx.spawner.kill(sessionId);
      ctx.logs.length = 0;

      await run(ctx, ["send", sessionId, "hello"]);
      const output = ctx.errors.join("\n");
      expect(output).toContain("not running");
    });
  });

  // ─── registry list command ───

  describe("registry list", () => {
    it("shows 'No agents registered' when empty", async () => {
      await run(ctx, ["registry", "list"]);
      const output = ctx.logs.join("\n");
      expect(output).toContain("No agents registered");
    });

    it("lists registered agents with capabilities", async () => {
      const soulPath = writeSoulFile(ctx, SOUL_MD);
      await run(ctx, ["spawn", soulPath]);
      ctx.logs.length = 0;

      await run(ctx, ["registry", "list"]);
      const output = ctx.logs.join("\n");
      expect(output).toContain("test-agent");
      expect(output).toContain("testing.unit");
    });

    it("lists multiple agents", async () => {
      const path1 = writeSoulFile(ctx, SOUL_MD, "soul1.md");
      const path2 = writeSoulFile(ctx, SOUL_MD_2, "soul2.md");
      await run(ctx, ["spawn", path1]);
      await run(ctx, ["spawn", path2]);
      ctx.logs.length = 0;

      await run(ctx, ["registry", "list"]);
      const output = ctx.logs.join("\n");
      expect(output).toContain("test-agent");
      expect(output).toContain("another-agent");
      expect(output).toContain("Total: 2");
    });
  });

  // ─── registry discover command ───

  describe("registry discover", () => {
    it("discovers agents by exact taxonomy", async () => {
      const soulPath = writeSoulFile(ctx, SOUL_MD);
      await run(ctx, ["spawn", soulPath]);
      ctx.logs.length = 0;

      await run(ctx, ["registry", "discover", "testing.unit"]);
      const output = ctx.logs.join("\n");
      expect(output).toContain("Found 1 agent(s)");
      expect(output).toContain("test-agent");
    });

    it("discovers agents by wildcard taxonomy", async () => {
      const path1 = writeSoulFile(ctx, SOUL_MD, "soul1.md");
      const path2 = writeSoulFile(ctx, SOUL_MD_2, "soul2.md");
      await run(ctx, ["spawn", path1]);
      await run(ctx, ["spawn", path2]);
      ctx.logs.length = 0;

      await run(ctx, ["registry", "discover", "testing.*"]);
      const output = ctx.logs.join("\n");
      expect(output).toContain("Found 2 agent(s)");
      expect(output).toContain("test-agent");
      expect(output).toContain("another-agent");
    });

    it("shows no results for non-matching taxonomy", async () => {
      const soulPath = writeSoulFile(ctx, SOUL_MD);
      await run(ctx, ["spawn", soulPath]);
      ctx.logs.length = 0;

      await run(ctx, ["registry", "discover", "nonexistent.capability"]);
      const output = ctx.logs.join("\n");
      expect(output).toContain("No agents found");
    });

    it("filters by max price", async () => {
      const path1 = writeSoulFile(ctx, SOUL_MD, "soul1.md");
      const path2 = writeSoulFile(ctx, SOUL_MD_2, "soul2.md");
      await run(ctx, ["spawn", path1]);
      await run(ctx, ["spawn", path2]);
      ctx.logs.length = 0;

      // test-agent costs 0.10, another-agent costs 0.50
      await run(ctx, ["registry", "discover", "testing.*", "--max-price", "0.20"]);
      const output = ctx.logs.join("\n");
      expect(output).toContain("Found 1 agent(s)");
      expect(output).toContain("test-agent");
      expect(output).not.toContain("another-agent");
    });
  });

  // ─── registry info command ───

  describe("registry info", () => {
    it("shows detailed agent info", async () => {
      const soulPath = writeSoulFile(ctx, SOUL_MD);
      await run(ctx, ["spawn", soulPath]);
      ctx.logs.length = 0;

      await run(ctx, ["registry", "info", "test-agent"]);
      const output = ctx.logs.join("\n");
      expect(output).toContain("Test Agent");
      expect(output).toContain("test-operator");
      expect(output).toContain("testing.unit");
      expect(output).toContain("Run unit tests");
      expect(output).toContain("0.1 USDC");
    });

    it("errors on non-existent agent", async () => {
      await run(ctx, ["registry", "info", "nonexistent"]);
      const output = ctx.errors.join("\n");
      expect(output).toContain("not found");
    });
  });

  // ─── registry deregister command ───

  describe("registry deregister", () => {
    it("removes an agent from the registry", async () => {
      const soulPath = writeSoulFile(ctx, SOUL_MD);
      await run(ctx, ["spawn", soulPath]);
      ctx.logs.length = 0;

      await run(ctx, ["registry", "deregister", "test-agent"]);
      const output = ctx.logs.join("\n");
      expect(output).toContain("Deregistered:");

      // Verify it's gone
      expect(ctx.registry.get("test-agent")).toBeUndefined();
    });

    it("errors on non-existent agent", async () => {
      await run(ctx, ["registry", "deregister", "nonexistent"]);
      const output = ctx.errors.join("\n");
      expect(output).toContain("not found");
    });
  });
});
