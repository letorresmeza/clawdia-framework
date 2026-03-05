# Clawdia Framework Architecture

## Overview

Clawdia is organized into four layers. Each layer depends only on the layers below it, making the system modular and testable from the bottom up.

```
┌──────────────────────────────────────────────────────────────┐
│                    Plugin Ecosystem (L4)                     │
│                                                              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐ │
│  │  Agent       │ │  Runtime     │ │  Data / Notify /     │ │
│  │  Adapters    │ │  Providers   │ │  Settlement / Store  │ │
│  │              │ │              │ │                      │ │
│  │ agent-claude │ │runtime-docker│ │ data-mcp notif-slack │ │
│  │ agent-openai │ │runtime-tmux  │ │settlement-evm  ...   │ │
│  └──────────────┘ └──────────────┘ └──────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│                  Orchestration Layer (L3)                    │
│                                                              │
│  ┌──────────────────┐      ┌──────────────────────────────┐  │
│  │  ServiceRegistry │      │       AgentSpawner           │  │
│  │                  │      │                              │  │
│  │ register()       │      │ spawn(identity, runtime)     │  │
│  │ discover(query)  │      │ pause() / resume() / kill()  │  │
│  │ heartbeat()      │      │ health monitoring loop       │  │
│  └──────────────────┘      └──────────────────────────────┘  │
├──────────────────────────────────────────────────────────────┤
│                     Clawdia Core (L1)                        │
│                                                              │
│  ┌──────────────┐ ┌──────────────┐ ┌───────────────────────┐ │
│  │IdentityRun.  │ │  ClawBus     │ │   ContractEngine      │ │
│  │              │ │              │ │                       │ │
│  │soul.md parse │ │  InMemoryBus │ │ DRAFT→OFFERED→ACCEPTED│ │
│  │keypair mgmt  │ │  NatsBus     │ │ →IN_PROGRESS→DELIVERED│ │
│  │zod validation│ │  typed pub/sub│ │ →VERIFIED→SETTLED    │ │
│  └──────────────┘ └──────────────┘ └───────────────────────┘ │
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │                     RiskEngine                           │ │
│  │  circuit breakers · resource budgets · anomaly alerts   │ │
│  └──────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│                    Agent Economy (L2)                        │
│                                                              │
│  ┌──────────────────┐ ┌──────────────┐ ┌──────────────────┐  │
│  │ ReputationEngine │ │InMemoryEscrow│ │  BillingEngine   │  │
│  │                  │ │              │ │                  │  │
│  │dimensional scores│ │fund/release/ │ │usage metering    │  │
│  │decay weighting   │ │dispute       │ │invoice gen       │  │
│  │attestations      │ │              │ │fee collection    │  │
│  └──────────────────┘ └──────────────┘ └──────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                           │ (SDK wraps all layers)
                    ┌──────┴──────┐
                    │  @clawdia/sdk │
                    │ createAgent() │
                    │ definePlugin()│
                    └─────────────┘
```

> Note: The original numbering in the codebase labels Core as L1 and Economy as L2 because they were developed in that order, but Economy does not depend on Core — both are peer dependencies of the Orchestration layer.

---

## Layer 1: Core (`@clawdia/core`)

The kernel. All other layers depend on it.

### IdentityRuntime

Parses and validates `soul.md` v2 manifests using Zod. Produces `AgentIdentity` objects that flow through the entire system. Generates Ed25519 keypairs for message signing.

```
soul.md YAML
    │
    ▼
IdentityRuntime.register()
    │  validates schema, parses capabilities/runtime/reputation
    ▼
AgentIdentity { name, version, capabilities[], publicKey, ... }
```

### ClawBus

Typed pub/sub message backbone. Two implementations:

| Implementation | Use Case |
|---|---|
| `InMemoryBus` | Development, testing, in-process multi-agent |
| `NatsBus` | Production, distributed across machines |

All inter-agent communication flows over typed **channels**:

| Channel | Purpose |
|---------|---------|
| `task.request` | Task lifecycle events (OFFER, ACCEPT, FUND, DELIVER, ...) |
| `task.heartbeat` | Liveness pings during long-running tasks |
| `heartbeat` | Agent health signals |
| `escalation` | Human-in-the-loop requests |
| `settlement.*` | Economic settlement events |
| `registry.*` | Agent registration / deregistration |
| `risk.*` | Safety alerts from RiskEngine |

### ContractEngine

A state machine governing every agent-to-agent transaction:

```
DRAFT ──OFFER──► OFFERED ──ACCEPT──► ACCEPTED ──FUND──► IN_PROGRESS
                    │                    │                    │
                 CANCEL               CANCEL              DELIVER
                    │                    │                    │
                    ▼                    ▼                    ▼
                CANCELLED           CANCELLED           DELIVERED ──VERIFY──► VERIFIED ──SETTLE──► SETTLED
                                                            │                                        ▲
                                                         REJECT                                      │
                                                            │                                        │
                                                            ▼                                        │
                                                        DISPUTED ──────────────RESOLVE───────────────┘
```

Every transition publishes a message to `task.request` on the ClawBus, so any subscriber can react.

### RiskEngine

Guards against runaway agents and excessive spend:

- **Circuit Breakers** — open after N failures, half-open after timeout
- **Resource Budgets** — per-agent compute/API-call/spend limits
- **Anomaly Detection** — publishes `risk.alert` when thresholds are exceeded

---

## Layer 2: Economy (`@clawdia/economy`)

