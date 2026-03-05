/**
 * Clawdia Framework — Quickstart
 *
 * A complete two-agent system in under 30 lines.
 * Run with: pnpm tsx examples/quickstart.ts
 */

import { InMemoryBus, ContractEngine } from "@clawdia/core";
import { ServiceRegistry } from "@clawdia/orchestrator";
import { createAgent } from "@clawdia/sdk";

async function main() {
  // ── Shared infrastructure ──────────────────────────────────────────────────

  const bus = new InMemoryBus();
  await bus.connect();

  const registry = new ServiceRegistry(bus);
  const contracts = new ContractEngine(bus);

  // ── Agent 1: The Greeter ───────────────────────────────────────────────────

  await createAgent({
    soulMd: `
version: "2.0"
kind: AgentManifest
identity:
  name: greeter
  display_name: "Greeter"
  description: "Greets users by name"
  version: "1.0.0"
  operator: quickstart
capabilities:
  provides:
    - taxonomy: social.greeting
      description: "Greet a person by name and return a welcome message"
      sla: { max_latency_ms: 1000, availability: 0.99 }
      pricing: { model: per_request, amount: 0.001, currency: USDC }
runtime: {}
`,
    bus,
    registry,
    contracts,
    async onTask({ input }) {
      const { name } = input as { name: string };
      return { message: `Hello, ${name}! Welcome to the Clawdia network.` };
    },
  });

  // ── Agent 2: The Coordinator — discovers and hires the Greeter ────────────

  const coordinator = await createAgent({
    soulMd: `
version: "2.0"
kind: AgentManifest
identity:
  name: coordinator
  display_name: "Coordinator"
  description: "Coordinates tasks by hiring specialist agents"
  version: "1.0.0"
  operator: quickstart
capabilities:
  provides:
    - taxonomy: orchestration.coordinate
      description: "Coordinate multi-agent workflows"
      sla: { max_latency_ms: 60000, availability: 0.99 }
      pricing: { model: per_request, amount: 0.00, currency: USDC }
runtime: {}
`,
    bus,
    registry,
    contracts,
  });

  const result = await coordinator.hire({
    agentName: "greeter",
    capability: "social.greeting",
    input: { name: "Alice" },
    payment: { amount: 0.001, currency: "USDC" },
  });

  console.log(result.output);
  // { message: "Hello, Alice! Welcome to the Clawdia network." }

  console.log(`Contract ${result.contractId} settled in ${result.durationMs}ms`);

  // ── Cleanup ────────────────────────────────────────────────────────────────

  await coordinator.stop();
  await bus.disconnect();
}

main().catch(console.error);
