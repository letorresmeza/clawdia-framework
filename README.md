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

### Runtime Environment

Copy [.env.example](/root/clawdia-framework/.env.example) and set the runtime values you actually use.

- `CLAWDIA_DAEMON_MODE=demo` keeps the current zero-infra daemon behavior. `CLAWDIA_DAEMON_MODE=prod` turns on stricter validation.
- `CLAWDIA_BUS_PROVIDER=memory|nats` controls daemon transport. In `prod` mode, `nats` is required and `CLAWBUS_URL` is used for the connection.
- `CLAWDIA_ENABLE_AGENCY_AGENTS=1` controls whether the daemon auto-loads the repo’s agency-agents bundle at boot.
- `CLAWDIA_ALLOW_MOCK_IDENTITIES=1` is required in `prod` mode for now, because the built-in daemon identities are still scaffolded rather than externally provisioned.
- `CLAWDIA_DATA_DIR` sets the daemon state directory. `CLAWDIA_API_KEY_FILE` defaults inside it, so API key persistence no longer assumes `/var/lib/clawdia`.
- `CLAWDIA_IMPORT_LEGACY_STATE=1` re-enables one-time import of legacy local trading state from the old `clawdia-v3` paths. By default it is disabled.
- `CLAWDIA_API_KEY` is required by the dashboard when calling the daemon API, and can also be provided directly to the daemon instead of relying on its generated on-disk key.
- `CLAWDIA_DAEMON_URL` points the dashboard at the daemon API. The default is `http://127.0.0.1:3001`.
- `CLAWDIA_LOAD_TELEGRAM_FROM_DISK=1` re-enables legacy Telegram credential discovery from local `/root/.../.env` files for development only. By default it is disabled.

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

## Autoresearch — Autonomous ML Research Loop

**Clawdia turns Karpathy's autoresearch pattern into a multi-agent orchestrated workflow.**

The [autoresearch example](examples/autoresearch/) shows that Clawdia can orchestrate _any_ autonomous loop — not just trading or content tasks. Each iteration of the ML research loop is decomposed into real TaskContracts, hired through the ServiceRegistry, and settled through the economy layer.

```bash
# Run the full autonomous research loop (10 iterations by default)
npx tsx examples/autoresearch/autoresearch.ts

# Or via CLI with custom goal and iteration count
clawdia research "Optimize the GPT training loop for lower validation loss" --iterations 5

# Dry-run: see the research plan without executing contracts
clawdia research "Lower validation BPB" --iterations 10 --dry-run
```

**Example output:**

```
════════════════════════════════════════════════════════════════════
  Clawdia Autoresearch — Autonomous ML Research Loop
════════════════════════════════════════════════════════════════════

Goal: "Optimize the GPT training loop for lower validation loss"
Iterations: 10   Baseline val_bpb: 3.142

Step 2: Registering research specialist agents
────────────────────────────────────────────────────────────────────
  ● research-hypothesis-agent        research.ml.hypothesis   rep: 91%
  ● code-modifier-agent              coding.ml.modify         rep: 88%
  ● experiment-evaluator-agent       analysis.ml.evaluate     rep: 89%
  ● experiment-logger-agent          data.experiment.log      rep: 93%

────────────── Iteration 1/10 ──────────────
  → [hyp]  research.ml.hypothesis     [a1b2c3d4]
    Hypothesis: Reduce learning rate from 3e-4 to 1e-4 for more stable convergence
    Target: LEARNING_RATE   Confidence: 85%   Expected: -0.040 val_bpb

  → [code] coding.ml.modify           [e5f6g7h8]
    Modified: LEARNING_RATE = 3e-4  →  LEARNING_RATE = 1e-4
    Lines changed: 1

  → [stub] compute.gpu.train          [mock — TODO: real GPU]
    Simulated duration: 4m48s   val_bpb: 3.098

  → [eval] analysis.ml.evaluate       [i9j0k1l2]
    Decision: KEPT ✓   delta: -0.044   cumulative: 1.4% improvement

  → [log]  data.experiment.log        [m3n4o5p6]
    Log entry: exp-iter1-...   kept: 1/1   best: 3.098

  ...

════════════════════════════════════════════════════════════════════
  Research Complete
════════════════════════════════════════════════════════════════════

  Starting baseline:   3.142 val_bpb
  Final val_bpb:       2.814 val_bpb
  Total improvement:   -0.328 val_bpb (10.4% better)
  Experiments kept:    7/10 (3 discarded)
  Total contracts:     40 (hypothesis + code + evaluate + log × 10)
  Total cost:          0.7500 USDC

  Leaderboard (top 5 by val_bpb):
  ──────────────────────────────────────────────────────────────────
  #1  iter 7   Switch to pre-LayerNorm (normalize before attention)  2.814  -0.038 (3.5%)
  #2  iter 4   Add cosine annealing LR schedule                      2.852  -0.031 (2.8%)
  #3  iter 1   Reduce learning rate from 3e-4 to 1e-4                2.883  -0.044 (1.4%)
```

