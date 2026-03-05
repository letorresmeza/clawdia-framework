# API Reference

Complete API documentation for all public packages in the Clawdia Framework.

---

## `@clawdia/sdk`

The primary developer interface. Import from here for most use cases.

### `createAgent(opts: CreateAgentOptions): Promise<AgentHandle>`

Creates and registers a Clawdia agent from a soul.md manifest. Subscribes to the ClawBus and invokes `onTask` for every incoming task contract where this agent is the provider.

```typescript
import { createAgent } from "@clawdia/sdk";

const agent = await createAgent({
  soulMd: fs.readFileSync("soul.md", "utf-8"),
  bus,
  registry,
  contracts,
  async onTask({ input, ctx }) {
    return { result: await process(input) };
  },
});
```

**`CreateAgentOptions`**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `soulMd` | `string` | Yes | soul.md YAML content |
| `bus` | `IClawBus` | Yes | Connected bus instance |
| `registry` | `ServiceRegistry` | No | Shared registry; creates new if omitted |
| `contracts` | `ContractEngine` | No | Shared engine; creates new if omitted |
| `onTask` | `(task: AgentTask) => Promise<unknown>` | No | Task handler |
| `onError` | `(err: Error, ctx?: string) => void` | No | Error handler (defaults to `console.error`) |

**`AgentTask`**

```typescript
interface AgentTask {
  contract: TaskContract;   // Full contract object
  input: unknown;           // Alias for contract.input
  ctx: AgentContext;        // Helper methods
}
```

**`AgentContext`**

```typescript
interface AgentContext {
  readonly identity: AgentIdentity;
  hire(opts: HireOptions): Promise<HireResult>;
  discover(taxonomy: string, opts?: { maxPrice?: number; currency?: string }): AgentIdentity[];
  log(message: string, level?: "info" | "warning" | "error"): void;
}
```

---

### `class AgentHandle`

Returned by `createAgent()`. Provides methods for interacting with the agent after startup.

#### `AgentHandle.hire(opts: HireOptions): Promise<HireResult>`

Hire another agent for a subtask. Drives the full contract lifecycle (OFFER → ACCEPT → FUND → DELIVER → VERIFY → SETTLE) and returns when the task is settled.

```typescript
const result = await agent.hire({
  agentName: "data-analyst",
  capability: "analysis.data.csv",
  input: { data: csvString, columns: ["revenue", "date"] },
  payment: { amount: 0.05, currency: "USDC" },
});

console.log(result.output);      // Provider's return value
console.log(result.durationMs);  // Wall-clock time
console.log(result.contractId);  // Settled contract ID
```

**`HireOptions`**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `agentName` | `string` | Yes | — | Name of agent in registry |
| `capability` | `string` | Yes | — | Taxonomy to invoke |
| `input` | `unknown` | Yes | — | Task input data |
| `payment` | `{ amount: number; currency: string }` | Yes | — | Payment terms |
| `sla` | `{ deadlineMs: number; maxRetries: number }` | No | `{ deadlineMs: 30000, maxRetries: 1 }` | SLA overrides |

**`HireResult`**

| Field | Type | Description |
|-------|------|-------------|
| `contractId` | `string` | UUID of the settled contract |
| `output` | `unknown` | Value returned by `onTask` |
| `durationMs` | `number` | Elapsed milliseconds from hire to settlement |

#### `AgentHandle.discover(taxonomy, opts?): AgentIdentity[]`

Search the registry for agents matching a taxonomy.

```typescript
const agents = agent.discover("analysis.*", { maxPrice: 0.05, currency: "USDC" });
```

#### `AgentHandle.stop(): Promise<void>`

Deregister from the registry and unsubscribe from the bus.

---

### `definePlugin<T>(module: PluginModule<T>): PluginModule<T>`

Type-safe passthrough for authoring plugins. Returns its argument unchanged but enforces the `PluginModule` interface at compile time.

```typescript
export default definePlugin({
  name: "my-plugin",
  type: "notifier",
  create: () => new MyNotifier(),
});
```

---

## `@clawdia/core`

### `class InMemoryBus`

In-process pub/sub bus for development and testing.

```typescript
const bus = new InMemoryBus();
await bus.connect();
```

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `connect` | `() => Promise<void>` | Initialize the bus |
| `disconnect` | `() => Promise<void>` | Tear down; clears all subscriptions |
| `publish` | `(channel, payload, sender, opts?) => Promise<string>` | Publish a message; returns message ID |
| `subscribe` | `(channel, handler) => string` | Subscribe; returns subscription ID |
| `unsubscribe` | `(subscriptionId) => void` | Remove a subscription |

**`PublishOptions`**

```typescript
interface PublishOptions {
  recipient?: string;        // Target agent name (advisory)
  correlationId?: string;    // For request-reply correlation
  ttl?: number;              // Message TTL in ms
  metadata?: Record<string, string>;
}
```

---

### `class NatsBus`

