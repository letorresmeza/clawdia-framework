/**
 * Multi-Agent Workflow Demo
 *
 * Demonstrates a full multi-agent workflow where a coordinator agent
 * hires 4 specialist agents to launch a new SaaS product:
 *
 *   coordinator
 *     ├── research-agent     → market research
 *     ├── data-analyst       → analyze research data
 *     ├── content-writer     → generate marketing copy
 *     └── code-builder       → document the implementation
 *
 * All agents communicate via InMemoryBus with full contract lifecycle
 * (DRAFT → OFFERED → ACCEPTED → IN_PROGRESS → DELIVERED → VERIFIED → SETTLED).
 *
 * Run: npx tsx examples/demo/multi-agent-workflow.ts
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryBus, ContractEngine } from "@clawdia/core";
import { ServiceRegistry } from "@clawdia/orchestrator";
import { ReputationEngine, InMemoryEscrow, BillingEngine } from "@clawdia/economy";
import { createAgent } from "@clawdia/sdk";
import type { AgentTask, HireResult } from "@clawdia/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BOLD = (s: string) => `\x1b[1m${s}\x1b[0m`;
const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`;
const GREEN = (s: string) => `\x1b[32m${s}\x1b[0m`;
const CYAN = (s: string) => `\x1b[36m${s}\x1b[0m`;
const YELLOW = (s: string) => `\x1b[33m${s}\x1b[0m`;
const MAGENTA = (s: string) => `\x1b[35m${s}\x1b[0m`;

function sep(char = "─", width = 60): string {
  return DIM(char.repeat(width));
}

function readSoul(relPath: string): string {
  return readFileSync(join(__dirname, "..", relPath), "utf-8");
}

function banner(text: string): void {
  console.log("\n" + sep("═"));
  console.log(BOLD(`  ${text}`));
  console.log(sep("═") + "\n");
}

function step(n: number, label: string): void {
  console.log(`\n${CYAN(`Step ${n}:`)} ${BOLD(label)}`);
  console.log(sep());
}

function result(label: string, value: unknown): void {
  const str =
    typeof value === "string"
      ? value.split("\n").slice(0, 4).join("\n")
      : JSON.stringify(value, null, 2).split("\n").slice(0, 8).join("\n");
  console.log(`${YELLOW(label + ":")} ${str}${str.split("\n").length >= 4 ? DIM("\n  [truncated]") : ""}`);
}

// ─── Coordinator task handler ─────────────────────────────────────────────────

async function coordinatorTask({ ctx }: AgentTask): Promise<unknown> {
  const results: Record<string, HireResult> = {};

  // ── Step A: Research the market ──────────────────────────────────────────
  console.log(`\n  ${MAGENTA("→")} Hiring research-agent for web search…`);
  results["search"] = await ctx.hire({
    agentName: "research-agent",
    capability: "research.web.search",
    input: {
      query: "autonomous AI agent economy 2026",
      max_results: 5,
    },
    payment: { amount: 0.02, currency: "USDC" },
  });
  console.log(`    ${GREEN("✓")} Search complete in ${results["search"].durationMs}ms`);

  // ── Step B: Synthesize research ───────────────────────────────────────────
  const searchOut = results["search"].output as { results: Array<{ url: string }> };
  const sourceUrls = searchOut.results.slice(0, 3).map((r) => r.url);

  console.log(`  ${MAGENTA("→")} Hiring research-agent for synthesis…`);
  results["synthesis"] = await ctx.hire({
    agentName: "research-agent",
    capability: "research.synthesis",
    input: {
      topic: "Autonomous AI Agent Economy",
      sources: sourceUrls,
      output_format: "executive_brief",
    },
    payment: { amount: 0.08, currency: "USDC" },
  });
  console.log(`    ${GREEN("✓")} Synthesis complete in ${results["synthesis"].durationMs}ms`);

  // ── Step C: Analyze market data ───────────────────────────────────────────
  const csvData = [
    "quarter,revenue_usd,agent_count,transactions",
    "Q1 2025,1200000,450,8900",
    "Q2 2025,1850000,720,14200",
    "Q3 2025,2900000,1100,22800",
    "Q4 2025,4200000,1650,35400",
    "Q1 2026,6100000,2400,51200",
  ].join("\n");

  console.log(`  ${MAGENTA("→")} Hiring data-analyst for market data…`);
  results["analysis"] = await ctx.hire({
    agentName: "data-analyst",
    capability: "analysis.data.csv",
    input: { csv_data: csvData, operations: ["describe", "trend"] },
    payment: { amount: 0.05, currency: "USDC" },
  });
  console.log(`    ${GREEN("✓")} Analysis complete in ${results["analysis"].durationMs}ms`);

  // ── Step D: Generate marketing copy ──────────────────────────────────────
  const synthOut = results["synthesis"].output as { key_findings: string[] };

  console.log(`  ${MAGENTA("→")} Hiring content-writer for marketing copy…`);
  results["marketing"] = await ctx.hire({
    agentName: "content-writer",
    capability: "content.writing.marketing",
    input: {
      product_name: "Clawdia Framework",
      product_description: "Agent infrastructure for the autonomous economy",
      target_audience: "AI engineers and autonomy researchers",
      tone: "inspiring",
      content_type: "landing_page",
      key_benefits: synthOut.key_findings.slice(0, 3),
      word_limit: 250,
    },
    payment: { amount: 0.06, currency: "USDC" },
  });
  console.log(`    ${GREEN("✓")} Marketing copy in ${results["marketing"].durationMs}ms`);

  // ── Step E: Write technical documentation ─────────────────────────────────
  console.log(`  ${MAGENTA("→")} Hiring content-writer for technical docs…`);
  results["docs"] = await ctx.hire({
    agentName: "content-writer",
    capability: "content.writing.technical",
    input: {
      subject: "Clawdia Framework SDK",
      doc_type: "readme",
      audience_level: "intermediate",
      sections: ["Overview", "Installation", "Quick Start", "createAgent API", "hire() API"],
      code_samples: [
        {
          language: "typescript",
          code: `import { createAgent } from "@clawdia/sdk";

const agent = await createAgent({
  soulMd: fs.readFileSync("soul.md", "utf-8"),
  bus, registry, contracts,
  async onTask({ input, ctx }) {
    return { result: await process(input) };
  },
});`,
        },
      ],
    },
    payment: { amount: 0.10, currency: "USDC" },
  });
  console.log(`    ${GREEN("✓")} Technical docs in ${results["docs"].durationMs}ms`);

  // Aggregate cost
  const totalCost = Object.values(results).reduce((s, r) => s + (r as HireResult).durationMs, 0);
  const totalPayment = 0.02 + 0.08 + 0.05 + 0.06 + 0.10;

  return {
    status: "complete",
    steps_completed: Object.keys(results).length,
    total_duration_ms: totalCost,
    total_payment_usdc: totalPayment,
    deliverables: {
      research_summary: (results["synthesis"]!.output as { title: string }).title,
      market_trends: (results["analysis"]!.output as { trends: unknown[] }).trends,
      marketing_headline: (results["marketing"]!.output as { headline: string }).headline,
      docs_sections: (results["docs"]!.output as { sections_written: string[] }).sections_written,
    },
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  banner("Clawdia Multi-Agent Workflow Demo");
  console.log("A coordinator agent hires 4 specialist agents to launch a product.\n");

  // ── Infrastructure setup ────────────────────────────────────────────────────
  step(1, "Setting up shared infrastructure");

  const bus = new InMemoryBus();
  await bus.connect();
  console.log(`  ${GREEN("✓")} InMemoryBus connected`);

  const registry = new ServiceRegistry(bus);
  const contracts = new ContractEngine(bus);
  const reputation = new ReputationEngine(bus);
  const escrow = new InMemoryEscrow(bus);
  const billing = new BillingEngine(bus);

  reputation.start();
  escrow.start();
  billing.start();
  console.log(`  ${GREEN("✓")} Economy engines started (reputation, escrow, billing)`);

  // ── Spawn all 5 agents ───────────────────────────────────────────────────────
  step(2, "Spawning agents from soul.md manifests");

  const sharedOpts = { bus, registry, contracts };

  const [researchAgent, dataAnalyst, contentWriter, codeBuilder, tradingBot] = await Promise.all([
    createAgent({
      ...sharedOpts,
      soulMd: readSoul("research-agent/soul.md"),
      async onTask({ input, contract, ctx }) {
        ctx.log(`Task: ${contract.capability}`);
        const { query, max_results = 5 } = input as { query?: string; topic?: string; sources?: string[]; max_results?: number; output_format?: string };
        if (contract.capability === "research.web.search") {
          const q = query ?? "default query";
          return {
            results: Array.from({ length: Math.min(max_results, 5) }, (_, i) => ({
              title: `${q} — Result ${i + 1}`,
              url: `https://example.com/${q.replace(/\s+/g, "-")}-${i + 1}`,
              snippet: `Comprehensive coverage of ${q} including recent developments.`,
              relevance_score: Math.round((1 - i * 0.12) * 100) / 100,
            })),
            query_expansion: [q, `${q} 2026`, `${q} trends`],
            total_found: Math.min(max_results, 5),
          };
        }
        // synthesis
        const synthInput = input as { topic: string; sources: string[] };
        return {
          title: `Research Report: ${synthInput.topic}`,
          summary: `Executive brief on ${synthInput.topic} based on ${synthInput.sources.length} sources. Key insight: autonomous agent adoption is accelerating at 40% QoQ.`,
          key_findings: [
            "Agent-to-agent commerce grew 3.4× in 2025",
            "Smart contract settlement reduces overhead by 78%",
            "Multi-agent pipelines outperform monolithic LLMs on complex tasks",
          ],
          citations: synthInput.sources.slice(0, 2).map((s, i) => ({ source: s, claim: `Finding ${i + 1}` })),
          confidence: 0.87,
          word_count: 180,
        };
      },
    }),

    createAgent({
      ...sharedOpts,
      soulMd: readSoul("data-analyst/soul.md"),
      async onTask({ input, contract, ctx }) {
        ctx.log(`Analyzing: ${contract.capability}`);
        const { csv_data, operations = ["describe"] } = input as { csv_data: string; operations?: string[] };
        const lines = csv_data.trim().split("\n");
        const headers = (lines[0] ?? "").split(",");
        const rows = lines.slice(1);
        const stats: Record<string, unknown> = {};
        headers.forEach((h, i) => {
          const vals = rows.map((r) => parseFloat(r.split(",")[i] ?? "")).filter((n) => !isNaN(n));
          if (vals.length > 0) {
            const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
            stats[h.trim()] = { count: vals.length, mean: Math.round(mean), min: Math.min(...vals), max: Math.max(...vals) };
          }
        });
        return {
          rows_analyzed: rows.length,
          columns_analyzed: headers.length,
          statistics: stats,
          correlations: [],
          anomalies: [],
          trends: operations.includes("trend") ? headers.slice(1, 3).map((h) => ({
            column: h.trim(), direction: "up", confidence: 0.91,
          })) : [],
          summary: `${rows.length} rows analyzed. All metrics show consistent upward trends.`,
        };
      },
    }),

    createAgent({
      ...sharedOpts,
      soulMd: readSoul("content-writer/soul.md"),
      async onTask({ input, contract, ctx }) {
        ctx.log(`Writing: ${contract.capability}`);
        if (contract.capability === "content.writing.marketing") {
          const { product_name, product_description, key_benefits = [] } = input as {
            product_name: string; product_description: string; key_benefits?: string[];
          };
          const content = `# ${product_name}\n\n> ${product_description}\n\n## Why ${product_name}?\n\n${key_benefits.map((b) => `• ${b}`).join("\n")}\n\n## Get Started\n\nJoin the autonomous economy today.`;
          return { content, headline: `${product_name}: ${product_description.slice(0, 50)}`, cta: "Get started free", word_count: content.split(" ").length, variants: [{ variant: "A", content }] };
        }
        // technical
        const { subject, sections = ["Overview", "Installation", "Usage"] } = input as { subject: string; sections?: string[]; code_samples?: Array<{ language: string; code: string }> };
        const markdown = `# ${subject}\n\n${sections.map((s) => `## ${s}\n\n_Documentation for ${s.toLowerCase()}._\n`).join("\n")}`;
        return { markdown, sections_written: sections, word_count: markdown.split(" ").length, estimated_read_time_min: 3 };
      },
    }),

    // Existing agents from examples/
    createAgent({
      ...sharedOpts,
      soulMd: readSoul("coding-agents/soul.md"),
      async onTask({ input, contract, ctx }) {
        ctx.log(`Coding: ${contract.capability}`);
        return {
          files_changed: [{ path: "src/agent.ts", action: "created" }],
          tests_passed: true,
          pr_url: "https://github.com/example/repo/pull/42",
        };
      },
    }),

    createAgent({
      ...sharedOpts,
      soulMd: readSoul("trading-bot/soul.md"),
      async onTask({ input, contract, ctx }) {
        ctx.log(`Trading: ${contract.capability}`);
        const { topic } = input as { topic: string };
        return {
          sentiment_score: 0.72,
          confidence: 0.88,
          signals: [{ source: "rss", signal: `Positive momentum for ${topic}`, weight: 0.7 }],
          summary: `Market sentiment for ${topic} is bullish based on recent news flow.`,
        };
      },
    }),
  ]);

  for (const agent of [researchAgent, dataAnalyst, contentWriter, codeBuilder, tradingBot]) {
    console.log(`  ${GREEN("✓")} ${agent.identity.displayName} ${DIM(`(${agent.identity.name})`)}`);
  }

  // ── Show the registry ────────────────────────────────────────────────────────
  step(3, "Registry — all online agents");

  const allAgents = registry.list();
  for (const entry of allAgents) {
    const caps = entry.identity.capabilities.map((c) => c.taxonomy).join(", ");
    console.log(`  ${GREEN("●")} ${entry.identity.name.padEnd(24)} ${DIM(caps)}`);
  }
  console.log(`\n  Total: ${allAgents.length} agents online`);

  // ── Discovery demo ────────────────────────────────────────────────────────────
  step(4, "Discovery — searching registry");

  const researchCaps = registry.discover({ taxonomy: "research.*" });
  console.log(`  research.* → ${researchCaps.entries.map((e) => e.identity.name).join(", ")}`);

  const cheapAgents = registry.discover({ maxPrice: 0.05, currency: "USDC" });
  console.log(`  ≤ 0.05 USDC → ${cheapAgents.entries.map((e) => e.identity.name).join(", ")}`);

  const analysisAgents = registry.discover({ taxonomy: "analysis.*" });
  console.log(`  analysis.* → ${analysisAgents.entries.map((e) => e.identity.name).join(", ")}`);

  // ── Spawn coordinator and run the full workflow ────────────────────────────────
  step(5, "Coordinator runs multi-agent product launch workflow");

  const COORDINATOR_SOUL = `
version: "2.0"
kind: AgentManifest
identity:
  name: coordinator
  display_name: "Product Launch Coordinator"
  description: "Orchestrates multi-agent product launch workflows"
  version: "1.0.0"
  operator: "clawdia-labs"
capabilities:
  provides:
    - taxonomy: orchestration.product.launch
      description: "Coordinate a full product launch using specialist agents"
      input_schema: { type: object }
      output_schema: { type: object }
      sla:
        max_latency_ms: 120000
        availability: 0.99
      pricing:
        model: per_request
        amount: 0.50
        currency: USDC
runtime:
  model: "claude-sonnet-4-6"
`;

  const coordinator = await createAgent({
    ...sharedOpts,
    soulMd: COORDINATOR_SOUL,
    onTask: coordinatorTask,
  });
  console.log(`  ${GREEN("✓")} Coordinator online`);
  console.log(`  Running workflow…\n`);

  // Trigger the coordinator's workflow
  const workflowContract = contracts.create({
    requester: coordinator.identity,
    provider: coordinator.identity,
    capability: "orchestration.product.launch",
    inputSchema: {},
    outputSchema: {},
    input: { product: "Clawdia Framework" },
    payment: { amount: 0.50, currency: "USDC" },
    sla: { deadlineMs: 120_000, maxRetries: 1 },
    verification: { method: "schema_match" },
  });

  await contracts.transition(workflowContract.id, "OFFER", coordinator.identity.name);
  await contracts.transition(workflowContract.id, "ACCEPT", coordinator.identity.name);
  await contracts.transition(workflowContract.id, "FUND", coordinator.identity.name);

  // ── Results ───────────────────────────────────────────────────────────────────
  step(6, "Workflow results");

  const finalContract = contracts.get(workflowContract.id)!;
  const output = finalContract.output as {
    status: string;
    steps_completed: number;
    total_duration_ms: number;
    total_payment_usdc: number;
    deliverables: {
      research_summary: string;
      market_trends: Array<{ column: string; direction: string }>;
      marketing_headline: string;
      docs_sections: string[];
    };
  };

  result("Status", output.status);
  result("Steps completed", `${output.steps_completed} sub-tasks`);
  result("Total payment", `${output.total_payment_usdc.toFixed(2)} USDC`);
  result("Research summary", output.deliverables.research_summary);
  result("Market trends", output.deliverables.market_trends.map((t) => `${t.column}: ${t.direction}`).join(", "));
  result("Marketing headline", output.deliverables.marketing_headline);
  result("Docs sections", output.deliverables.docs_sections.join(", "));

  // ── Contract stats ─────────────────────────────────────────────────────────────
  step(7, "Contract statistics");
  const contractStats = contracts.stats();
  console.log(`  ${GREEN("settled")}:     ${contractStats["settled"] ?? 0}`);
  console.log(`  in_progress:  ${contractStats["in_progress"] ?? 0}`);
  console.log(`  ${DIM("disputed")}:    ${contractStats["disputed"] ?? 0}`);

  // ── Economy summary ─────────────────────────────────────────────────────────
  const repStats = reputation.stats();
  const escrowStats = escrow.stats();
  const billingStats = billing.stats();

  console.log(`\n  Reputation: ${repStats.totalAgents} agents tracked, avg score ${(repStats.averageScore * 100).toFixed(0)}%`);
  console.log(`  Escrow: ${escrowStats.totalEscrows} total, ${escrowStats.released} released`);
  console.log(`  Billing: ${billingStats.totalRecords} usage records, $${billingStats.totalRevenue.toFixed(4)} revenue`);

  // ── Cleanup ───────────────────────────────────────────────────────────────────
  banner("Demo complete ✓");
  console.log(DIM("Stopping all agents and disconnecting…\n"));

  await Promise.all([
    coordinator.stop(),
    researchAgent.stop(),
    dataAnalyst.stop(),
    contentWriter.stop(),
    codeBuilder.stop(),
    tradingBot.stop(),
  ]);
  reputation.stop();
  escrow.stop();
  billing.stop();
  registry.destroy();
  await bus.disconnect();

  console.log(GREEN("All agents stopped. ClawBus disconnected."));
}

main().catch((err) => {
  console.error("\x1b[31mFatal:\x1b[0m", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
