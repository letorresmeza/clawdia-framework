# Building Plugins for Clawdia

Plugins are swappable adapters that extend Clawdia at every integration point. This guide shows you how to build agent adapters, runtime providers, data connectors, notifiers, and settlement rails.

## Plugin Anatomy

Every plugin:
1. Implements exactly one interface from `@clawdia/types`
2. Exports a `PluginModule` as its default export
3. Uses `definePlugin()` from `@clawdia/sdk` for type safety
4. Has no hard dependencies on other plugins (uses DI via constructor)

```typescript
// plugins/my-plugin/src/index.ts
import { definePlugin } from "@clawdia/sdk";
import type { INotifierPlugin } from "@clawdia/types";

class MyNotifier implements INotifierPlugin {
  readonly name = "my-notifier";

  async notify(notification: Notification): Promise<void> {
    // ...implementation
  }
}

export default definePlugin({
  name: "my-notifier",
  type: "notifier",
  create: () => new MyNotifier(),
});
```

---

## Agent Adapters (`IAgentAdapter`)

Agent adapters connect Clawdia's task lifecycle to an AI model or agent runtime.

### Interface

```typescript
interface IAgentAdapter {
  readonly name: string;
  execute(task: TaskPayload, config: AgentConfig): AsyncIterable<TaskChunk>;
  getStatus(): Promise<AgentStatus>;
}
```

### Example: OpenAI Agent Adapter

```typescript
import OpenAI from "openai";
import { definePlugin } from "@clawdia/sdk";
import type { IAgentAdapter, TaskPayload, TaskChunk, AgentConfig, AgentStatus } from "@clawdia/types";

class OpenAIAdapter implements IAgentAdapter {
  readonly name = "openai-adapter";
  private client = new OpenAI();

  async *execute(task: TaskPayload, config: AgentConfig): AsyncIterable<TaskChunk> {
    const stream = await this.client.chat.completions.create({
      model: config.model ?? "gpt-4o",
      messages: [
        { role: "system", content: config.systemPrompt ?? "You are a helpful agent." },
        { role: "user", content: JSON.stringify(task.input) },
      ],
      stream: true,
    });

    let accumulated = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta.content ?? "";
      accumulated += delta;
      yield { type: "text", content: delta, accumulated };
    }

    yield { type: "done", output: JSON.parse(accumulated) };
  }

  async getStatus(): Promise<AgentStatus> {
    return { healthy: true, activeContracts: 0 };
  }
}

export default definePlugin({
  name: "openai-adapter",
  type: "agent",
  create: () => new OpenAIAdapter(),
});
```

---

## Runtime Providers (`IRuntimeProvider`)

Runtime providers control where agents run: Docker containers, VMs, local processes, etc.

### Interface

```typescript
interface IRuntimeProvider {
  readonly name: string;
  spawn(config: RuntimeConfig): Promise<RuntimeHandle>;
  kill(handle: RuntimeHandle): Promise<void>;
  pause(handle: RuntimeHandle): Promise<void>;
  resume(handle: RuntimeHandle): Promise<void>;
  exec(handle: RuntimeHandle, command: string[]): Promise<ExecResult>;
  healthCheck(handle: RuntimeHandle): Promise<{ alive: boolean; details?: string }>;
  logs(handle: RuntimeHandle): AsyncIterable<string>;
}
```

### Example: Minimal In-Memory Runtime

```typescript
import { definePlugin } from "@clawdia/sdk";
import type { IRuntimeProvider, RuntimeConfig, RuntimeHandle, ExecResult } from "@clawdia/types";

class InMemoryRuntime implements IRuntimeProvider {
  readonly name = "in-memory";
  private handles = new Map<string, { id: string; alive: boolean }>();

  async spawn(config: RuntimeConfig): Promise<RuntimeHandle> {
    const id = crypto.randomUUID();
    this.handles.set(id, { id, alive: true });
    return { id, name: config.name, provider: this.name };
  }

  async kill(handle: RuntimeHandle): Promise<void> {
    const h = this.handles.get(handle.id);
    if (h) h.alive = false;
  }

  async pause(_handle: RuntimeHandle): Promise<void> {}
  async resume(_handle: RuntimeHandle): Promise<void> {}

  async exec(_handle: RuntimeHandle, command: string[]): Promise<ExecResult> {
    return { exitCode: 0, stdout: `ran: ${command.join(" ")}`, stderr: "" };
  }

  async healthCheck(handle: RuntimeHandle): Promise<{ alive: boolean }> {
    return { alive: this.handles.get(handle.id)?.alive ?? false };
  }

  logs(_handle: RuntimeHandle): AsyncIterable<string> {
    return (async function* () {})();
  }
}

export default definePlugin({
  name: "in-memory-runtime",
  type: "runtime",
  create: () => new InMemoryRuntime(),
});
```

---

## Data Connectors (`IDataConnector`)

Data connectors stream events from external sources into the ClawBus.

### Interface

```typescript
interface IDataConnector {
  readonly name: string;
  subscribe(topic: string, handler: (event: DataEvent) => Promise<void>): Promise<string>;
  unsubscribe(subscriptionId: string): Promise<void>;
  query(params: QueryParams): Promise<QueryResult>;
}
```

### Example: WebSocket Data Connector

