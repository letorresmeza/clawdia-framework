import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { InMemoryBus, ContractEngine } from "@clawdia/core";
import { ServiceRegistry } from "@clawdia/orchestrator";
import { createAgent, createWorkflowAgent, definePlugin } from "../index.js";
import type { AgentTask } from "../index.js";

// ─────────────────────────────────────────────────────────
// soul.md fixtures
// ─────────────────────────────────────────────────────────

const GREETER_SOUL = `
version: "2.0"
kind: AgentManifest
identity:
  name: greeter-agent
  display_name: "Greeter"
  description: "Greets people"
  version: "1.0.0"
  operator: "test"
capabilities:
  provides:
    - taxonomy: social.greeting
      description: "Say hello"
      input_schema:
        type: object
        properties:
          name: { type: string }
      output_schema:
        type: object
        properties:
          message: { type: string }
      sla:
        max_latency_ms: 1000
        availability: 0.99
      pricing:
        model: per_request
        amount: 0.01
        currency: USDC
runtime:
  model: test-model
`;

const SUMMARIZER_SOUL = `
version: "2.0"
kind: AgentManifest
identity:
  name: summarizer-agent
  display_name: "Summarizer"
  description: "Summarizes text"
  version: "1.0.0"
  operator: "test"
capabilities:
  provides:
    - taxonomy: nlp.summarize
      description: "Summarize a document"
      input_schema:
        type: object
        properties:
          text: { type: string }
      output_schema:
        type: object
        properties:
          summary: { type: string }
      sla:
        max_latency_ms: 5000
        availability: 0.99
      pricing:
        model: per_request
        amount: 0.05
        currency: USDC
runtime:
  model: test-model
`;

const ORCHESTRATOR_SOUL = `
version: "2.0"
kind: AgentManifest
identity:
  name: orchestrator-agent
  display_name: "Orchestrator"
  description: "Coordinates other agents"
  version: "1.0.0"
  operator: "test"
capabilities:
  provides:
    - taxonomy: orchestration.pipeline
      description: "Run multi-agent pipelines"
      input_schema: { type: object }
      output_schema: { type: object }
      sla:
        max_latency_ms: 30000
        availability: 0.99
      pricing:
        model: per_request
        amount: 0.10
        currency: USDC
runtime:
  model: test-model
`;

// ─────────────────────────────────────────────────────────
// Shared setup
// ─────────────────────────────────────────────────────────

let bus: InMemoryBus;
let registry: ServiceRegistry;
let contracts: ContractEngine;

beforeEach(async () => {
  bus = new InMemoryBus();
  await bus.connect();
  registry = new ServiceRegistry(bus);
  contracts = new ContractEngine(bus);
});

afterEach(async () => {
  registry.destroy();
  await bus.disconnect();
});

// ─────────────────────────────────────────────────────────
// createAgent() — basic registration
// ─────────────────────────────────────────────────────────

