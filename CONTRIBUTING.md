# Contributing to Clawdia Framework

Thank you for helping build the infrastructure for the autonomous economy. This guide covers everything you need to contribute code, plugins, and documentation.

## Table of Contents

- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Code Conventions](#code-conventions)
- [Writing Tests](#writing-tests)
- [Plugin Contributions](#plugin-contributions)
- [Pull Request Process](#pull-request-process)
- [Commit Messages](#commit-messages)

---

## Quick Start

```bash
git clone https://github.com/letorresmeza/clawdia-framework.git
cd clawdia-framework
pnpm install
pnpm build
pnpm test
```

All 237+ tests should pass before you begin.

---

## Project Structure

```
clawdia-framework/
  packages/        Core library packages (types, core, orchestrator, economy, sdk)
  plugins/         Swappable adapter plugins (runtime-docker, agent-claude, ...)
  apps/            Applications (cli, dashboard)
  examples/        Runnable examples
  docs/            Documentation
  contracts/       Shared contract definitions
```

The dependency order is strict — no circular dependencies:

```
types → core → orchestrator → economy → sdk → apps/plugins
```

---

## Development Workflow

### Running specific packages

```bash
pnpm --filter @clawdia/core test
pnpm --filter @clawdia/sdk build
pnpm --filter @clawdia/cli dev
```

### Watch mode

```bash
pnpm dev   # Start all packages in watch mode via turbo
```

### Building

```bash
pnpm build   # Build all packages in dependency order
```

### Running the demo

```bash
pnpm --filter @clawdia/demo start
```

---

## Code Conventions

### TypeScript

- Strict mode everywhere (`"strict": true` in tsconfig)
- No `any` — use `unknown` and narrow with type guards
- Prefer `interface` over `type` for extensibility
- Use `satisfies` operator when exporting plugin modules
- All async functions must return `Promise<T>`, not `void`

```typescript
// Good
async function doWork(): Promise<string> {
  return "result";
}

// Bad — missing return type
async function doWork() {
  return "result";
}
```

### Naming

| Element | Convention | Example |
|---------|-----------|---------|
| Files | `kebab-case.ts` | `contract-engine.ts` |
| Interfaces | `PascalCase`, prefix `I` for plugins | `IAgentAdapter`, `AgentIdentity` |
| Classes | `PascalCase` | `ContractEngine` |
| Functions | `camelCase` | `createAgent()` |
| Constants | `SCREAMING_SNAKE_CASE` | `DEFAULT_CONFIG` |
| Plugin exports | `{ name, type, create }` | see Plugin Pattern |

### File Organization

```
packages/my-package/
  src/
    feature/
      my-class.ts        # Implementation
    __tests__/
      my-class.test.ts   # Tests (mirrors src structure)
  index.ts               # Barrel export — only public API
  package.json
  tsconfig.json
```

### Imports

- Use `.js` extensions in imports (required for ESM): `import { Foo } from "./foo.js"`
- Use `workspace:*` for internal packages in `package.json`
- Group imports: external packages first, then internal packages, then local files

### Error Handling

- Throw `Error` with descriptive messages that include the problematic value
- Never swallow errors silently
- Use `onError` callback pattern for non-fatal errors in long-running agents

```typescript
// Good
if (!contract) {
  throw new Error(`Contract "${contractId}" not found`);
}

// Bad
if (!contract) return;
```

---

## Writing Tests

### Location and naming

- Unit tests: `src/__tests__/my-class.test.ts`
- Integration tests: `tests/integration/my-feature.test.ts`
- Test files mirror the source structure

### Test helpers

```typescript
import { InMemoryBus } from "@clawdia/core";
import { ServiceRegistry } from "@clawdia/orchestrator";
import { ContractEngine } from "@clawdia/core";

// Standard test setup
async function setup() {
  const bus = new InMemoryBus();
  await bus.connect();
  const registry = new ServiceRegistry(bus);
  const contracts = new ContractEngine(bus);
  return { bus, registry, contracts };
}
```

### Bus subscriptions in tests

Handlers passed to `bus.subscribe()` must be `async`:

```typescript
// Good
bus.subscribe("task.request", async (msg) => {
  received.push(msg.payload);
});

// Bad — returns number from .push(), not Promise<void>
bus.subscribe("task.request", (msg) => {
  received.push(msg.payload);
});
```

### Coverage targets

- Core packages: 90% line coverage
- Plugin packages: 80% line coverage
- New features must include tests before merging

---

## Plugin Contributions

New plugins are welcome. Please follow these guidelines:

### 1. Use the plugin pattern

```typescript
import { definePlugin } from "@clawdia/sdk";
import type { INotifierPlugin } from "@clawdia/types";

class MyNotifier implements INotifierPlugin {
  readonly name = "my-notifier";
  // ... implement all interface methods
}

export default definePlugin({
  name: "my-notifier",
  type: "notifier",
  create: () => new MyNotifier(),
});
```

### 2. Naming

- Official plugins (in this repo): `@clawdia/plugin-{type}-{name}`
- Community plugins: `@yourorg/clawdia-plugin-{name}`

### 3. Required package.json fields

```json
{
  "name": "@clawdia/plugin-my-plugin",
  "description": "One-sentence description",
  "keywords": ["clawdia", "plugin", "agent"],
  "repository": {
    "type": "git",
    "url": "https://github.com/letorresmeza/clawdia-framework"
  },
  "license": "MIT"
}
```

### 4. Tests are required

Every plugin must have at least:
- A test that the plugin can be instantiated via `create()`
- A test for the primary interface method
- A test for error cases

### 5. No hard dependencies on other plugins

Plugins must not import from other plugins. Accept dependencies via constructor injection.

---

## Pull Request Process

1. **Fork** the repository and create a branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```

2. **Make your changes** — keep PRs focused on a single concern.

3. **Test thoroughly**:
   ```bash
   pnpm build && pnpm test
   ```

4. **Check types**:
   ```bash
   pnpm --filter @clawdia/core build
   ```

5. **Open the PR** against `main` with:
   - A clear title describing what changed
   - Why the change is needed (link issues where relevant)
   - How to test it

6. **Address review comments** — maintainers aim to review within 3 business days.

7. **Squash and merge** — we prefer a clean commit history.

### PR Checklist

- [ ] All existing tests pass (`pnpm test`)
- [ ] New functionality has tests
- [ ] Public APIs are documented (JSDoc comments)
- [ ] `package.json` has `description`, `keywords`, and `repository` if it's a new package
- [ ] No `any` types introduced
- [ ] No circular imports

---

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(sdk): add timeout option to createAgent()
fix(core): prevent bus handler memory leak on disconnect
docs(soul-md): document reputation block fields
test(economy): add dispute resolution test cases
refactor(orchestrator): extract heartbeat logic to separate module
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `perf`

Scope is the package name without the `@clawdia/` prefix.

---

## Questions?

Open a [GitHub Discussion](https://github.com/letorresmeza/clawdia-framework/discussions) for questions, ideas, and design proposals. Reserve Issues for confirmed bugs and actionable feature requests.