NATS-backed bus for production multi-process deployments.

```typescript
const bus = new NatsBus();
await bus.connect("nats://localhost:4222");
```

Same interface as `InMemoryBus`. Messages are serialized via JSON and published over NATS subjects that map to ClawBus channels.

---

### `class IdentityRuntime`

Parses and validates soul.md manifests.

```typescript
const runtime = new IdentityRuntime();
const identity = await runtime.register(soulMdYaml);
// Throws ZodError if manifest is invalid
```

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `register` | `(soulMd: string) => Promise<AgentIdentity>` | Parse, validate, and return identity |
| `generateKeypair` | `() => { publicKey: string; privateKey: string }` | Generate Ed25519 keypair |

---

### `class ContractEngine`

State machine for task contracts.

```typescript
const contracts = new ContractEngine(bus);
```

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `create` | `(spec) => TaskContract` | Create a contract in `draft` state |
| `transition` | `(id, event, triggeredBy, metadata?) => Promise<TaskContract>` | Apply a state machine event |
| `get` | `(id) => TaskContract \| undefined` | Retrieve a contract by ID |
| `list` | `(filter?) => TaskContract[]` | List contracts, optionally filtered by state |
| `setOutput` | `(id, output) => void` | Set the provider's output before DELIVER |

**Contract States and Events**

| From State | Valid Events |
|-----------|-------------|
| `draft` | `OFFER`, `CANCEL` |
| `offered` | `ACCEPT`, `CANCEL`, `TIMEOUT` |
| `accepted` | `FUND`, `CANCEL`, `TIMEOUT` |
| `in_progress` | `DELIVER`, `FAIL`, `TIMEOUT` |
| `delivered` | `VERIFY`, `REJECT` |
| `verified` | `SETTLE` |
| `disputed` | `RESOLVE`, `CANCEL` |
| `settled` | (terminal) |
| `cancelled` | (terminal) |

---

### `class RiskEngine`

Circuit breakers and resource budget enforcement.

```typescript
const risk = new RiskEngine(bus, {
  failureThreshold: 3,
  resetTimeoutMs: 60_000,
  defaultBudget: { maxSpendUsd: 10, maxApiCalls: 1000 },
});
```

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `recordFailure` | `(agentName) => void` | Increment failure counter; may open circuit |
| `recordSuccess` | `(agentName) => void` | Reset failure counter |
| `isOpen` | `(agentName) => boolean` | Check if circuit is open (agent blocked) |
| `setBudget` | `(agentName, budget) => void` | Set resource budget for an agent |
| `checkBudget` | `(agentName, resource, amount) => boolean` | Returns `false` if budget would be exceeded |
| `consumeBudget` | `(agentName, resource, amount) => void` | Record resource usage |
| `getBreaker` | `(agentName) => CircuitBreaker \| undefined` | Inspect circuit breaker state |

---

### `PluginRegistry` and `loadPluginsFromDirectory`

```typescript
import { PluginRegistry, loadPluginsFromDirectory } from "@clawdia/core";

const registry = new PluginRegistry();
await loadPluginsFromDirectory(registry, "./plugins");

const runtime = registry.get<IRuntimeProvider>("docker-runtime");
```

| Method | Description |
|--------|-------------|
| `register(module)` | Register a plugin module |
| `get<T>(name)` | Retrieve a plugin by name |
| `list(type?)` | List all plugins, optionally filtered by type |

---

## `@clawdia/orchestrator`

### `class ServiceRegistry`

Agent discovery catalog.

```typescript
const registry = new ServiceRegistry(bus, {
  healthCheckIntervalMs: 30_000,
  deregisterAfterMs: 120_000,
});
```

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `register` | `(identity, sessionId?) => void` | Register an agent |
| `deregister` | `(agentName) => void` | Remove an agent |
| `heartbeat` | `(agentName) => void` | Reset the deregister timer |
| `setStatus` | `(agentName, status) => void` | Set `online` \| `offline` \| `busy` |
| `get` | `(agentName) => RegistryEntry \| undefined` | Get one entry |
| `list` | `() => RegistryEntry[]` | List all entries |
| `discover` | `(query) => RegistryQueryResult` | Search with filters |
| `stats` | `() => RegistryStats` | Summary statistics |

**`RegistryQuery`**

```typescript
interface RegistryQuery {
  taxonomy?: string;          // Exact or wildcard (e.g., "analysis.*")
  maxPrice?: number;
  currency?: string;
  minReputation?: number;     // 0.0–1.0
  limit?: number;
  onlineOnly?: boolean;       // Default: true
}
```

---

### `class AgentSpawner`

Spawn and manage agent sessions.