Financial infrastructure for autonomous transactions.

### ReputationEngine

Tracks agent performance across multiple dimensions with time-decay weighting:

```
Task settled
    │
    ▼
ReputationEngine.update(agentName, event)
    │  dimensions: delivery_rate, latency_score, dispute_rate,
    │              verification_rate, uptime
    ▼
ReputationSnapshot { score: 0.0–1.0, dimensions, attestations }
```

Scores decay over time so recent performance matters more than historical.

### InMemoryEscrow

Holds funds during task execution:

```
hire() creates contract
    │
    ▼
escrow.fund(contractId, amount)   ← funds locked
    │
    ▼
provider executes task
    │
    ▼
escrow.release(contractId)        ← funds released to provider
   or
escrow.dispute(contractId)        ← funds held pending resolution
```

### BillingEngine

Meters usage and generates invoices. Subscribes to `settlement.complete` and `task.request` on the bus to record usage automatically. Supports per-request, per-token, and subscription pricing models.

---

## Layer 3: Orchestration (`@clawdia/orchestrator`)

Manages agent lifecycles and discovery.

### ServiceRegistry

The global agent catalog. Agents register on startup, heartbeat periodically, and are automatically deregistered after a configurable timeout.

```
Discovery query:
  { taxonomy: "analysis.*", maxPrice: 0.05, currency: "USDC" }
              │
              ▼
ServiceRegistry.discover()
  1. Filter by taxonomy (wildcard supported)
  2. Filter by price and currency
  3. Filter by reputation score
  4. Sort by reputation desc
  5. Apply limit
              │
              ▼
RegistryQueryResult { entries: RegistryEntry[], total }
```

### AgentSpawner

Spawns and monitors agent sessions using a pluggable `IRuntimeProvider`:

```
AgentSpawner.spawn(identity, opts)
    │
    ▼
runtime.spawn(containerConfig)     ← IRuntimeProvider (Docker, tmux, ...)
    │
    ▼
AgentSession { id, state, runtimeHandle, lastHeartbeat, ... }
    │
    ├── health monitor loop (publishes heartbeat, kills on timeout)
    └── pause() / resume() / kill() / destroyAll()
```

---

## Layer 4: Plugin Ecosystem

Every integration point is implemented as a swappable plugin. Plugins implement interfaces from `@clawdia/types` and are discovered at runtime via `PluginRegistry`.

### Plugin Slots

| Slot | Interface | Provided Plugins |
|------|-----------|-----------------|
| Agent adapter | `IAgentAdapter` | `agent-claude`, `agent-openai` |
| Runtime | `IRuntimeProvider` | `runtime-docker`, `runtime-tmux` |
| Data connector | `IDataConnector` | `data-mcp`, `data-rss` |
| Notifier | `INotifierPlugin` | `notifier-slack`, `notifier-telegram` |
| Settlement | `ISettlementRail` | `settlement-evm` |
| Storage | `IStorageProvider` | (community) |
| Observability | `IObservability` | (community) |

### Plugin Loading

```typescript
import { PluginRegistry, loadPluginsFromDirectory } from "@clawdia/core";

const registry = new PluginRegistry();
await loadPluginsFromDirectory(registry, "./plugins");

const runtime = registry.get<IRuntimeProvider>("docker-runtime");
```

---

## SDK Layer (`@clawdia/sdk`)

The SDK provides developer-friendly wrappers over all four layers. Most users only need the SDK.

```typescript
import { createAgent, definePlugin } from "@clawdia/sdk";

// Hides: IdentityRuntime, ServiceRegistry, ContractEngine,
//        bus subscriptions, contract lifecycle management
const agent = await createAgent({
  soulMd,
  bus,
  registry,
  contracts,
  async onTask({ input, ctx }) {
    // ctx.hire() — hire another agent (full contract lifecycle)
    // ctx.discover() — search the registry
    // ctx.log() — structured logging
    return result;
  },
});
```

---

## Data Flow: End-to-End Task

```
Requester                    ClawBus               Provider
    │                           │                      │
    │   createAgent() → register in ServiceRegistry   │
    │                           │                      │
    │── hire(agentName, ...) ──►│                      │
    │                           │                      │
    │   contracts.create()      │                      │
    │   ─── OFFER event ───────►│──────────────────────►│
    │   ─── ACCEPT event ──────►│──────────────────────►│
    │   ─── FUND event ────────►│──────────────────────►│ onTask() triggered
    │                           │                      │
    │                           │     (executes task)  │
    │                           │                      │
    │◄── DELIVER event ─────────│◄─────────────────────│
    │                           │                      │
    │   contracts.setOutput()   │                      │
    │   ─── VERIFY event ──────►│                      │
    │   ─── SETTLE event ──────►│                      │
    │                           │                      │
    │   return HireResult       │                      │
    │   { contractId, output, durationMs }             │
```

---

## Deployment Topologies

### In-Process (Development)

All agents run in the same Node.js process, sharing an `InMemoryBus`. Zero infrastructure required — ideal for development and testing.

### Multi-Process (Production)

Each agent runs as a separate Docker container. All agents connect to a shared NATS server via `NatsBus`. The `AgentSpawner` with `plugin-runtime-docker` manages container lifecycle.

### Distributed (Scale)

Multiple NATS servers in a cluster, with agents distributed across machines. The `ServiceRegistry` gossips membership via the bus. The economy layer can connect to on-chain escrow (Phase 2 roadmap) for trustless settlement.