```typescript
import WebSocket from "ws";
import { definePlugin } from "@clawdia/sdk";
import type { IDataConnector, DataEvent, QueryResult } from "@clawdia/types";

class WebSocketConnector implements IDataConnector {
  readonly name = "websocket-connector";
  private sockets = new Map<string, WebSocket>();

  async subscribe(
    topic: string,
    handler: (event: DataEvent) => Promise<void>,
  ): Promise<string> {
    const subId = crypto.randomUUID();
    const ws = new WebSocket(`wss://data.example.com/${topic}`);

    ws.on("message", async (data) => {
      await handler({
        id: crypto.randomUUID(),
        source: this.name,
        topic,
        timestamp: new Date().toISOString(),
        payload: JSON.parse(data.toString()),
      });
    });

    this.sockets.set(subId, ws);
    return subId;
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    this.sockets.get(subscriptionId)?.close();
    this.sockets.delete(subscriptionId);
  }

  async query(_params: unknown): Promise<QueryResult> {
    return { data: [], total: 0 };
  }
}

export default definePlugin({
  name: "websocket-connector",
  type: "data",
  create: () => new WebSocketConnector(),
});
```

---

## Notifier Plugins (`INotifierPlugin`)

Notifiers deliver alerts to external systems.

### Interface

```typescript
interface INotifierPlugin {
  readonly name: string;
  notify(notification: Notification): Promise<void>;
}
```

### Example: Discord Notifier

```typescript
import { definePlugin } from "@clawdia/sdk";
import type { INotifierPlugin, Notification } from "@clawdia/types";

class DiscordNotifier implements INotifierPlugin {
  readonly name = "discord-notifier";

  constructor(private webhookUrl: string) {}

  async notify(notification: Notification): Promise<void> {
    await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `**[${notification.severity.toUpperCase()}]** ${notification.title}\n${notification.body}`,
      }),
    });
  }
}

export default definePlugin({
  name: "discord-notifier",
  type: "notifier",
  create: () => new DiscordNotifier(process.env["DISCORD_WEBHOOK_URL"]!),
});
```

---

## Settlement Rails (`ISettlementRail`)

Settlement rails connect Clawdia contracts to real payment systems.

### Interface

```typescript
interface ISettlementRail {
  readonly name: string;
  settle(contractId: string, amount: number, currency: string, recipient: string): Promise<string>;
  getBalance(address: string, currency: string): Promise<number>;
}
```

### Example: Stripe Settlement

```typescript
import Stripe from "stripe";
import { definePlugin } from "@clawdia/sdk";
import type { ISettlementRail } from "@clawdia/types";

class StripeRail implements ISettlementRail {
  readonly name = "stripe-rail";
  private stripe: Stripe;

  constructor(apiKey: string) {
    this.stripe = new Stripe(apiKey);
  }

  async settle(
    contractId: string,
    amount: number,
    currency: string,
    recipient: string,
  ): Promise<string> {
    const transfer = await this.stripe.transfers.create({
      amount: Math.round(amount * 100), // cents
      currency: currency.toLowerCase(),
      destination: recipient,
      metadata: { contractId },
    });
    return transfer.id;
  }

  async getBalance(address: string, _currency: string): Promise<number> {
    const balance = await this.stripe.balance.retrieve({ stripeAccount: address });
    return (balance.available[0]?.amount ?? 0) / 100;
  }
}

export default definePlugin({
  name: "stripe-rail",
  type: "settlement",
  create: () => new StripeRail(process.env["STRIPE_API_KEY"]!),
});
```

---

## Plugin Package Structure

```
plugins/my-plugin/
  src/
    index.ts          # Plugin implementation + default export
    __tests__/
      my-plugin.test.ts
  package.json
  tsconfig.json
```

### `package.json`

```json
{
  "name": "@clawdia/plugin-my-plugin",
  "version": "0.1.0",
  "description": "My custom plugin for Clawdia Framework",
  "keywords": ["clawdia", "plugin", "agent"],
  "repository": {
    "type": "git",
    "url": "https://github.com/letorresmeza/clawdia-framework"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@clawdia/sdk": "workspace:*",
    "@clawdia/types": "workspace:*"
  },
  "devDependencies": {
    "vitest": "^2.0.0"
  },
  "license": "MIT"
}
```

### `tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "references": [
    { "path": "../../packages/types" },
    { "path": "../../packages/sdk" }
  ]
}
```

---

## Testing Plugins

Use `InMemoryBus` and mock identities to test without real infrastructure:

```typescript
import { describe, it, expect } from "vitest";
import { InMemoryBus } from "@clawdia/core";
import myPlugin from "../src/index.js";

describe("MyNotifier", () => {
  it("sends notifications", async () => {
    const notifier = myPlugin.create();
    const messages: string[] = [];

    // Intercept output
    const captured: unknown[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => captured.push(args));

    await notifier.notify({
      id: "test-1",
      severity: "info",
      title: "Test",
      body: "Hello",
      timestamp: new Date().toISOString(),
    });

    expect(captured.length).toBeGreaterThan(0);
  });
});
```

---

## Loading Plugins at Runtime

```typescript
import { PluginRegistry, loadPluginsFromDirectory } from "@clawdia/core";
import type { IRuntimeProvider } from "@clawdia/types";

const registry = new PluginRegistry();

// Load from a directory of compiled plugin packages
await loadPluginsFromDirectory(registry, "./plugins");

// Or register directly
import myPlugin from "@clawdia/plugin-my-plugin";
registry.register(myPlugin);

// Retrieve by name and type
const runtime = registry.get<IRuntimeProvider>("my-runtime");
```

---

## Publishing Your Plugin

1. Build and test: `pnpm build && pnpm test`
2. Publish to npm: `pnpm publish --access public`
3. Open a PR to add it to the [plugin registry](https://github.com/letorresmeza/clawdia-framework/discussions) — include your plugin name, type, and a short description.

Naming convention: `@clawdia/plugin-{type}-{name}` for official plugins, `@yourorg/clawdia-plugin-{name}` for community plugins.
