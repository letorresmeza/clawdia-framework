# Getting Started with Clawdia Framework

Build your first multi-agent system in five minutes.

## Prerequisites

- Node.js 20+
- pnpm 9+

## Installation

```bash
git clone https://github.com/letorresmeza/clawdia-framework.git
cd clawdia-framework
pnpm install
pnpm build
```

## Step 1 — Write your first soul.md

Every agent starts with a manifest. Create `my-agent/soul.md`:

```yaml
version: "2.0"
kind: AgentManifest

identity:
  name: greeter
  display_name: "Greeter"
  description: "A simple greeting agent"
  version: "1.0.0"
  operator: "my-org"

capabilities:
  provides:
    - taxonomy: social.greeting
      description: "Greet a person by name"
      input_schema:
        type: object
        properties:
          name: { type: string }
        required: ["name"]
      output_schema:
        type: object
        properties:
          message: { type: string }
      sla:
        max_latency_ms: 1000
        availability: 0.99
      pricing:
        model: per_request
        amount: 0.001
        currency: USDC

runtime:
  model: "claude-haiku-4-5"
  memory_mb: 256
```

## Step 2 — Spawn the agent with the SDK

Create `my-agent/index.ts`:

```typescript
import { readFileSync } from "fs";
import { InMemoryBus } from "@clawdia/core";
import { ServiceRegistry, ContractEngine } from "@clawdia/orchestrator";  // if sharing
import { createAgent } from "@clawdia/sdk";

// 1. Connect to the bus
const bus = new InMemoryBus();
await bus.connect();

// 2. Create shared infrastructure
const registry = new ServiceRegistry(bus);
const contracts = new ContractEngine(bus);

// 3. Spawn the agent
const greeter = await createAgent({
  soulMd: readFileSync("soul.md", "utf-8"),
  bus,
  registry,
  contracts,
  async onTask({ input, ctx }) {
    const { name } = input as { name: string };
    ctx.log(`Greeting ${name}`);
    return { message: `Hello, ${name}! Welcome to the Clawdia network.` };
  },
});

console.log("Greeter online:", greeter.identity.name);
```

Run it:

```bash
pnpm tsx my-agent/index.ts
```

## Step 3 — Hire the agent from another agent

Add a client that hires the greeter:

```typescript
// client.ts
const result = await greeter.hire({
  agentName: "greeter",
  capability: "social.greeting",
  input: { name: "Alice" },
  payment: { amount: 0.001, currency: "USDC" },
});

console.log(result.output);
// { message: "Hello, Alice! Welcome to the Clawdia network." }
```

## Step 4 — Run the full quickstart example

The repo includes a ready-to-run two-agent example:

```bash
pnpm tsx examples/quickstart.ts
```

This spawns a greeter and a coordinator, runs a full hire → deliver → settle workflow, and prints the result.

## Step 5 — Explore the full demo

```bash
pnpm --filter @clawdia/demo start
```

A coordinator hires 5 specialist agents (research, data analysis, content writing, code building, market analysis) to complete a multi-step product launch workflow — showing the full economy in action.

## Project Layout

```
clawdia-framework/
  packages/
    types/          Shared TypeScript types and plugin interfaces
    core/           Identity, ClawBus, ContractEngine, RiskEngine
    orchestrator/   ServiceRegistry, AgentSpawner
    economy/        ReputationEngine, InMemoryEscrow, BillingEngine
    sdk/            createAgent(), definePlugin() developer helpers
  plugins/
    runtime-docker/ Docker-based agent runtime provider
    agent-claude/   Claude agent adapter
    agent-openai/   OpenAI agent adapter
    data-mcp/       MCP data connector
    notifier-slack/ Slack notifier
    settlement-evm/ EVM on-chain settlement
  apps/
    cli/            clawdia CLI (publish, search, hire, spawn, status)
    dashboard/      Next.js monitoring dashboard
  examples/
    quickstart.ts   Two-agent quickstart
    research-agent/ soul.md + implementation
    data-analyst/   soul.md + implementation
    content-writer/ soul.md + implementation
    demo/           Full multi-agent workflow
```

## Next Steps

- [Building Plugins](./building-plugins.md) — Create your own agent adapter, runtime, or data connector
- [soul.md Specification](./soul-md-spec.md) — Full manifest format reference
- [Architecture](./architecture.md) — How the four layers fit together
- [API Reference](./api-reference.md) — Full API documentation for all packages