### The Four Research Agents

| Agent                                                                                           | Capability               | Role                                                                            |
| ----------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------- |
| [`research-hypothesis-agent`](examples/autoresearch/agents/research-hypothesis-agent/soul.md)   | `research.ml.hypothesis` | Analyzes history, proposes next modification with rationale and confidence      |
| [`code-modifier-agent`](examples/autoresearch/agents/code-modifier-agent/soul.md)               | `coding.ml.modify`       | Implements the hypothesis in the training script, returns diff                  |
| [`experiment-evaluator-agent`](examples/autoresearch/agents/experiment-evaluator-agent/soul.md) | `analysis.ml.evaluate`   | Compares val_bpb to baseline, decides keep/discard, updates baseline            |
| [`experiment-logger-agent`](examples/autoresearch/agents/experiment-logger-agent/soul.md)       | `data.experiment.log`    | Appends to structured log, maintains leaderboard, extracts cumulative learnings |

### How the Research Loop Works

```
Goal + baseline code
       ↓
  ┌────────────────────────────────────────────────────────────────┐
  │  Iteration N                                                   │
  │                                                                │
  │  [contract] research.ml.hypothesis                            │
  │    current_code + history + goal → hypothesis + rationale     │
  │             ↓                                                  │
  │  [contract] coding.ml.modify                                  │
  │    hypothesis + current_code → modified_code + diff           │
  │             ↓                                                  │
  │  [stub → TODO: compute.gpu.train]                             │
  │    modified_code → val_bpb  (5-min GPU training run)          │
  │             ↓                                                  │
  │  [contract] analysis.ml.evaluate                              │
  │    val_bpb vs baseline → keep/discard + new_baseline          │
  │             ↓                                                  │
  │  [contract] data.experiment.log                               │
  │    full record → updated leaderboard + learnings              │
  └────────────────────────────────────────────────────────────────┘
       ↓
  if kept: current_code = modified_code, baseline = new val_bpb
  if discarded: revert, keep baseline
       ↓
  Repeat for N iterations
       ↓
  Summary: best result, cumulative improvement, leaderboard
```

Each step is a **real `TaskContract`** — created by the orchestrator, funded through escrow, dispatched via ClawBus to the provider agent, and settled on delivery. The training step is stubbed with a deterministic mock that simulates a 5-minute GPU run. Swap in a `compute.gpu.train` agent (RunPod, Lambda Labs, or a local GPU node) to run real experiments.

This is the same pattern Clawdia uses for trading, content, and research workflows. Any autonomous loop that sequences distinct capabilities can be expressed as a multi-agent Clawdia workflow.

---

## Architecture

Four layers, each depending only on layers below:

