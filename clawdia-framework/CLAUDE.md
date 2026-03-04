# CLAUDE.md — Clawdia Framework Development Conventions

## Project Overview

Clawdia Framework is agent infrastructure for the autonomous economy. It enables AI agents to discover, hire, and transact with each other through standardized protocols.

## Architecture

Four layers, each depending only on layers below:

1. **Core** (`packages/core`) — Identity, ClawBus, Contracts, Risk
2. **Orchestrator** (`packages/orchestrator`) — Spawner, Registry, Sessions, Workflows
3. **Economy** (`packages/economy`) — Reputation, Escrow, Marketplace, Billing
4. **Plugins** (`plugins/*`) — Swappable adapters for agents, runtimes, data, notifications

## Code Conventions

### TypeScript

- Strict mode everywhere
- No `any` — use `unknown` and narrow
- Prefer interfaces over types for extensibility
- Use `satisfies` for plugin exports
- All async functions return `Promise<T>`

### Naming

- Files: `kebab-case.ts`
- Interfaces: `PascalCase` prefixed with `I` for plugin interfaces (e.g., `IAgentAdapter`)
- Types: `PascalCase`
- Functions/methods: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`
- Plugin exports: `{ name, type, create }` satisfying `PluginModule`

### Package Structure

```
packages/core/
  src/
    bus/          # ClawBus message backbone
    identity/     # soul.md parser, keypair management
    contracts/    # Task Contract state machine
    risk/         # Circuit breakers, budgets
    plugins/      # Plugin loader
    __tests__/    # Unit tests
  index.ts        # Barrel export
  package.json
  tsconfig.json
```

### Plugin Pattern

Every plugin:
1. Implements one interface from `@clawdia/types`
2. Exports a `PluginModule` as default export
3. Has no hard dependencies on other plugins
4. Uses dependency injection for bus/registry access

```typescript
// plugins/my-plugin/src/index.ts
import type { INotifierPlugin, PluginModule } from "@clawdia/types";

class MyNotifier implements INotifierPlugin {
  readonly name = "my-notifier";
  // ... implement interface
}

export default {
  name: "my-notifier",
  type: "notifier",
  create: () => new MyNotifier(),
} satisfies PluginModule;
```

### Testing

- Unit tests: `vitest` in `__tests__/` directories
- Use `InMemoryBus` for bus-dependent tests
- Mock identities via helper: `createMockIdentity(name)`
- Integration tests: `tests/integration/`
- Target 90% coverage on Core

### ClawBus Channels

All inter-agent communication uses typed channels:
- `task.*` — Task lifecycle events
- `heartbeat` — Agent liveness
- `escalation` — Human-in-the-loop requests
- `settlement.*` — Economic events
- `registry.*` — Discovery events
- `risk.*` — Safety alerts

### soul.md v2

Agent manifests use YAML with these required sections:
- `version: "2.0"` + `kind: AgentManifest`
- `identity` — name, version, operator, public key
- `capabilities.provides` — taxonomy, schemas, SLA, pricing
- `runtime` — model, resources, environment

Capability taxonomy uses dot-notation: `category.subcategory.skill`

## Key Commands

```bash
pnpm build            # Build all packages (respects dependency order)
pnpm test             # Run all tests
pnpm dev              # Start dev mode with watch
pnpm --filter @clawdia/core test  # Test a specific package
```
