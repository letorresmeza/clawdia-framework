/**
 * Research Agent — example Clawdia agent using the SDK.
 *
 * Demonstrates how to build a production-ready agent in under 50 lines.
 * In a real deployment this would call search APIs and LLMs; here we
 * return deterministic simulated outputs so the agent can run without
 * external credentials.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgent } from "@clawdia/sdk";
import { InMemoryBus } from "@clawdia/core";
import { ServiceRegistry, AgentSpawner } from "@clawdia/orchestrator";
import { ContractEngine } from "@clawdia/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const soulMd = readFileSync(join(__dirname, "..", "soul.md"), "utf-8");

// ─── Task handlers ────────────────────────────────────────────────────────────

async function handleWebSearch(input: unknown): Promise<unknown> {
  const { query, max_results = 5 } = input as { query: string; max_results?: number };

  // Simulate search results (replace with real search API call in production)
  const results = Array.from({ length: Math.min(max_results, 5) }, (_, i) => ({
    title: `${query} — Result ${i + 1}`,
    url: `https://example.com/${query.replace(/\s+/g, "-").toLowerCase()}-${i + 1}`,
    snippet: `Comprehensive information about ${query}. This result covers key aspects including background, applications, and recent developments.`,
    relevance_score: Math.round((1 - i * 0.12) * 100) / 100,
  }));

  return {
    results,
    query_expansion: [query, `${query} overview`, `${query} applications`],
    total_found: results.length,
  };
}

async function handleSynthesis(input: unknown): Promise<unknown> {
  const { topic, sources, output_format = "report" } = input as {
    topic: string;
    sources: string[];
    output_format?: string;
  };

  // Simulate synthesis (replace with LLM call in production)
  const keyFindings = [
    `${topic} is a rapidly evolving field with significant implications.`,
    `Analysis of ${sources.length} sources reveals consistent patterns in adoption.`,
    `Key stakeholders include researchers, practitioners, and policy makers.`,
  ];

  const summary =
    output_format === "bullet_points"
      ? keyFindings.map((f) => `• ${f}`).join("\n")
      : `Research on "${topic}" based on ${sources.length} source(s):\n\n${keyFindings.join(" ")}`;

  return {
    title: `Research Report: ${topic}`,
    summary,
    key_findings: keyFindings,
    citations: sources.slice(0, 3).map((s, i) => ({
      source: s,
      claim: keyFindings[i] ?? keyFindings[0],
    })),
    confidence: 0.82,
    word_count: summary.split(" ").length,
  };
}

// ─── Main agent entrypoint ────────────────────────────────────────────────────

export async function startResearchAgent(opts: {
  bus: ReturnType<typeof InMemoryBus.prototype.connect> extends Promise<void>
    ? InstanceType<typeof InMemoryBus>
    : never;
  registry: ServiceRegistry;
  contracts: ContractEngine;
}): Promise<ReturnType<typeof createAgent>> {
  return createAgent({
    soulMd,
    bus: opts.bus as unknown as Parameters<typeof createAgent>[0]["bus"],
    registry: opts.registry,
    contracts: opts.contracts,
    async onTask({ input, contract, ctx }) {
      ctx.log(`Handling task: ${contract.capability}`);

      switch (contract.capability) {
        case "research.web.search":
          return handleWebSearch(input);
        case "research.synthesis":
          return handleSynthesis(input);
        default:
          throw new Error(`Unknown capability: ${contract.capability}`);
      }
    },
    onError: (err, context) => {
      console.error(`[research-agent] Error in ${context ?? "unknown"}:`, err.message);
    },
  });
}

// ─── Standalone runner (for direct execution) ─────────────────────────────────

async function main(): Promise<void> {
  const bus = new InMemoryBus();
  await bus.connect();

  const registry = new ServiceRegistry(bus);
  const contracts = new ContractEngine(bus);

  const agent = await createAgent({
    soulMd,
    bus,
    registry,
    contracts,
    async onTask({ input, contract, ctx }) {
      ctx.log(`Handling task: ${contract.capability}`);

      switch (contract.capability) {
        case "research.web.search":
          return handleWebSearch(input);
        case "research.synthesis":
          return handleSynthesis(input);
        default:
          throw new Error(`Unknown capability: ${contract.capability}`);
      }
    },
  });

  console.log(`[research-agent] Online — ${agent.identity.capabilities.length} capabilities`);
  console.log(`[research-agent] Registered as: ${agent.identity.name}`);

  // Graceful shutdown
  const shutdown = async () => {
    await agent.stop();
    await bus.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Run if this is the entry point
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isMain) main().catch(console.error);