```
┌──────────────────────────────────────────────────────────────┐
│                    Plugin Ecosystem (L4)                     │
│  agent-orchestrator  runtime-docker  notifier-telegram ...   │
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

| Slot       | Interface          | Provided                              |
| ---------- | ------------------ | ------------------------------------- |
| Agent      | `IAgentAdapter`    | `agent-orchestrator`, `agent-trading` |
| Runtime    | `IRuntimeProvider` | `runtime-docker`                      |
| Data       | `IDataConnector`   | none implemented in-repo yet          |
| Notifier   | `INotifierPlugin`  | `notifier-telegram`                   |
| Settlement | `ISettlementRail`  | `settlement-evm`                      |

Placeholder packages currently present but not implemented:
`agent-claude`, `agent-openai`, `data-mcp`, `data-rss`, `runtime-tmux`, `notifier-slack`

---

## Packages

| Package                                                            | Version | Description                                                                     |
| ------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------- |
| [`@clawdia/types`](packages/types)                                 | 0.1.0   | Shared TypeScript types and plugin interfaces                                   |
| [`@clawdia/core`](packages/core)                                   | 0.1.0   | Identity, ClawBus, ContractEngine, RiskEngine                                   |
| [`@clawdia/orchestrator`](packages/orchestrator)                   | 0.1.0   | ServiceRegistry and AgentSpawner                                                |
| [`@clawdia/economy`](packages/economy)                             | 0.1.0   | Reputation, escrow, billing                                                     |
| [`@clawdia/sdk`](packages/sdk)                                     | 0.1.0   | `createAgent()` and `definePlugin()` helpers                                    |
| [`@clawdia/cli`](apps/cli)                                         | 0.1.0   | `clawdia publish / search / hire / spawn`                                       |
| [`@clawdia/dashboard`](apps/dashboard)                             | 0.1.0   | Next.js monitoring dashboard                                                    |
| [`@clawdia/plugin-runtime-docker`](plugins/runtime-docker)         | 0.1.0   | Docker container runtime                                                        |
| [`@clawdia/plugin-agent-orchestrator`](plugins/agent-orchestrator) | 0.1.0   | Clawdia broker: TaskDecomposer, AgentMatcher, WorkflowExecutor, OutputAssembler |

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

# Autonomous ML research loop (hypothesis → code → train → evaluate → log, repeat)
clawdia research "Optimize the GPT training loop for lower validation loss" --iterations 10
clawdia research "Lower validation BPB" --iterations 5 --baseline-bpb 3.142
clawdia research "Improve convergence speed" --dry-run   # show plan without executing

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

| Package                          | Tests   |
| -------------------------------- | ------- |
| `@clawdia/core`                  | 73      |
| `@clawdia/orchestrator`          | 35      |
| `@clawdia/economy`               | 56      |
| `@clawdia/sdk`                   | 16      |
| `@clawdia/cli`                   | 43      |
| `@clawdia/plugin-runtime-docker` | 14      |
| **Total**                        | **237** |

---

## Comparison

| Feature                     | Clawdia | LangGraph | CrewAI | AutoGen |
| --------------------------- | ------- | --------- | ------ | ------- |
| Agent discovery & registry  | Yes     | No        | No     | No      |
| Formal task contracts       | Yes     | No        | No     | No      |
| Agent payments & escrow     | Yes     | No        | No     | No      |
| Reputation system           | Yes     | No        | No     | No      |
| Plugin system               | Yes     | Partial   | No     | No      |
| Swappable bus (NATS/memory) | Yes     | No        | No     | No      |
| TypeScript-first            | Yes     | Partial   | No     | Partial |
| soul.md manifests           | Yes     | No        | No     | No      |

Clawdia is not a workflow engine or prompt chaining library — it is the **economic and messaging infrastructure** that lets agents hire each other as autonomous service providers.

---

## 50+ Specialist Agents — Powered by agency-agents

Clawdia's registry comes pre-loaded with **61 specialist agents** from the open-source [agency-agents](https://github.com/msitarzewski/agency-agents) collection. The moment the daemon boots, Clawdia can discover and hire experts across design, engineering, marketing, product, testing, and more — without any additional configuration.

### Why this matters

An orchestrator is only as powerful as the specialists in its registry. The more capable agents available, the more diverse the requests Clawdia can handle autonomously.

When you send Clawdia a request like _"Build me a React landing page with animations"_, she:

1. Decomposes the request into a workflow DAG
2. Queries the registry for `design.ux.researcher`, `design.ui.designer`, `coding.frontend.developer`, `design.whimsy.injector`
3. Hires each agent through a formal `TaskContract` with escrow
4. Assembles the outputs into a coherent deliverable

Without agency-agents, Clawdia would return "no agents found." With agency-agents, she orchestrates a full creative+engineering pipeline automatically.

### Pre-loaded specialists (61 agents across 9 domains)

| Domain             | Taxonomy prefix | Agents                                                                                                                                               |
| ------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engineering        | `coding.*`      | frontend-developer, backend-architect, ai-engineer, devops-automator, security-engineer, senior-developer, mobile-app-builder, rapid-prototyper      |
| Design             | `design.*`      | ui-designer, ux-researcher, ux-architect, brand-guardian, visual-storyteller, whimsy-injector, image-prompt-engineer                                 |
| Marketing          | `marketing.*`   | content-creator, growth-hacker, social-media-strategist, reddit-community-builder, app-store-optimizer, tiktok-strategist, twitter-engager, + 4 more |
| Product            | `product.*`     | feedback-synthesizer, sprint-prioritizer, trend-researcher                                                                                           |
| Project Management | `management.*`  | project-shepherd, studio-producer, studio-operations, experiment-tracker, senior                                                                     |
| Testing            | `testing.*`     | accessibility-auditor, api-tester, performance-benchmarker, reality-checker, workflow-optimizer, + 3 more                                            |
| Support            | `support.*`     | support-responder, finance-tracker, legal-compliance-checker, infrastructure-maintainer, + 2 more                                                    |
| Specialized        | `specialized.*` | agents-orchestrator, agentic-identity-trust, lsp-index-engineer, data-analytics-reporter, + 3 more                                                   |
| Spatial Computing  | `spatial.*`     | visionos-spatial-engineer, xr-immersive-developer, xr-interface-architect, macos-spatial-metal-engineer, + 2 more                                    |

### Getting started with agency-agents

```bash
# 1. Clone the agency-agents repo
git clone https://github.com/msitarzewski/agency-agents /tmp/agency-agents

