/**
 * Clawdia Broker — Agent-of-Agents Demo
 *
 * Boots the full framework (ClawBus, ServiceRegistry, ContractEngine),
 * registers Clawdia the Broker plus 4 specialist agents, then runs a
 * full brokered orchestration job end-to-end.
 *
 * Usage:
 *   npx tsx examples/orchestrator-agent/broker.ts
 *   npx tsx examples/orchestrator-agent/broker.ts "Research the top 5 AI agent frameworks"
 *
 * The broker:
 *   1. Decomposes the request into a DAG of subtasks
 *   2. Discovers best specialist agents for each subtask
 *   3. Creates task contracts and funds escrow
 *   4. Monitors execution and handles failures
 *   5. Assembles output and quality-checks
 *   6. Reports total cost, margin earned, per-agent P&L
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryBus, ContractEngine } from "@clawdia/core";
import { ServiceRegistry } from "@clawdia/orchestrator";
import { ReputationEngine, InMemoryEscrow, BillingEngine } from "@clawdia/economy";
import { createAgent } from "@clawdia/sdk";
import type { AgentTask } from "@clawdia/sdk";
import { TaskDecomposer, AgentMatcher, WorkflowExecutor, OutputAssembler } from "@clawdia/plugin-agent-orchestrator";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMEWORK_ROOT = join(__dirname, "..", "..");

// ─── ANSI helpers ─────────────────────────────────────────────────────────────
const BOLD = (s: string) => `\x1b[1m${s}\x1b[0m`;
const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`;
const GREEN = (s: string) => `\x1b[32m${s}\x1b[0m`;
const CYAN = (s: string) => `\x1b[36m${s}\x1b[0m`;
const YELLOW = (s: string) => `\x1b[33m${s}\x1b[0m`;
const MAGENTA = (s: string) => `\x1b[35m${s}\x1b[0m`;
const RED = (s: string) => `\x1b[31m${s}\x1b[0m`;

function sep(char = "─", width = 68): string {
  return DIM(char.repeat(width));
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

// ─── Soul manifests ────────────────────────────────────────────────────────────
function readSoul(relPath: string): string {
  return readFileSync(join(FRAMEWORK_ROOT, relPath), "utf-8");
}

const BROKER_SOUL = readSoul("examples/orchestrator-agent/soul.md");

// ─── Specialist agent task handlers ────────────────────────────────────────────

function researchHandler({ input, contract, ctx }: AgentTask): Promise<unknown> {
  ctx.log(`Handling: ${contract.capability}`);
  const { query, max_results = 5, topic, sources = [] } = input as {
    query?: string;
    max_results?: number;
    topic?: string;
    sources?: string[];
    output_format?: string;
  };

  if (contract.capability === "research.web.search") {
    const q = query ?? "research topic";
    const results = Array.from({ length: Math.min(max_results, 5) }, (_, i) => ({
      title: `${q} — Result ${i + 1}`,
      url: `https://example.com/${q.replace(/\s+/g, "-").toLowerCase()}-${i + 1}`,
      snippet: `Comprehensive coverage of ${q}. Key insight ${i + 1}: accelerating adoption and expanding use cases.`,
      relevance_score: Math.round((1.0 - i * 0.10) * 100) / 100,
    }));
    return Promise.resolve({
      results,
      query_expansion: [q, `${q} 2026`, `${q} comparison`],
      total_found: results.length,
    });
  }

  // research.synthesis
  const t = topic ?? "the topic";
  const src = sources.length > 0 ? sources : ["https://example.com/source-1", "https://example.com/source-2"];
  const keyFindings = [
    `${t} shows accelerating adoption with 3.4× growth year-over-year.`,
    `Leading frameworks differentiate on developer experience, scalability, and economic primitives.`,
    `Multi-agent systems with formal contracts outperform monolithic LLMs on complex tasks by 40%.`,
    `Open-source alternatives are closing the gap with proprietary offerings rapidly.`,
    `Economic sustainability through agent-to-agent commerce is the key differentiator for 2026.`,
  ];

  const summary = `Research on "${t}" synthesized from ${src.length} sources.\n\n${keyFindings.join(" ")}`;
  return Promise.resolve({
    title: `Research Report: ${t}`,
    summary,
    key_findings: keyFindings,
    citations: src.slice(0, 3).map((s, i) => ({ source: s, claim: keyFindings[i] ?? keyFindings[0] })),
    confidence: 0.87,
    word_count: summary.split(" ").length,
  });
}

function dataAnalystHandler({ input, contract, ctx }: AgentTask): Promise<unknown> {
  ctx.log(`Analyzing: ${contract.capability}`);
  const { csv_data = "", operations = ["describe"] } = input as {
    csv_data?: string;
    operations?: string[];
  };

  const lines = csv_data.trim().split("\n").filter(Boolean);
  const headers = lines.length > 0 ? (lines[0] ?? "").split(",") : ["col_a", "col_b", "col_c"];
  const rows = lines.slice(1);

  const statistics: Record<string, unknown> = {};
  headers.forEach((h, i) => {
    const vals = rows
      .map((r) => parseFloat(r.split(",")[i] ?? ""))
      .filter((n) => !isNaN(n));
    if (vals.length > 0) {
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      statistics[h.trim()] = {
        count: vals.length,
        mean: Math.round(mean),
        min: Math.min(...vals),
        max: Math.max(...vals),
      };
    }
  });

  const trends = operations.includes("trend")
    ? headers.slice(0, 3).map((h) => ({ column: h.trim(), direction: "up" as const, confidence: 0.89 }))
    : [];

  return Promise.resolve({
    rows_analyzed: rows.length,
    columns_analyzed: headers.length,
    statistics,
    correlations: [],
    anomalies: [],
    trends,
    summary: `${rows.length} rows analyzed across ${headers.length} columns. All metrics show consistent upward trends.`,
  });
}

function contentWriterHandler({ input, contract, ctx }: AgentTask): Promise<unknown> {
  ctx.log(`Writing: ${contract.capability}`);

  if (contract.capability === "content.writing.marketing") {
    const { product_name = "Product", product_description = "", key_benefits = [] } = input as {
      product_name?: string;
      product_description?: string;
      key_benefits?: string[];
    };
    const content = `# ${product_name}\n\n> ${product_description}\n\n## Why ${product_name}?\n\n${(key_benefits as string[]).map((b) => `• ${b}`).join("\n")}\n\n## Get Started Today\n\nJoin the autonomous economy.`;
    return Promise.resolve({
      content,
      headline: `${product_name}: ${product_description.slice(0, 60)}`,
      cta: "Get started free",
      word_count: content.split(" ").length,
      variants: [{ variant: "A", content }],
    });
  }

  // content.writing.technical
  const { subject = "Topic", sections = ["Overview", "Installation", "Usage"] } = input as {
    subject?: string;
    doc_type?: string;
    sections?: string[];
    audience_level?: string;
  };

  const markdown = `# ${subject}\n\n${(sections as string[])
    .map((s) => `## ${s}\n\n_Detailed documentation for ${s.toLowerCase()} of ${subject}._\n`)
    .join("\n")}`;

  return Promise.resolve({
    markdown,
    sections_written: sections,
    word_count: markdown.split(" ").length,
    estimated_read_time_min: Math.max(1, Math.floor(markdown.split(" ").length / 200)),
  });
}

function codeBuilderHandler({ input, contract, ctx }: AgentTask): Promise<unknown> {
  ctx.log(`Coding: ${contract.capability}`);

  if (contract.capability === "coding.review.security") {
    return Promise.resolve({
      vulnerabilities: [],
      overall_risk: "low" as const,
      review_summary: "No critical vulnerabilities found. Code follows security best practices.",
    });
  }

  const { issue_description = "implement feature" } = input as { issue_description?: string };
  return Promise.resolve({
    files_changed: [
      { path: `src/${issue_description.replace(/\s+/g, "-").slice(0, 30)}.ts`, action: "created" as const },
      { path: "src/index.ts", action: "modified" as const },
    ],
    tests_passed: true,
    pr_url: "https://github.com/example/repo/pull/42",
    implementation_notes: `Implemented: ${issue_description}`,
  });
}

// ─── Main broker function ──────────────────────────────────────────────────────

async function runBroker(request: string): Promise<void> {
  banner("Clawdia Broker — Agent-of-Agents Demo");
  console.log(BOLD("Request:"), YELLOW(`"${request}"`));
  console.log();

  // ── Step 1: Boot infrastructure ────────────────────────────────────────────
  step(1, "Booting framework infrastructure");

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

  const sharedOpts = { bus, registry, contracts };

  // ── Step 2: Register specialist agents ─────────────────────────────────────
  step(2, "Registering specialist agents");

  const [researchAgent, dataAnalyst, contentWriter, codeBuilder] = await Promise.all([
    createAgent({ ...sharedOpts, soulMd: readSoul("examples/research-agent/soul.md"), onTask: researchHandler }),
    createAgent({ ...sharedOpts, soulMd: readSoul("examples/data-analyst/soul.md"), onTask: dataAnalystHandler }),
    createAgent({ ...sharedOpts, soulMd: readSoul("examples/content-writer/soul.md"), onTask: contentWriterHandler }),
    createAgent({ ...sharedOpts, soulMd: readSoul("examples/coding-agents/soul.md"), onTask: codeBuilderHandler }),
  ]);

  // Seed reputation scores so AgentMatcher scoring reflects specialist quality
  const agentScores: Record<string, number> = {
    "research-agent": 0.92,
    "data-analyst": 0.88,
    "content-writer": 0.85,
    "code-builder": 0.90,
  };

  for (const [agentName, score] of Object.entries(agentScores)) {
    const entry = registry.get(agentName);
    if (entry?.identity.reputation) {
      entry.identity.reputation.score = score;
      entry.identity.reputation.dimensions = {
        reliability: score,
        quality: score - 0.05,
        speed: score - 0.08,
        costEfficiency: score - 0.03,
      };
    }
  }

  for (const agent of [researchAgent, dataAnalyst, contentWriter, codeBuilder]) {
    console.log(`  ${GREEN("●")} ${agent.identity.displayName.padEnd(20)} ${DIM(agent.identity.capabilities.map((c) => c.taxonomy).join(", "))}`);
  }

  // ── Step 3: Register Clawdia the Broker ────────────────────────────────────
  step(3, "Registering Clawdia the Broker");

  const decomposer = new TaskDecomposer();
  const matcher = new AgentMatcher();
  const assembler = new OutputAssembler();

  const TOTAL_BUDGET = 1.00;

  // onTask handler implements the full broker pipeline
  async function brokerTask({ input, contract, ctx }: AgentTask): Promise<unknown> {
    const req = (input as { request?: string }).request ?? contract.input as string ?? request;
    const budget = (input as { total_budget_usdc?: number }).total_budget_usdc ?? TOTAL_BUDGET;

    ctx.log(`Brokering: "${req.slice(0, 60)}..."`);

    // 1. Decompose
    const dag = decomposer.decompose(req, budget);
    ctx.log(`Decomposed into ${dag.subtasks.length} subtasks (type: ${dag.requestType})`);

    // 2. Execute workflow
    const executor = new WorkflowExecutor({
      bus,
      registry,
      contracts,
      orchestratorIdentity: brokerAgent.identity,
    });

    ctx.log("Executing workflow DAG...");
    const workflowResult = await executor.execute(dag);

    // 3. Assemble output
    const assembled = assembler.assemble(req, dag.requestType, workflowResult.subtaskResults);
    workflowResult.assembledOutput = assembled.assembledOutput;
    workflowResult.qualityScore = assembled.qualityScore;

    // 4. Return result with P&L
    return {
      workflow_id: dag.id,
      status: workflowResult.status,
      output: assembled.assembledOutput,
      quality_score: assembled.qualityScore,
      quality_passes: assembled.qualityPasses,
      weakest_subtask: assembled.weakestSubtaskId,
      pnl: {
        subtask_cost_usdc: workflowResult.totalSubtaskCostUsdc,
        orchestration_margin_usdc: workflowResult.orchestrationMarginUsdc,
        total_charged_usdc: workflowResult.totalChargedUsdc,
        margin_percent: 15,
      },
      steps_completed: workflowResult.subtaskResults.length,
      steps_total: dag.subtasks.length,
      duration_ms: workflowResult.durationMs,
      agent_utilization: workflowResult.subtaskResults.map((r) => ({
        agent_name: r.agentName,
        subtask_id: r.subtaskId,
        cost_usdc: r.costUsdc,
        quality_score: r.qualityScore,
        duration_ms: r.durationMs,
      })),
    };
  }

  const brokerAgent = await createAgent({
    ...sharedOpts,
    soulMd: BROKER_SOUL,
    onTask: brokerTask,
  });

  console.log(`  ${GREEN("●")} ${brokerAgent.identity.displayName} ${DIM(`(${brokerAgent.identity.name})`)}`);
  console.log(`  ${DIM(`${brokerAgent.identity.capabilities.length} capabilities, 15% orchestration margin`)}`);

  // ── Step 4: Show registry ──────────────────────────────────────────────────
  step(4, "Service registry — all online agents");

  const allAgents = registry.list();
  for (const entry of allAgents) {
    const caps = entry.identity.capabilities.slice(0, 2).map((c) => c.taxonomy).join(", ");
    const rep = entry.identity.reputation?.score;
    const repStr = rep !== undefined ? ` ${DIM(`rep: ${(rep * 100).toFixed(0)}%`)}` : "";
    console.log(`  ${GREEN("●")} ${entry.identity.name.padEnd(24)} ${DIM(caps)}${repStr}`);
  }
  console.log(`\n  Total: ${allAgents.length} agents online`);

  // ── Step 5: Decompose the request ──────────────────────────────────────────
  step(5, "Decomposing the request into a subtask DAG");

  const dag = decomposer.decompose(request, TOTAL_BUDGET);
  console.log(`  Request type:  ${YELLOW(dag.requestType)}`);
  console.log(`  Subtasks:      ${dag.subtasks.length}`);
  for (const st of dag.subtasks) {
    const deps = st.dependencies.length > 0 ? ` (depends on: ${st.dependencies.join(", ")})` : " (no deps)";
    console.log(`    ${CYAN(st.id.padEnd(8))}  ${st.capability.padEnd(40)} ${DIM(`$${st.budgetAllocation.toFixed(3)}`)}${DIM(deps)}`);
  }

  // ── Step 6: Discover best agents ───────────────────────────────────────────
  step(6, "Discovering best specialists for each subtask");

  for (const st of dag.subtasks) {
    const { entries } = registry.discover({ taxonomy: st.capability, onlineOnly: false });
    if (entries.length === 0) {
      console.log(`  ${YELLOW(st.id)}  ${st.capability} → ${RED("no agents found")}`);
      continue;
    }
    const ranked = matcher.rankCandidates(entries, st.capability, st.budgetAllocation);
    const top = ranked[0];
    if (!top) continue;
    console.log(
      `  ${CYAN(st.id.padEnd(8))}  ${st.capability.padEnd(40)} → ${GREEN(top.agent.identity.name.padEnd(18))} ` +
      `${DIM(`score: ${(top.score * 100).toFixed(0)}% (rep:${(top.breakdown.reputation * 100).toFixed(0)} price:${(top.breakdown.price * 100).toFixed(0)} avail:${(top.breakdown.availability * 100).toFixed(0)})`)}`,
    );
  }

  // ── Step 7: Run the full brokered workflow ──────────────────────────────────
  step(7, "Running full brokered workflow via task contract");

  console.log(`\n  ${MAGENTA("→")} Creating orchestration job contract...`);

  const jobContract = contracts.create({
    requester: brokerAgent.identity,
    provider: brokerAgent.identity,
    capability: "orchestration.job.broker",
    inputSchema: {},
    outputSchema: {},
    input: { request, total_budget_usdc: TOTAL_BUDGET },
    payment: { amount: TOTAL_BUDGET * 1.15, currency: "USDC" },
    sla: { deadlineMs: 300_000, maxRetries: 1 },
    verification: { method: "quality_score", minQualityScore: 0.70 },
  });

  await contracts.transition(jobContract.id, "OFFER", brokerAgent.identity.name);
  await contracts.transition(jobContract.id, "ACCEPT", brokerAgent.identity.name);
  await contracts.transition(jobContract.id, "FUND", brokerAgent.identity.name);

  // ── Step 8: Results ────────────────────────────────────────────────────────
  step(8, "Results");

  const finalContract = contracts.get(jobContract.id)!;
  const result = finalContract.output as {
    workflow_id: string;
    status: string;
    output: Record<string, unknown>;
    quality_score: number;
    quality_passes: boolean;
    pnl: {
      subtask_cost_usdc: number;
      orchestration_margin_usdc: number;
      total_charged_usdc: number;
      margin_percent: number;
    };
    steps_completed: number;
    steps_total: number;
    duration_ms: number;
    agent_utilization: Array<{
      agent_name: string;
      subtask_id: string;
      cost_usdc: number;
      quality_score: number;
      duration_ms: number;
    }>;
  };

  if (!result) {
    console.log(`  ${RED("✗")} No result — workflow may have timed out or failed.`);
  } else {
    console.log(`\n  ${BOLD("Workflow ID")}  ${CYAN(result.workflow_id)}`);
    console.log(`  ${BOLD("Status")}       ${result.status === "completed" ? GREEN(result.status) : YELLOW(result.status)}`);
    console.log(`  ${BOLD("Steps")}        ${result.steps_completed}/${result.steps_total} completed`);
    console.log(`  ${BOLD("Quality")}      ${(result.quality_score * 100).toFixed(0)}% ${result.quality_passes ? GREEN("✓ passes") : RED("✗ below threshold")}`);
    console.log(`  ${BOLD("Duration")}     ${result.duration_ms}ms`);

    console.log(`\n  ${BOLD("P&L Breakdown:")}`);
    console.log(`    Subtask costs:         ${YELLOW(`${result.pnl.subtask_cost_usdc.toFixed(4)} USDC`)}`);
    console.log(`    Orchestration margin:  ${GREEN(`+${result.pnl.orchestration_margin_usdc.toFixed(4)} USDC`)} ${DIM(`(${result.pnl.margin_percent}%)`)}`);
    console.log(`    Total charged:         ${BOLD(`${result.pnl.total_charged_usdc.toFixed(4)} USDC`)}`);

    if (result.agent_utilization?.length > 0) {
      console.log(`\n  ${BOLD("Agent Utilization:")}`);
      for (const u of result.agent_utilization) {
        console.log(
          `    ${u.agent_name.padEnd(22)} task: ${u.subtask_id.padEnd(6)} ` +
          `cost: ${DIM(`$${u.cost_usdc.toFixed(4)}`)}  ` +
          `quality: ${DIM(`${(u.quality_score * 100).toFixed(0)}%`)}  ` +
          `${DIM(`${u.duration_ms}ms`)}`,
        );
      }
    }

    const output = result.output;
    if (output) {
      console.log(`\n  ${BOLD("Assembled Output Preview:")}`);
      const outputType = (output as { type?: string }).type ?? "unknown";
      console.log(`    Type: ${CYAN(outputType)}`);
      const summary = (output as { summary?: string; content?: string; report?: string; formatted_report?: string }).summary
        ?? (output as { content?: string }).content
        ?? (output as { report?: string }).report
        ?? (output as { formatted_report?: string }).formatted_report
        ?? "";
      if (summary) {
        const preview = String(summary).split("\n").slice(0, 3).join(" ");
        console.log(`    Preview: ${DIM(preview.slice(0, 120))}${preview.length > 120 ? DIM("...") : ""}`);
      }
    }
  }

  // ── Step 9: Contract stats ─────────────────────────────────────────────────
  step(9, "Contract statistics");

  const contractStats = contracts.stats();
  for (const [state, count] of Object.entries(contractStats).sort()) {
    const color = state === "settled" ? GREEN : state === "disputed" ? RED : DIM;
    console.log(`  ${color(state.padEnd(16))} ${count}`);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  banner("Broker demo complete");

  await Promise.all([
    brokerAgent.stop(),
    researchAgent.stop(),
    dataAnalyst.stop(),
    contentWriter.stop(),
    codeBuilder.stop(),
  ]);

  reputation.stop();
  escrow.stop();
  billing.stop();
  registry.destroy();
  await bus.disconnect();

  console.log(GREEN("All agents stopped. Infrastructure disconnected.\n"));
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const DEFAULT_REQUEST =
  "Research the top 5 AI agent frameworks, compare their architecture, features, and developer experience, and produce a comprehensive summary report";

const request = process.argv[2] ?? DEFAULT_REQUEST;

runBroker(request).catch((err) => {
  console.error(RED("Fatal:"), err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) {
    console.error(DIM(err.stack));
  }
  process.exitCode = 1;
});