describe("createAgent()", () => {
  it("registers the agent in the service registry", async () => {
    const handle = await createAgent({
      soulMd: GREETER_SOUL,
      bus,
      registry,
      contracts,
    });

    const entry = registry.get("greeter-agent");
    expect(entry).toBeDefined();
    expect(entry!.identity.name).toBe("greeter-agent");
    expect(entry!.status).toBe("online");

    await handle.stop();
  });

  it("returns an AgentHandle with the correct identity", async () => {
    const handle = await createAgent({
      soulMd: GREETER_SOUL,
      bus,
      registry,
      contracts,
    });

    expect(handle.identity.name).toBe("greeter-agent");
    expect(handle.identity.displayName).toBe("Greeter");
    expect(handle.identity.capabilities[0]!.taxonomy).toBe("social.greeting");

    await handle.stop();
  });

  it("stop() deregisters the agent from the registry", async () => {
    const handle = await createAgent({
      soulMd: GREETER_SOUL,
      bus,
      registry,
      contracts,
    });

    expect(registry.get("greeter-agent")).toBeDefined();
    await handle.stop();
    expect(registry.get("greeter-agent")).toBeUndefined();
  });

  it("throws on invalid soul.md", async () => {
    await expect(
      createAgent({
        soulMd: "not valid yaml at all: [broken",
        bus,
        registry,
        contracts,
      }),
    ).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────
// createAgent() — onTask handler
// ─────────────────────────────────────────────────────────

describe("onTask handler", () => {
  it("handles an incoming task and delivers output", async () => {
    const greeter = await createAgent({
      soulMd: GREETER_SOUL,
      bus,
      registry,
      contracts,
      async onTask({ input }) {
        const { name } = input as { name: string };
        return { message: `Hello, ${name}!` };
      },
    });

    // Act as requester — drive the contract lifecycle directly
    const contract = contracts.create({
      requester: greeter.identity, // self-hire for simplicity
      provider: greeter.identity,
      capability: "social.greeting",
      inputSchema: {},
      outputSchema: {},
      input: { name: "World" },
      payment: { amount: 0.01, currency: "USDC" },
      sla: { deadlineMs: 5000, maxRetries: 1 },
      verification: { method: "schema_match" },
    });

    await contracts.transition(contract.id, "OFFER", greeter.identity.name);
    await contracts.transition(contract.id, "ACCEPT", greeter.identity.name);
    await contracts.transition(contract.id, "FUND", greeter.identity.name);

    // The onTask handler runs synchronously via InMemoryBus
    const settled = contracts.get(contract.id)!;
    expect(settled.state).toBe("delivered");
    expect(settled.output).toEqual({ message: "Hello, World!" });

    await greeter.stop();
  });

  it("calls onError and transitions to FAIL when handler throws", async () => {
    const errors: Error[] = [];
    const agent = await createAgent({
      soulMd: GREETER_SOUL,
      bus,
      registry,
      contracts,
      async onTask() {
        throw new Error("Intentional failure");
      },
      onError: (err) => errors.push(err),
    });

    const contract = contracts.create({
      requester: agent.identity,
      provider: agent.identity,
      capability: "social.greeting",
      inputSchema: {},
      outputSchema: {},
      payment: { amount: 0.01, currency: "USDC" },
      sla: { deadlineMs: 5000, maxRetries: 1 },
      verification: { method: "schema_match" },
    });

    await contracts.transition(contract.id, "OFFER", agent.identity.name);
    await contracts.transition(contract.id, "ACCEPT", agent.identity.name);
    await contracts.transition(contract.id, "FUND", agent.identity.name);

    expect(contracts.get(contract.id)!.state).toBe("disputed");
    expect(errors.length).toBe(1);
    expect(errors[0]!.message).toBe("Intentional failure");

    await agent.stop();
  });

  it("only handles contracts where this agent is the provider", async () => {
    const tasksHandled: string[] = [];

    const greeter = await createAgent({
      soulMd: GREETER_SOUL,
      bus,
      registry,
      contracts,
      async onTask({ contract }) {
        tasksHandled.push(contract.id);
        return { message: "hi" };
      },
    });

    const summarizer = await createAgent({
      soulMd: SUMMARIZER_SOUL,
      bus,
      registry,
      contracts,
      async onTask() {
        return { summary: "short" };
      },
    });

    // Hire summarizer — greeter's handler should NOT fire
    const contract = contracts.create({
      requester: greeter.identity,
      provider: summarizer.identity,
      capability: "nlp.summarize",
      inputSchema: {},
      outputSchema: {},
      input: { text: "long text" },
      payment: { amount: 0.05, currency: "USDC" },
      sla: { deadlineMs: 5000, maxRetries: 1 },
      verification: { method: "schema_match" },
    });

    await contracts.transition(contract.id, "OFFER", greeter.identity.name);
    await contracts.transition(contract.id, "ACCEPT", summarizer.identity.name);
    await contracts.transition(contract.id, "FUND", greeter.identity.name);

    expect(tasksHandled).toHaveLength(0);
    expect(contracts.get(contract.id)!.state).toBe("delivered");

    await greeter.stop();
    await summarizer.stop();
  });
});

describe("createWorkflowAgent()", () => {
  it("composes multiple agents into a workflow agent", async () => {
    const greeter = await createAgent({
      soulMd: GREETER_SOUL,
      bus,
      registry,
      contracts,
      async onTask({ input }) {
        const { name } = input as { name: string };
        return { message: `Hello, ${name}!` };
      },
    });

    const summarizer = await createAgent({
      soulMd: SUMMARIZER_SOUL,
      bus,
      registry,
      contracts,
      async onTask({ input }) {
        const { message } = input as { message: string };
        return { summary: message.slice(0, 5) };
      },
    });

    const workflow = await createWorkflowAgent({
      soulMd: ORCHESTRATOR_SOUL,
      bus,
      registry,
      contracts,
      steps: [
        {
          agentName: "greeter-agent",
          capability: "social.greeting",
          payment: { amount: 0.01, currency: "USDC" },
        },
        {
          agentName: "summarizer-agent",
          capability: "nlp.summarize",
          payment: { amount: 0.05, currency: "USDC" },
          mapInput: (_input, results) => results[0]?.output,
        },
      ],
    });

    const result = await workflow.hire({
      agentName: "orchestrator-agent",
      capability: "orchestration.pipeline",
      input: { name: "World" },
      payment: { amount: 0.1, currency: "USDC" },
    });

    expect(result.output).toMatchObject({
      finalOutput: { summary: "Hello" },
    });

    await workflow.stop();
    await summarizer.stop();
    await greeter.stop();
  });
});

// ─────────────────────────────────────────────────────────
// AgentHandle.hire() — full lifecycle
// ─────────────────────────────────────────────────────────

describe("AgentHandle.hire()", () => {
  it("completes the full contract lifecycle and returns output", async () => {
    const summarizer = await createAgent({
      soulMd: SUMMARIZER_SOUL,
      bus,
      registry,
      contracts,
      async onTask({ input }) {
        const { text } = input as { text: string };
        return { summary: text.slice(0, 20) + "..." };
      },
    });

    const orchestrator = await createAgent({
      soulMd: ORCHESTRATOR_SOUL,
      bus,
      registry,
      contracts,
    });

    const result = await orchestrator.hire({
      agentName: "summarizer-agent",
      capability: "nlp.summarize",
      input: { text: "This is a very long document that needs summarizing." },
      payment: { amount: 0.05, currency: "USDC" },
    });

    expect((result.output as { summary: string }).summary).toMatch(/^This is a very long/);
    expect(result.contractId).toBeDefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Contract should be settled
    const settled = contracts.get(result.contractId)!;
    expect(settled.state).toBe("settled");

    await summarizer.stop();
    await orchestrator.stop();
  });

  it("throws when hiring a non-existent agent", async () => {
    const orchestrator = await createAgent({
      soulMd: ORCHESTRATOR_SOUL,
      bus,
      registry,
      contracts,
    });

    await expect(
      orchestrator.hire({
        agentName: "ghost-agent",
        capability: "ghost.capability",
        input: {},
        payment: { amount: 1, currency: "USDC" },
        sla: { deadlineMs: 100, maxRetries: 0 },
      }),
    ).rejects.toThrow(/not found in registry/);

    await orchestrator.stop();
  });

  it("throws when hiring with an unsupported capability", async () => {
    const greeter = await createAgent({
      soulMd: GREETER_SOUL,
      bus,
      registry,
      contracts,
    });

    const orchestrator = await createAgent({
      soulMd: ORCHESTRATOR_SOUL,
      bus,
      registry,
      contracts,
    });

    await expect(
      orchestrator.hire({
        agentName: "greeter-agent",
        capability: "nonexistent.capability",
        input: {},
        payment: { amount: 1, currency: "USDC" },
        sla: { deadlineMs: 100, maxRetries: 0 },
      }),
    ).rejects.toThrow(/does not provide/);

    await greeter.stop();
    await orchestrator.stop();
  });

  it("propagates provider failure as a rejected promise", async () => {
    const failAgent = await createAgent({
      soulMd: GREETER_SOUL,
      bus,
      registry,
      contracts,
      async onTask() {
        throw new Error("Provider unavailable");
      },
      onError: () => {}, // suppress console output
    });

    const orchestrator = await createAgent({
      soulMd: ORCHESTRATOR_SOUL,
      bus,
      registry,
      contracts,
    });

    await expect(
      orchestrator.hire({
        agentName: "greeter-agent",
        capability: "social.greeting",
        input: { name: "Test" },
        payment: { amount: 0.01, currency: "USDC" },
        sla: { deadlineMs: 5000, maxRetries: 1 },
      }),
    ).rejects.toThrow(/failed/);

    await failAgent.stop();
    await orchestrator.stop();
  });
});

// ─────────────────────────────────────────────────────────
// AgentHandle.discover()
// ─────────────────────────────────────────────────────────

describe("AgentHandle.discover()", () => {
  it("finds agents by exact taxonomy", async () => {
    const greeter = await createAgent({ soulMd: GREETER_SOUL, bus, registry, contracts });
    const summarizer = await createAgent({ soulMd: SUMMARIZER_SOUL, bus, registry, contracts });
    const orchestrator = await createAgent({ soulMd: ORCHESTRATOR_SOUL, bus, registry, contracts });

    const results = orchestrator.discover("social.greeting");
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe("greeter-agent");

    await greeter.stop();
    await summarizer.stop();
    await orchestrator.stop();
  });

  it("finds agents with wildcard taxonomy", async () => {
    const greeter = await createAgent({ soulMd: GREETER_SOUL, bus, registry, contracts });
    const summarizer = await createAgent({ soulMd: SUMMARIZER_SOUL, bus, registry, contracts });

    const results = greeter.discover("nlp.*");
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe("summarizer-agent");

    await greeter.stop();
    await summarizer.stop();
  });
});

// ─────────────────────────────────────────────────────────
// definePlugin()
// ─────────────────────────────────────────────────────────

describe("definePlugin()", () => {
  it("returns the module unchanged", () => {
    const module = definePlugin({
      name: "test-plugin",
      type: "notifier",
      version: "1.0.0",
      create: () => ({ send: async () => {}, sendBatch: async () => {} }),
    });

    expect(module.name).toBe("test-plugin");
    expect(module.type).toBe("notifier");
    expect(module.version).toBe("1.0.0");
    expect(typeof module.create).toBe("function");
  });

  it("enforces PluginModule shape at compile time (runtime smoke test)", () => {
    const plugin = definePlugin({
      name: "runtime-stub",
      type: "runtime",
      create: () => ({
        name: "stub",
        async spawn() {
          return { id: "x", name: "x", runtime: "stub" };
        },
        async destroy() {},
        async exec() {
          return { stdout: "", stderr: "", exitCode: 0 };
        },
        logs(): AsyncIterable<string> {
          return (async function* () {})();
        },
        async healthCheck() {
          return { alive: true, uptime: 0 };
        },
      }),
    });

    expect(plugin.type).toBe("runtime");
  });
});

// ─────────────────────────────────────────────────────────
// Multi-agent pipeline integration
// ─────────────────────────────────────────────────────────

describe("multi-agent pipeline", () => {
  it("orchestrator hires two agents sequentially", async () => {
    const log: string[] = [];

    const greeter = await createAgent({
      soulMd: GREETER_SOUL,
      bus,
      registry,
      contracts,
      async onTask({ input }) {
        const { name } = input as { name: string };
        return { message: `Hello, ${name}!` };
      },
    });

    const summarizer = await createAgent({
      soulMd: SUMMARIZER_SOUL,
      bus,
      registry,
      contracts,
      async onTask({ input }) {
        const { text } = input as { text: string };
        return { summary: `Summary: ${text.slice(0, 10)}` };
      },
    });

    const orchestrator = await createAgent({
      soulMd: ORCHESTRATOR_SOUL,
      bus,
      registry,
      contracts,
      async onTask({ ctx }) {
        const greet = await ctx.hire({
          agentName: "greeter-agent",
          capability: "social.greeting",
          input: { name: "Clawdia" },
          payment: { amount: 0.01, currency: "USDC" },
        });
        log.push((greet.output as { message: string }).message);

        const sum = await ctx.hire({
          agentName: "summarizer-agent",
          capability: "nlp.summarize",
          input: { text: "The autonomous economy is emerging." },
          payment: { amount: 0.05, currency: "USDC" },
        });
        log.push((sum.output as { summary: string }).summary);

        return { steps: log.length };
      },
    });

    // Trigger the orchestrator itself
    const contract = contracts.create({
      requester: orchestrator.identity,
      provider: orchestrator.identity,
      capability: "orchestration.pipeline",
      inputSchema: {},
      outputSchema: {},
      payment: { amount: 0.1, currency: "USDC" },
      sla: { deadlineMs: 15_000, maxRetries: 1 },
      verification: { method: "schema_match" },
    });

    await contracts.transition(contract.id, "OFFER", orchestrator.identity.name);
    await contracts.transition(contract.id, "ACCEPT", orchestrator.identity.name);
    await contracts.transition(contract.id, "FUND", orchestrator.identity.name);

    expect(log).toEqual(["Hello, Clawdia!", "Summary: The autono"]);
    expect(contracts.get(contract.id)!.state).toBe("delivered");

    await greeter.stop();
    await summarizer.stop();
    await orchestrator.stop();
  });
});