# 2. Convert to soul.md v2 manifests (generates examples/agency-agents/)
npx tsx scripts/import-agency-agents.ts

# 3. Run the multi-agent demo — Clawdia brokers 4 specialists for a landing page
npx tsx examples/agency-agents/demo.ts

# 4. Start the daemon — agency-agents auto-load on boot
npx tsx packages/orchestrator/src/daemon.ts
```

### Adding your own agents

Any soul.md v2 manifest can be registered with Clawdia's registry:

```typescript
import { registerAgencyAgents } from "./examples/agency-agents/register-all.js";

// In your daemon or orchestrator boot sequence:
const result = registerAgencyAgents(registry);
console.log(`Registered ${result.registered} agency-agents specialists`);

// Or register a single custom agent:
registry.register({
  name: "my-specialist",
  displayName: "My Custom Specialist",
  capabilities: [{ taxonomy: "coding.my.skill", ... }],
  // ...
});
```

The Clawdia registry is open — any agent that registers with a valid capability taxonomy becomes immediately discoverable by Clawdia and any other orchestrator in the network.

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

- [x] EVM settlement rail (`settlement-evm`) — USDC on Base
- [x] On-chain contract registry (EVM)
- [x] Staking for reputation — slash on SLA violations
- [x] NATS JetStream for durable message delivery
- [x] Agent wallet management CLI
- [x] Mainnet deployment guide

### Phase 3 — Resource Marketplace (v0.3.0)

- [x] Capability marketplace — search across operators
- [x] Auction-based contract negotiation
- [x] Subscription pricing model support
- [x] Agent composition (workflows as first-class agents)
- [x] WebAssembly runtime plugin
- [x] Prometheus + OpenTelemetry observability
- [x] Multi-tenant operator dashboard

---

## Documentation

| Document                                     | Description                                          |
| -------------------------------------------- | ---------------------------------------------------- |
| [Getting Started](docs/getting-started.md)   | 5-minute quickstart from install to first agent      |
| [Architecture](docs/architecture.md)         | System overview with layer diagrams and data flow    |
| [soul.md Spec](docs/soul-md-spec.md)         | Complete manifest format reference                   |
| [Building Plugins](docs/building-plugins.md) | Create agent adapters, runtimes, and data connectors |
| [On-Chain Deployment](docs/on-chain-deployment.md) | Base escrow, registry, staking, and wallet setup |
| [Phase 3 Marketplace](docs/phase-3-marketplace.md) | Capability market, auctions, workflow agents, and tenants |
| [API Reference](docs/api-reference.md)       | Full API docs for all packages                       |
| [Contributing](CONTRIBUTING.md)              | PR process, code conventions, plugin guidelines      |

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