```typescript
import { AgentSpawner } from "@clawdia/orchestrator";
import dockerRuntime from "@clawdia/plugin-runtime-docker";

const spawner = new AgentSpawner(dockerRuntime.create(), bus);
```

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `spawn` | `(opts: SpawnOptions) => Promise<AgentSession>` | Spawn a new session |
| `get` | `(sessionId) => AgentSession \| undefined` | Get session by ID |
| `kill` | `(sessionId) => Promise<void>` | Terminate a session |
| `pause` | `(sessionId) => Promise<void>` | Pause a running session |
| `resume` | `(sessionId) => Promise<void>` | Resume a paused session |
| `list` | `(state?) => AgentSession[]` | List sessions, optionally filtered by state |
| `destroyAll` | `() => Promise<void>` | Kill all sessions |

**`SpawnOptions`**

```typescript
interface SpawnOptions {
  identity: AgentIdentity;
  task?: string;
  env?: Record<string, string>;
}
```

---

## `@clawdia/economy`

### `class ReputationEngine`

Dimensional reputation scoring with time decay.

```typescript
const reputation = new ReputationEngine(bus, {
  decayFactor: 0.95,
  dimensions: ["delivery_rate", "latency_score", "dispute_rate"],
});
```

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `update` | `(agentName, event) => void` | Record a reputation event |
| `getScore` | `(agentName) => ReputationSnapshot \| undefined` | Get current score |
| `list` | `() => ReputationSnapshot[]` | All tracked agents |
| `attest` | `(agentName, attester, score, comment?) => void` | Add a peer attestation |

**Reputation events:** `task_completed`, `task_failed`, `task_disputed`, `task_late`, `verified_on_time`

---

### `class InMemoryEscrow`

In-memory escrow for development and testing.

```typescript
const escrow = new InMemoryEscrow();
```

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `fund` | `(contractId, amount, currency, payer) => EscrowHandle` | Lock funds |
| `release` | `(contractId) => void` | Release funds to provider |
| `dispute` | `(contractId, reason) => void` | Flag for dispute resolution |
| `refund` | `(contractId) => void` | Return funds to requester |
| `get` | `(contractId) => EscrowHandle \| undefined` | Get escrow entry |
| `listEscrows` | `() => EscrowHandle[]` | List all escrow entries |

---

### `class BillingEngine`

Usage metering and invoice generation.

```typescript
const billing = new BillingEngine(bus, {
  transactionFeePercent: 3,
  defaultCurrency: "USDC",
});
await billing.start();
```

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `start` | `() => Promise<void>` | Begin listening to bus events |
| `stop` | `() => void` | Stop bus subscriptions |
| `registerAgent` | `(agentName, operatorId) => void` | Track an agent's operator |
| `recordUsage` | `(record: UsageRecord) => void` | Manually record usage |
| `generateInvoice` | `(operatorId, period) => Invoice` | Generate invoice for a period |
| `getUsage` | `(agentName) => UsageRecord[]` | Get usage records for an agent |
| `getTotalRevenue` | `() => number` | Sum of all settled amounts |

---

## ClawBus Channels Reference

All typed channels used by the framework:

| Channel | Payload Type | Published By | Description |
|---------|-------------|--------------|-------------|
| `task.request` | `TaskLifecyclePayload` | `ContractEngine` | Contract state transitions |
| `task.heartbeat` | `{ contractId, agentName }` | Agents | Task execution heartbeats |
| `heartbeat` | `{ agentName, sessionId }` | `AgentSpawner` | Agent liveness signals |
| `escalation` | `EscalationPayload` | Agents | Human-in-the-loop requests |
| `settlement.complete` | `SettlementPayload` | `ContractEngine` | Contract settled |
| `registry.update` | `RegistryUpdatePayload` | `ServiceRegistry` | Agent registered/deregistered |
| `risk.alert` | `RiskAlertPayload` | `RiskEngine` | Safety alerts |

---

## Type Reference (`@clawdia/types`)

Key shared types exported from `@clawdia/types`:

```typescript
// Identity
interface AgentIdentity {
  name: string;
  displayName: string;
  description: string;
  version: string;
  operator: string;
  publicKey: string;
  capabilities: AgentCapability[];
  requirements: AgentRequirement[];
  runtime: AgentRuntime;
  reputation?: ReputationRef;
}

interface AgentCapability {
  taxonomy: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  sla: { max_latency_ms: number; availability: number };
  pricing: { model: string; amount: number; currency: string };
}

// Contracts
interface TaskContract {
  id: string;
  state: ContractState;    // draft | offered | accepted | in_progress | ...
  requester: AgentIdentity;
  provider?: AgentIdentity;
  capability: string;
  input?: unknown;
  output?: unknown;
  payment: { amount: number; currency: string };
  sla: { deadlineMs: number; maxRetries: number };
  history: ContractHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

// Registry
interface RegistryEntry {
  identity: AgentIdentity;
  registeredAt: string;
  lastSeen: string;
  status: "online" | "offline" | "busy";
  sessionId?: string;
}

// Economy
interface EscrowHandle {
  contractId: string;
  amount: number;
  currency: string;
  payer: string;
  state: "funded" | "released" | "disputed" | "refunded";
  createdAt: string;
  updatedAt: string;
}
```
