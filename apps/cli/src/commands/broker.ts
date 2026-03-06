import chalk from "chalk";
import type { Command } from "commander";
import type { IClawBus } from "@clawdia/core";
import type { ContractEngine } from "@clawdia/core";
import type { ServiceRegistry } from "@clawdia/orchestrator";
import type { AgentIdentity } from "@clawdia/types";
import { TaskDecomposer, AgentMatcher, WorkflowExecutor, OutputAssembler } from "@clawdia/plugin-agent-orchestrator";

const BROKER_IDENTITY: AgentIdentity = {
  name: "clawdia-broker",
  displayName: "Clawdia — Agent Services Broker",
  description: "CLI broker — orchestrates agent workflows",
  version: "1.0.0",
  operator: "clawdia-labs",
  publicKey: "cli-broker",
  capabilities: [],
  requirements: [],
  runtime: {},
};

export function registerBrokerCommand(
  program: Command,
  services: {
    bus: IClawBus;
    registry: ServiceRegistry;
    contracts: ContractEngine;
  },
): void {
  program
    .command("broker <request>")
    .description(
      "Broker a complex job through the agent registry. Clawdia decomposes the request, " +
      "discovers specialists, executes via task contracts, and assembles the final result. " +
      'Example: clawdia broker "Research the top 5 AI agent frameworks and compare them"',
    )
    .option("--budget <usdc>", "Total budget in USDC for all subtask contracts", parseFloat, 1.0)
    .option("--quality <threshold>", "Minimum quality score 0.0-1.0 to accept output", parseFloat, 0.70)
    .option("--dry-run", "Decompose and plan the workflow without executing any contracts")
    .action(async (
      request: string,
      opts: {
        budget: number;
        quality: number;
        dryRun?: boolean;
      },
    ) => {
      try {
        const decomposer = new TaskDecomposer();
        const matcher = new AgentMatcher();

        console.log();
        console.log(chalk.bold("Clawdia Broker"));
        console.log(chalk.dim("Agent-of-agents orchestration\n"));
        console.log(`${chalk.bold("Request:")} ${chalk.yellow(`"${request}"`)}`);
        console.log(`${chalk.bold("Budget:")}  ${opts.budget} USDC`);
        console.log();

        // ── Decompose ─────────────────────────────────────────────────────
        const dag = decomposer.decompose(request, opts.budget);
        console.log(chalk.cyan("Decomposition"));
        console.log(chalk.dim("─".repeat(50)));
        console.log(`  Type:     ${chalk.yellow(dag.requestType)}`);
        console.log(`  Subtasks: ${dag.subtasks.length}`);
        console.log();

        for (const st of dag.subtasks) {
          const deps = st.dependencies.length > 0
            ? chalk.dim(` → depends on [${st.dependencies.join(", ")}]`)
            : chalk.dim(" (start)");
          console.log(
            `  ${chalk.cyan(st.id.padEnd(8))}  ` +
            `${st.capability.padEnd(42)} ` +
            `${chalk.dim(`$${st.budgetAllocation.toFixed(3)}`)}${deps}`,
          );
        }
        console.log();

        // ── Discovery ─────────────────────────────────────────────────────
        console.log(chalk.cyan("Agent Discovery"));
        console.log(chalk.dim("─".repeat(50)));

        let anyAgentMissing = false;
        for (const st of dag.subtasks) {
          const { entries } = services.registry.discover({ taxonomy: st.capability, onlineOnly: false });
          if (entries.length === 0) {
            console.log(`  ${chalk.red("✗")} ${st.capability} — ${chalk.red("no agents found")}`);
            anyAgentMissing = true;
            continue;
          }
          const ranked = matcher.rankCandidates(entries, st.capability, st.budgetAllocation);
          const top = ranked[0];
          if (!top) continue;
          console.log(
            `  ${chalk.green("✓")} ${st.capability.padEnd(42)} → ` +
            `${chalk.green(top.agent.identity.name.padEnd(18))} ` +
            chalk.dim(`score: ${(top.score * 100).toFixed(0)}%`),
          );
        }
        console.log();

        if (opts.dryRun) {
          console.log(chalk.dim("Dry-run mode: workflow plan complete. No contracts created."));
          console.log(chalk.dim(`Estimated total: ${opts.budget.toFixed(4)} USDC + 15% margin = ${(opts.budget * 1.15).toFixed(4)} USDC`));
          return;
        }

        if (anyAgentMissing) {
          console.log(chalk.yellow("Warning: Some capabilities have no agents in the registry."));
          console.log(chalk.dim('Use `clawdia publish ./soul.md` to register specialists, or run `clawdia spawn ./soul.md` to start them.'));
          console.log();
        }

        // ── Execute ───────────────────────────────────────────────────────
        console.log(chalk.cyan("Executing Workflow"));
        console.log(chalk.dim("─".repeat(50)));

        const executor = new WorkflowExecutor({
          bus: services.bus,
          registry: services.registry,
          contracts: services.contracts,
          orchestratorIdentity: BROKER_IDENTITY,
        });

        const startMs = Date.now();

        // Subscribe to step completion events for live progress
        const progressSubId = services.bus.subscribe("workflow.step.complete", async (msg) => {
          const payload = msg.payload as {
            subtaskId?: string;
            agentName?: string;
            durationMs?: number;
            qualityScore?: number;
          };
          console.log(
            `  ${chalk.green("✓")} ${(payload.subtaskId ?? "").padEnd(8)} ` +
            `completed by ${chalk.green(payload.agentName ?? "?")} ` +
            chalk.dim(`(${payload.durationMs}ms, quality: ${((payload.qualityScore ?? 0) * 100).toFixed(0)}%)`),
          );
        });

        const workflowResult = await executor.execute(dag);
        services.bus.unsubscribe(progressSubId);

        // ── Assemble ──────────────────────────────────────────────────────
        const assembler = new OutputAssembler();
        const assembled = assembler.assemble(request, dag.requestType, workflowResult.subtaskResults);
        const durationMs = Date.now() - startMs;

        console.log();

        // ── Results ───────────────────────────────────────────────────────
        console.log(chalk.cyan("Results"));
        console.log(chalk.dim("─".repeat(50)));

        const statusColor = workflowResult.status === "completed" ? chalk.green : chalk.yellow;
        console.log(`  Status:   ${statusColor(workflowResult.status)}`);
        console.log(`  Steps:    ${workflowResult.subtaskResults.length}/${dag.subtasks.length}`);
        console.log(`  Quality:  ${(assembled.qualityScore * 100).toFixed(0)}% ${assembled.qualityPasses ? chalk.green("✓") : chalk.red("✗ below threshold")}`);
        console.log(`  Duration: ${durationMs}ms`);
        console.log();

        console.log(chalk.cyan("P&L"));
        console.log(chalk.dim("─".repeat(50)));
        console.log(`  Subtask costs:         ${chalk.yellow(`${workflowResult.totalSubtaskCostUsdc.toFixed(4)} USDC`)}`);
        console.log(`  Orchestration margin:  ${chalk.green(`+${workflowResult.orchestrationMarginUsdc.toFixed(4)} USDC`)} ${chalk.dim("(15%)")}`);
        console.log(`  Total charged:         ${chalk.bold(`${workflowResult.totalChargedUsdc.toFixed(4)} USDC`)}`);
        console.log();

        if (workflowResult.subtaskResults.length > 0) {
          console.log(chalk.cyan("Agent Utilization"));
          console.log(chalk.dim("─".repeat(50)));
          for (const r of workflowResult.subtaskResults) {
            console.log(
              `  ${r.agentName.padEnd(22)} ` +
              `cost: ${chalk.dim(`$${r.costUsdc.toFixed(4)}`)}  ` +
              `quality: ${chalk.dim(`${(r.qualityScore * 100).toFixed(0)}%`)}`,
            );
          }
          console.log();
        }

        if (!assembled.qualityPasses) {
          console.log(chalk.yellow("Quality Warning:"),
            `Output below threshold (${(assembled.qualityScore * 100).toFixed(0)}% < ${(opts.quality * 100).toFixed(0)}%).`);
          if (assembled.weakestSubtaskId) {
            console.log(chalk.dim(`Weakest subtask: ${assembled.weakestSubtaskId}. Consider running with more capable agents.`));
          }
          console.log();
        }

        const output = assembled.assembledOutput as Record<string, unknown>;
        if (output) {
          console.log(chalk.cyan("Output Preview"));
          console.log(chalk.dim("─".repeat(50)));
          const preview = JSON.stringify(output, null, 2).split("\n").slice(0, 15).join("\n");
          console.log(chalk.dim(preview));
          if (JSON.stringify(output).split("\n").length > 15) {
            console.log(chalk.dim("  [truncated]"));
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red("Error:"), message);
        process.exitCode = 1;
      }
    });
}
