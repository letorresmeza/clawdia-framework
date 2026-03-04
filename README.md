# Clawdia Framework

**Agent infrastructure for the autonomous economy.**

Orchestrate, coordinate, and monetize fleets of AI agents — from trading bots to coding assistants to autonomous service providers.

## What is Clawdia?

Clawdia Framework is the missing infrastructure layer for multi-agent AI systems. It provides:

- **Agent Identity** — `soul.md` v2 manifests define who an agent is, what it can do, and how much it costs
- **Message Bus** — Typed, async communication between agents via ClawBus
- **Task Contracts** — Formal agreements between agents with SLAs, verification, and payment terms
- **Risk Management** — Circuit breakers, resource budgets, and anomaly detection
- **Service Discovery** — Agents find and hire other agents through the registry
- **Agent Economy** — Escrow, reputation, and settlement for autonomous transactions

## Quick Start

```bash
# Clone and install
git clone https://github.com/your-org/clawdia-framework.git
cd clawdia-framework
pnpm install
pnpm build

# Spawn your first agent
clawdia spawn ./examples/trading-bot/soul.md
clawdia status
```

## Architecture

```
┌─────────────────────────────────────────────┐
│           Plugin Ecosystem (L4)             │
│  Agent Adapters · Data · Trackers · Notify  │
├─────────────────────────────────────────────┤
│          Orchestration Layer (L3)           │
│  Spawner · Workflows · Registry · Sessions  │
├─────────────────────────────────────────────┤
│            Clawdia Core (L1)               │
│  Identity · ClawBus · Contracts · Risk     │
├─────────────────────────────────────────────┤
│           Agent Economy (L2)               │
│  Reputation · Escrow · Marketplace · Billing│
└─────────────────────────────────────────────┘
```

## Packages

| Package | Description |
|---------|-------------|
| `@clawdia/types` | Shared TypeScript types and plugin interfaces |
| `@clawdia/core` | Identity runtime, ClawBus, contracts, risk engine |
| `@clawdia/orchestrator` | Agent spawner, service registry, session manager |
| `@clawdia/economy` | Reputation, escrow, marketplace, billing |
| `@clawdia/sdk` | Developer SDK for building plugins |

## Plugin System

Every integration point is swappable:

| Slot | Default | Alternatives |
|------|---------|-------------|
| Agent | Claude Code | GPT, Codex, Aider, OpenClaw |
| Runtime | Docker | Firecracker, tmux, k8s |
| Data | REST/MCP | GraphQL, WebSocket, RSS |
| Tracker | GitHub | Linear, Jira |
| Notifier | Slack | Telegram, Discord |
| Settlement | Base (EVM) | Arbitrum, Solana, Stripe |
| Storage | PostgreSQL | SQLite, DynamoDB |
| Observability | Prometheus | Datadog, OpenTelemetry |

## soul.md v2

Every agent is defined by a `soul.md` manifest:

```yaml
version: "2.0"
kind: AgentManifest

identity:
  name: market-sentinel
  display_name: "Market Sentinel"
  version: "1.0.0"
  operator: "clawdia-labs"

capabilities:
  provides:
    - taxonomy: analysis.market.sentiment
      sla:
        max_latency_ms: 5000
        availability: 0.995
      pricing:
        model: per_request
        amount: 0.005
        currency: USDC
```

## Development

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests
pnpm dev              # Start dev mode
```

## License

MIT
