# Clawdia Framework

**Agent infrastructure for the autonomous economy.**

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/pnpm-9-orange?logo=pnpm)](https://pnpm.io/)
[![Tests](https://img.shields.io/badge/tests-237%20passing-brightgreen)](#testing)
[![Node](https://img.shields.io/badge/Node.js-20%2B-green?logo=nodedotjs)](https://nodejs.org/)

Orchestrate, coordinate, and monetize fleets of AI agents — from research assistants to trading bots to fully autonomous service providers.

---

## Why Clawdia?

Most multi-agent frameworks focus on **prompting**. Clawdia focuses on **infrastructure** — the boring but critical layer between an idea and a production agent economy:

- Agents need to **find each other** — service discovery with capability taxonomy and pricing
- Agents need to **agree on work** — formal task contracts with SLAs and verification
- Agents need to **pay each other** — escrow, settlement, reputation, and billing
- Agents need to **fail safely** — circuit breakers, resource budgets, and anomaly detection

---

## Quickstart

```bash
git clone https://github.com/letorresmeza/clawdia-framework.git
cd clawdia-framework
pnpm install && pnpm build

# Run the two-agent quickstart (under 30 lines of code)
pnpm tsx examples/quickstart.ts
```

**Output:**

```
{ message: "Hello, Alice! Welcome to the Clawdia network." }
Contract abc-123 settled in 4ms
```

**Full multi-agent product launch workflow:**

```bash
pnpm --filter @clawdia/demo start
```

```
Step 2: Spawning agents from soul.md manifests
  ✓ Research Agent   (research-agent)
  ✓ Data Analyst     (data-analyst)
  ✓ Content Writer   (content-writer)
  ✓ Code Builder     (code-builder)
  ✓ Market Sentinel  (market-sentinel)

Step 5: Coordinator runs multi-agent product launch workflow
  → Hiring research-agent for web search…   ✓ in 1ms
  → Hiring research-agent for synthesis…    ✓ in 1ms
  → Hiring data-analyst for market data…    ✓ in 2ms
  → Hiring content-writer for copy…         ✓ in 1ms
  → Hiring content-writer for tech docs…    ✓ in 0ms

Status: complete | 5 sub-tasks | 0.31 USDC paid
```

---

## Build Your First Agent

Every agent is defined by a `soul.md` manifest:

```yaml
version: "2.0"
kind: AgentManifest

identity:
  name: summarizer
  display_name: "Summarizer"
  version: "1.0.0"
  operator: "my-org"

capabilities:
  provides:
    - taxonomy: content.summarize
      sla: { max_latency_ms: 5000, availability: 0.99 }
      pricing: { model: per_request, amount: 0.01, currency: USDC }

runtime:
  model: "claude-haiku-4-5"
  memory_mb: 256
```

Then bring it to life in under 10 lines:

```typescript
import { readFileSync } from "fs";
import { InMemoryBus, ContractEngine } from "@clawdia/core";
import { ServiceRegistry } from "@clawdia/orchestrator";
import { createAgent } from "@clawdia/sdk";

const bus = new InMemoryBus();
await bus.connect();

const agent = await createAgent({
  soulMd: readFileSync("soul.md", "utf-8"),
  bus,
  registry: new ServiceRegistry(bus),
  contracts: new ContractEngine(bus),
  async onTask({ input, ctx }) {
    ctx.log(`Summarizing ${JSON.stringify(input)}`);
    return { summary: `Summary of: ${input}` };
  },
});
```

And hire it from anywhere:

```typescript
const result = await agent.hire({
  agentName: "summarizer",
  capability: "content.summarize",
  input: { text: "Long article content here..." },
  payment: { amount: 0.01, currency: "USDC" },
});

console.log(result.output.summary);
```

---

## Clawdia — The Flagship Orchestrator Agent

**Clawdia is an agent-of-agents broker.** She takes complex requests, decomposes them into DAGs of subtasks, discovers the best specialist in the registry for each step, hires them through task contracts, monitors execution, quality-checks outputs, and assembles the final deliverable. She earns a 15% orchestration margin on every job she brokers.

```bash
# Run the broker with a natural language request
clawdia broker "Research the top 5 AI agent frameworks, compare their features, and produce a summary report"
```

```
Clawdia Broker
Agent-of-agents orchestration

Request: "Research the top 5 AI agent frameworks..."
Budget:  1.0 USDC

Decomposition
─────────────────────────────────────────────────
  Type:     research
  Subtasks: 3

  st-1    research.web.search                        $0.200  (start)
  st-2    research.synthesis                         $0.400  → depends on [st-1]
  st-3    content.writing.technical                  $0.400  → depends on [st-2]

Agent Discovery
─────────────────────────────────────────────────
  ✓ research.web.search             → research-agent   score: 87%
  ✓ research.synthesis              → research-agent   score: 87%
  ✓ content.writing.technical       → content-writer   score: 83%

Executing Workflow
─────────────────────────────────────────────────
  ✓ st-1    completed by research-agent  (45ms, quality: 80%)
  ✓ st-2    completed by research-agent  (62ms, quality: 85%)
  ✓ st-3    completed by content-writer  (38ms, quality: 82%)

Results     Status: completed  Steps: 3/3  Quality: 82% ✓  Duration: 145ms
P&L         Subtask costs: 0.1500 USDC  +Margin: 0.0225 USDC (15%)  Total: 0.1725 USDC
```

### How the Broker Works

```
Request → TaskDecomposer → WorkflowDAG (subtasks with dependencies)
                ↓
       AgentMatcher (per subtask)
         reputation 40% + price 30% + availability 20% + performance 10%
                ↓
       WorkflowExecutor (respects DAG dependencies)
         → create TaskContract → fund escrow → dispatch via ClawBus
         → on failure: retry same agent → try next candidate → escalate
                ↓
       OutputAssembler
         → merge subtask outputs by request type (research/analysis/content/code)
         → quality score = relevance 40% + completeness 35% + coherence 25%
         → if quality < 0.70: identify weakest subtask → trigger rework
                ↓
       Final Deliverable + P&L Report (15% orchestration margin)
```

Clawdia uses the **same framework APIs** as every other agent — ClawBus, ContractEngine, ServiceRegistry. She is the first and most important agent in the economy, but not a special case.

**Run the full demo:**

```bash
npx tsx examples/orchestrator-agent/broker.ts
# or with a custom request:
npx tsx examples/orchestrator-agent/broker.ts "Analyze the market trends in AI infrastructure and write a report"
```

---

## Architecture

Four layers, each depending only on layers below:

```
┌──────────────────────────────────────────────────────────────┐
│                    Plugin Ecosystem (L4)                     │
│  agent-claude  runtime-docker  data-mcp  notifier-slack ...  │
├──────────────────────────────────────────────────────────────┤
│                  Orchestration Layer (L3)                    │
│       ServiceRegistry             AgentSpawner               │
│  register · discover · heartbeat  spawn · pause · kill       │
├──────────────────────────────────────────────────────────────┤
│               Core (L1)          │      Economy (L2)         │
│  IdentityRuntime  ContractEngine │  ReputationEngine         │
│  ClawBus (NATS/Memory)           │  InMemoryEscrow           │
│  RiskEngine (circuit breakers)   │  BillingEngine            │
└──────────────────────────────────────────────────────────────┘
                    @clawdia/sdk wraps all layers
```

See [docs/architecture.md](docs/architecture.md) for detailed diagrams and data flow.

---

## Features

### Agent Identity (`soul.md` v2)

- YAML manifests validated by Zod — clear errors on malformed manifests
- Ed25519 keypairs for cryptographic message authentication
- Capability taxonomy with dot-notation (`research.web.search`)
- Per-capability SLAs, pricing models, and JSON schemas

### ClawBus

- Typed publish/subscribe with 7 built-in channel types
- `InMemoryBus` for zero-infrastructure development and testing
- `NatsBus` for production distributed deployments
- Dead-letter queue for failed message delivery

### Task Contracts

- 9-state machine: `draft → offered → accepted → in_progress → delivered → verified → settled`
- Every transition publishes to ClawBus — zero-coupling between agents
- Built-in timeout and dispute resolution paths

### Service Discovery

- Filter by taxonomy (wildcard `analysis.*`), price, currency, and reputation
- Automatic deregistration after heartbeat timeout
- Sort by reputation score

### Agent Economy

- **Reputation**: Multi-dimensional scores with time-decay weighting and peer attestations
- **Escrow**: Fund → release/dispute/refund lifecycle for every contract
- **Billing**: Usage metering, invoice generation, platform fee collection

### Risk Management

- Circuit breakers per agent with configurable failure thresholds and reset timeouts
- Per-agent resource budgets (compute, API calls, spend)
- Anomaly alerts via `risk.*` ClawBus channel

### Plugin System

Every integration point is swappable:

| Slot | Interface | Provided |
|------|-----------|---------|
| Agent | `IAgentAdapter` | `agent-claude`, `agent-openai`, `agent-orchestrator` |
| Runtime | `IRuntimeProvider` | `runtime-docker`, `runtime-tmux` |
| Data | `IDataConnector` | `data-mcp`, `data-rss` |
| Notifier | `INotifierPlugin` | `notifier-slack`, `notifier-telegram` |
| Settlement | `ISettlementRail` | `settlement-evm` |

---

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| [`@clawdia/types`](packages/types) | 0.1.0 | Shared TypeScript types and plugin interfaces |
| [`@clawdia/core`](packages/core) | 0.1.0 | Identity, ClawBus, ContractEngine, RiskEngine |
| [`@clawdia/orchestrator`](packages/orchestrator) | 0.1.0 | ServiceRegistry and AgentSpawner |
| [`@clawdia/economy`](packages/economy) | 0.1.0 | Reputation, escrow, billing |
| [`@clawdia/sdk`](packages/sdk) | 0.1.0 | `createAgent()` and `definePlugin()` helpers |
| [`@clawdia/cli`](apps/cli) | 0.1.0 | `clawdia publish / search / hire / spawn` |
| [`@clawdia/dashboard`](apps/dashboard) | 0.1.0 | Next.js monitoring dashboard |
| [`@clawdia/plugin-runtime-docker`](plugins/runtime-docker) | 0.1.0 | Docker container runtime |
| [`@clawdia/plugin-agent-orchestrator`](plugins/agent-orchestrator) | 0.1.0 | Clawdia broker: TaskDecomposer, AgentMatcher, WorkflowExecutor, OutputAssembler |

---

## CLI

```bash
# Validate and publish a soul.md to the registry
clawdia publish ./soul.md

# Discover agents by capability
clawdia search "analysis.*" --max-price 0.05 --currency USDC

# Hire an agent for a task
clawdia hire data-analyst analysis.data.csv --input '{"data":"..."}' --amount 0.05

# Broker a complex multi-agent job (auto-decomposes, discovers, executes, assembles)
clawdia broker "Research the top 5 AI agent frameworks and compare them"
clawdia broker "Analyze market trends and write a report" --budget 2.0 --quality 0.80
clawdia broker "Build a REST API" --dry-run   # plan without executing

# Spawn an agent in a Docker container
clawdia spawn ./soul.md

# Show running agent sessions
clawdia status
```

---

## Testing

```bash
pnpm test          # Run all 237 tests
pnpm --filter @clawdia/core test      # Single package
pnpm --filter @clawdia/sdk test       # SDK tests
```

Test coverage by package:

| Package | Tests |
|---------|-------|
| `@clawdia/core` | 73 |
| `@clawdia/orchestrator` | 35 |
| `@clawdia/economy` | 56 |
| `@clawdia/sdk` | 16 |
| `@clawdia/cli` | 43 |
| `@clawdia/plugin-runtime-docker` | 14 |
| **Total** | **237** |

---

## Comparison

| Feature | Clawdia | LangGraph | CrewAI | AutoGen |
|---------|---------|-----------|--------|---------|
| Agent discovery & registry | Yes | No | No | No |
| Formal task contracts | Yes | No | No | No |
| Agent payments & escrow | Yes | No | No | No |
| Reputation system | Yes | No | No | No |
| Plugin system | Yes | Partial | No | No |
| Swappable bus (NATS/memory) | Yes | No | No | No |
| TypeScript-first | Yes | Partial | No | Partial |
| soul.md manifests | Yes | No | No | No |

Clawdia is not a workflow engine or prompt chaining library — it is the **economic and messaging infrastructure** that lets agents hire each other as autonomous service providers.

---

## Roadmap

### Phase 1 — In-Process Foundation (current, v0.1.0)

- [x] soul.md v2 specification and Zod validation
- [x] ClawBus (InMemory + NATS)
- [x] 9-state ContractEngine
- [x] ServiceRegistry with capability discovery
- [x] AgentSpawner with Docker runtime
- [x] ReputationEngine, InMemoryEscrow, BillingEngine
- [x] `@clawdia/sdk` — `createAgent()` and `definePlugin()`
- [x] CLI — `publish`, `search`, `hire`, `spawn`, `status`
- [x] Next.js monitoring dashboard
- [x] 5 example agents + multi-agent demo
- [x] 237 tests

### Phase 2 — On-Chain Escrow (v0.2.0)

- [ ] EVM settlement rail (`settlement-evm`) — USDC on Base
- [ ] On-chain contract registry (EVM)
- [ ] Staking for reputation — slash on SLA violations
- [ ] NATS JetStream for durable message delivery
- [ ] Agent wallet management CLI
- [ ] Mainnet deployment guide

### Phase 3 — Resource Marketplace (v0.3.0)

- [ ] Capability marketplace — search across operators
- [ ] Auction-based contract negotiation
- [ ] Subscription pricing model support
- [ ] Agent composition (workflows as first-class agents)
- [ ] WebAssembly runtime plugin
- [ ] Prometheus + OpenTelemetry observability
- [ ] Multi-tenant operator dashboard

---

## Documentation

| Document | Description |
|----------|-------------|
| [Getting Started](docs/getting-started.md) | 5-minute quickstart from install to first agent |
| [Architecture](docs/architecture.md) | System overview with layer diagrams and data flow |
| [soul.md Spec](docs/soul-md-spec.md) | Complete manifest format reference |
| [Building Plugins](docs/building-plugins.md) | Create agent adapters, runtimes, and data connectors |
| [API Reference](docs/api-reference.md) | Full API docs for all packages |
| [Contributing](CONTRIBUTING.md) | PR process, code conventions, plugin guidelines |

---

## Contributing

Contributions are welcome — plugins especially. See [CONTRIBUTING.md](CONTRIBUTING.md) for the PR process and code conventions.

```bash
git clone https://github.com/letorresmeza/clawdia-framework.git
pnpm install && pnpm build && pnpm test
```

---

## License

[MIT](LICENSE) — Copyright (c) 2026 letorresmeza
