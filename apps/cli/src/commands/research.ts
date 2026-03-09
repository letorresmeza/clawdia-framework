import chalk from "chalk";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { createAgent } from "@clawdia/sdk";
import type { AgentTask } from "@clawdia/sdk";
import type { IClawBus } from "@clawdia/core";
import type { ContractEngine } from "@clawdia/core";
import type { ServiceRegistry } from "@clawdia/orchestrator";
import type { AgentIdentity } from "@clawdia/types";

// Resolved at runtime relative to CWD — must run from repo root
const AGENTS_DIR = join(process.cwd(), "examples/autoresearch/agents");

// ─── Types ────────────────────────────────────────────────────────────────────

interface HypothesisSpec {
  readonly id: string;
  readonly hypothesis: string;
  readonly rationale: string;
  readonly target_parameter: string;
  readonly proposed_diff: string;
  readonly expected_improvement: number;
  readonly confidence: number;
  readonly _baseEffect: number;
  readonly _applyTo: (code: string) => string;
}

interface ExperimentRecord {
  iteration: number;
  hypothesis: string;
  target_parameter: string;
  val_bpb: number;
  baseline_val_bpb: number;
  delta: number;
  decision: "kept" | "discarded";
}

// ─── Hypothesis pool (shared with example — extracted for CLI self-containment) ──

const BASELINE_CODE = `
# gpt_train.py — Minimal GPT training loop
LEARNING_RATE = 3e-4
BATCH_SIZE    = 32
SEQ_LEN       = 128
DROPOUT       = 0.1
WEIGHT_DECAY  = 0.01
`.trim();

const HYPOTHESIS_POOL: readonly HypothesisSpec[] = [
  {
    id: "reduce-lr",
    hypothesis: "Reduce learning rate from 3e-4 to 1e-4 for more stable convergence",
    rationale: "3e-4 may be too aggressive. 1e-4 is the classic GPT sweet spot for small models.",
    target_parameter: "LEARNING_RATE",
    proposed_diff: "LEARNING_RATE = 3e-4  →  LEARNING_RATE = 1e-4",
    expected_improvement: -0.04,
    confidence: 0.85,
    _baseEffect: -0.044,
    _applyTo: (code) => code.replace("LEARNING_RATE = 3e-4", "LEARNING_RATE = 1e-4"),
  },
  {
    id: "grad-clip",
    hypothesis: "Add gradient clipping at max_norm=1.0 to prevent exploding gradients",
    rationale: "Clipping at 1.0 is standard in GPT-2/3 training and improves stability.",
    target_parameter: "gradient_clipping",
    proposed_diff: "Add clip_grad_norm_(model.parameters(), max_norm=1.0) before optimizer.step()",
    expected_improvement: -0.028,
    confidence: 0.82,
    _baseEffect: -0.029,
    _applyTo: (code) => code + "\n# gradient clipping enabled",
  },
  {
    id: "pre-norm",
    hypothesis: "Switch to pre-LayerNorm (normalize before attention)",
    rationale: "Pre-norm architectures (GPT-3, PaLM) train more stably than post-norm.",
    target_parameter: "layer_norm_position",
    proposed_diff: "TransformerBlock: x = x + attn(ln(x)) instead of x = ln(x + attn(x))",
    expected_improvement: -0.035,
    confidence: 0.88,
    _baseEffect: -0.038,
    _applyTo: (code) => code + "\n# pre-norm enabled",
  },
  {
    id: "cosine-schedule",
    hypothesis: "Add cosine annealing LR schedule for smooth decay toward convergence",
    rationale: "Cosine annealing is standard in modern LLM training recipes (NanoGPT, LLaMA).",
    target_parameter: "lr_scheduler",
    proposed_diff: "Add CosineAnnealingLR(optimizer, T_max=MAX_ITERS) + scheduler.step()",
    expected_improvement: -0.025,
    confidence: 0.80,
    _baseEffect: -0.031,
    _applyTo: (code) => code + "\n# cosine annealing enabled",
  },
  {
    id: "warmup",
    hypothesis: "Add 200-step linear LR warmup to improve early training stability",
    rationale: "Warmup lets Adam build accurate moment estimates before committing to large updates.",
    target_parameter: "lr_warmup_steps",
    proposed_diff: "Linearly ramp lr from 0 → LEARNING_RATE over first 200 steps",
    expected_improvement: -0.019,
    confidence: 0.76,
    _baseEffect: -0.021,
    _applyTo: (code) => code + "\n# lr warmup enabled",
  },
  {
    id: "dropout-reduce",
    hypothesis: "Reduce dropout from 0.1 to 0.05 — small model may be under-fitting",
    rationale: "With 25M params, this model is capacity-limited. High dropout hurts fitting.",
    target_parameter: "DROPOUT",
    proposed_diff: "DROPOUT = 0.1  →  DROPOUT = 0.05",
    expected_improvement: -0.013,
    confidence: 0.70,
    _baseEffect: -0.014,
    _applyTo: (code) => code.replace("DROPOUT       = 0.1", "DROPOUT       = 0.05"),
  },
  {
    id: "seq-len",
    hypothesis: "Double context length from 128 to 256 tokens for richer attention patterns",
    rationale: "Longer contexts improve BPB on text with long-range structure.",
    target_parameter: "SEQ_LEN",
    proposed_diff: "SEQ_LEN = 128  →  SEQ_LEN = 256",
    expected_improvement: -0.02,
    confidence: 0.68,
    _baseEffect: -0.018,
    _applyTo: (code) => code.replace("SEQ_LEN       = 128", "SEQ_LEN       = 256"),
  },
  {
    id: "batch-size",
    hypothesis: "Double batch size from 32 to 64 for more stable gradient estimates",
    rationale: "Larger batches reduce gradient variance, smoothing the loss surface.",
    target_parameter: "BATCH_SIZE",
    proposed_diff: "BATCH_SIZE = 32  →  BATCH_SIZE = 64",
    expected_improvement: -0.009,
    confidence: 0.72,
    _baseEffect: -0.010,
    _applyTo: (code) => code.replace("BATCH_SIZE    = 32", "BATCH_SIZE    = 64"),
  },
  {
    id: "weight-decay-high",
    hypothesis: "Increase weight decay from 0.01 to 0.1 for stronger L2 regularization",
    rationale: "Worth testing if overfitting — though risky on a small model.",
    target_parameter: "WEIGHT_DECAY",
    proposed_diff: "WEIGHT_DECAY = 0.01  →  WEIGHT_DECAY = 0.1",
    expected_improvement: 0.007,
    confidence: 0.44,
    _baseEffect: 0.008,
    _applyTo: (code) => code + "\n# weight_decay increased to 0.1",
  },
  {
    id: "sgd-switch",
    hypothesis: "Replace AdamW with SGD+Nesterov momentum (high-risk/high-reward)",
    rationale: "SGD may find flatter minima but is much more sensitive to LR.",
    target_parameter: "optimizer",
    proposed_diff: "optimizer = SGD(model.parameters(), lr=0.01, momentum=0.9, nesterov=True)",
    expected_improvement: 0.082,
    confidence: 0.30,
    _baseEffect: 0.085,
    _applyTo: (code) => code + "\n# switched to SGD",
  },
];

// ─── Mock training ─────────────────────────────────────────────────────────────

function seededRandom(seed: number): number {
  let s = (seed + 0x6d2b79f5) | 0;
  s = Math.imul(s ^ (s >>> 15), 1 | s);
  s = (s + Math.imul(s ^ (s >>> 7), 61 | s)) ^ s;
  return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
}

function mockTrainingRun(
  iteration: number,
  spec: HypothesisSpec,
  currentValBpb: number,
): { val_bpb: number; simulated_duration_s: number } {
  const noise = (seededRandom(iteration * 12345 + 67890) - 0.5) * 0.018;
  const val_bpb = Math.round(Math.max(1.5, currentValBpb + spec._baseEffect + noise) * 1000) / 1000;
  const simulated_duration_s = Math.round(270 + seededRandom(iteration * 9999) * 60);
  return { val_bpb, simulated_duration_s };
}

// ─── Agent handlers ────────────────────────────────────────────────────────────

function hypothesisHandler({ input, ctx }: AgentTask): Promise<unknown> {
  const { experiment_history = [] } = input as {
    experiment_history?: Array<{ target_parameter?: string }>;
  };
  ctx.log("Selecting next hypothesis");
  const tried = new Set(
    experiment_history.map((e) => HYPOTHESIS_POOL.find((h) => h.target_parameter === e.target_parameter)?.id ?? ""),
  );
  const candidate = HYPOTHESIS_POOL.find((h) => !tried.has(h.id)) ?? HYPOTHESIS_POOL[0]!;
  return Promise.resolve({ ...candidate });
}

function codeModifierHandler({ input, ctx }: AgentTask): Promise<unknown> {
  const { current_code = BASELINE_CODE, _spec_id, target_parameter, proposed_diff } = input as {
    current_code?: string;
    _spec_id?: string;
    target_parameter?: string;
    proposed_diff?: string;
  };
  ctx.log(`Modifying: ${String(target_parameter)}`);
  const spec = HYPOTHESIS_POOL.find((h) => h.id === _spec_id);
  const modified_code = spec ? spec._applyTo(current_code) : current_code;
  return Promise.resolve({
    modified_code,
    diff_summary: `Modified ${String(target_parameter)}: ${String(proposed_diff)}`,
    lines_changed: 1,
    parameters_modified: [String(target_parameter)],
  });
}

function evaluatorHandler({ input, ctx }: AgentTask): Promise<unknown> {
  const {
    iteration = 0,
    hypothesis = "",
    val_bpb = 0,
    baseline_val_bpb = 0,
    original_baseline_val_bpb = baseline_val_bpb,
  } = input as {
    iteration?: number;
    hypothesis?: string;
    val_bpb?: number;
    baseline_val_bpb?: number;
    original_baseline_val_bpb?: number;
  };
  ctx.log(`Evaluating iter ${iteration}`);
  const delta = Math.round((val_bpb - baseline_val_bpb) * 1000) / 1000;
  const improvement_pct = Math.round((-delta / baseline_val_bpb) * 1000) / 10;
  const decision: "kept" | "discarded" = delta < -0.005 ? "kept" : "discarded";
  const new_baseline = decision === "kept" ? val_bpb : baseline_val_bpb;
  const cumulative_delta = new_baseline - original_baseline_val_bpb;
  const cumulative_improvement_pct = Math.round((-cumulative_delta / original_baseline_val_bpb) * 1000) / 10;
  return Promise.resolve({ decision, delta, improvement_pct, new_baseline, cumulative_improvement_pct,
    verdict: decision === "kept" ? `KEPT — improved by ${Math.abs(delta).toFixed(3)}` : `DISCARDED — delta ${delta.toFixed(3)}` });
}

function loggerHandler({ input, ctx }: AgentTask): Promise<unknown> {
  const { iteration = 0, hypothesis = "", val_bpb = 0, baseline_val_bpb = 0, delta = 0,
    decision = "discarded", experiment_history = [] } = input as {
    iteration?: number; hypothesis?: string; val_bpb?: number; baseline_val_bpb?: number;
    delta?: number; decision?: "kept" | "discarded"; experiment_history?: ExperimentRecord[];
  };
  ctx.log(`Logging iter ${iteration}`);
  const allRecords = [...experiment_history, { iteration, hypothesis, val_bpb, baseline_val_bpb, delta, decision } as ExperimentRecord];
  const kept = allRecords.filter((r) => r.decision === "kept");
  const bestValBpb = kept.reduce((best, r) => Math.min(best, r.val_bpb), val_bpb);
  const currentBaseline = decision === "kept" ? val_bpb : baseline_val_bpb;
  const originalBaseline = allRecords[0]?.baseline_val_bpb ?? baseline_val_bpb;
  const totalImprovementPct = Math.round(((originalBaseline - currentBaseline) / originalBaseline) * 1000) / 10;
  return Promise.resolve({
    log_entry_id: `exp-iter${iteration}-${Date.now()}`,
    total_experiments: allRecords.length,
    experiments_kept: kept.length,
    best_val_bpb: bestValBpb,
    current_baseline: currentBaseline,
    total_improvement_pct: totalImprovementPct,
    leaderboard: kept.sort((a, b) => a.val_bpb - b.val_bpb).slice(0, 3).map((r, i) => ({ rank: i + 1, ...r })),
    cumulative_learnings: kept.length > 0 ? [`Effective: ${[...new Set(kept.map((r) => r.target_parameter))].join(", ")}`] : [],
  });
}

// ─── Contract execution helper ─────────────────────────────────────────────────

async function executeStep(
  bus: IClawBus,
  contracts: ContractEngine,
  orchestratorId: AgentIdentity,
  providerId: AgentIdentity,
  capability: string,
  input: Record<string, unknown>,
  costUsdc: number,
): Promise<{ output: unknown; contractId: string }> {
  const contract = contracts.create({
    requester: orchestratorId,
    provider: providerId,
    capability,
    inputSchema: {},
    outputSchema: {},
    input,
    payment: { amount: costUsdc, currency: "USDC" },
    sla: { deadlineMs: 15_000, maxRetries: 0 },
    verification: { method: "schema_match" },
  });

  const deliveryPromise = new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => { bus.unsubscribe(subId); reject(new Error(`Step ${capability} timed out`)); }, 15_000);
    const subId = bus.subscribe("task.request", async (msg) => {
      const payload = msg.payload as { contractId?: string; event?: string };
      if (payload.contractId !== contract.id) return;
      if (payload.event === "DELIVER") { clearTimeout(timer); bus.unsubscribe(subId); resolve(contracts.get(contract.id)?.output ?? null); }
      else if (payload.event === "FAIL") { clearTimeout(timer); bus.unsubscribe(subId); reject(new Error(`Step ${capability} failed`)); }
    });
  });

  await contracts.transition(contract.id, "OFFER", orchestratorId.name);
  await contracts.transition(contract.id, "ACCEPT", providerId.name);
  await contracts.transition(contract.id, "FUND", orchestratorId.name);
  return { output: await deliveryPromise, contractId: contract.id };
}

// ─── CLI command ───────────────────────────────────────────────────────────────

export function registerResearchCommand(
  program: Command,
  services: {
    bus: IClawBus;
    registry: ServiceRegistry;
    contracts: ContractEngine;
  },
): void {
  program
    .command("research <goal>")
    .description(
      "Run an autonomous ML research loop. Agents iteratively propose hypotheses, modify " +
      "training code, evaluate results, and log experiments — each step a real TaskContract. " +
      'Example: clawdia research "Optimize the GPT training loop for lower validation loss" --iterations 5',
    )
    .option("--iterations <n>", "Number of research iterations", parseInt, 10)
    .option("--baseline-bpb <bpb>", "Starting baseline val_bpb", parseFloat, 3.142)
    .option("--dry-run", "Show the research plan without executing contracts")
    .action(async (
      goal: string,
      opts: { iterations: number; baselineBpb: number; dryRun?: boolean },
    ) => {
      try {
        console.log();
        console.log(chalk.bold("Clawdia Autoresearch"));
        console.log(chalk.dim("Autonomous ML research loop\n"));
        console.log(`${chalk.bold("Goal:")}       ${chalk.yellow(`"${goal}"`)}`);
        console.log(`${chalk.bold("Iterations:")} ${opts.iterations}`);
        console.log(`${chalk.bold("Baseline:")}   ${opts.baselineBpb} val_bpb`);
        console.log();

        if (opts.dryRun) {
          // Show the research plan
          console.log(chalk.cyan("Research Plan"));
          console.log(chalk.dim("─".repeat(50)));
          console.log(`  ${chalk.bold("Loop type:")} iterative (hypothesis → code → train → eval → log)`);
          console.log(`  ${chalk.bold("Agents:")}    4 specialists per iteration`);
          console.log();
          console.log(`  ${chalk.cyan("Step 1:")} ${chalk.bold("research.ml.hypothesis")}    $0.020 USDC`);
          console.log(chalk.dim("          Analyzes history, proposes next modification"));
          console.log(`  ${chalk.cyan("Step 2:")} ${chalk.bold("coding.ml.modify")}          $0.030 USDC`);
          console.log(chalk.dim("          Implements the modification in training code"));
          console.log(`  ${chalk.cyan("Step 3:")} ${chalk.bold("compute.gpu.train")}         ${chalk.yellow("[stub — TODO: real GPU]")}`);
          console.log(chalk.dim("          Runs 5-minute training experiment, returns val_bpb"));
          console.log(`  ${chalk.cyan("Step 4:")} ${chalk.bold("analysis.ml.evaluate")}      $0.015 USDC`);
          console.log(chalk.dim("          Compares result to baseline, keep or discard"));
          console.log(`  ${chalk.cyan("Step 5:")} ${chalk.bold("data.experiment.log")}       $0.010 USDC`);
          console.log(chalk.dim("          Appends to experiment log, updates leaderboard"));
          console.log();

          const perIterCost = 0.02 + 0.03 + 0.015 + 0.01;
          const totalCost = perIterCost * opts.iterations;
          const totalContracts = opts.iterations * 4; // 4 contract-steps per iteration (stub is not a contract)
          console.log(chalk.dim("─".repeat(50)));
          console.log(`  ${chalk.bold("Per iteration:")} ${perIterCost.toFixed(3)} USDC — 4 TaskContracts`);
          console.log(`  ${chalk.bold("Total:")}         ${totalCost.toFixed(3)} USDC — ${totalContracts} TaskContracts`);
          console.log(`  ${chalk.bold("Training:")}      ${opts.iterations} × ~5 min ${chalk.dim("(stubbed in demo)")}`);
          console.log();
          console.log(chalk.dim("Dry-run complete. Run without --dry-run to execute the loop."));
          console.log(chalk.dim("Or run the full standalone demo:"));
          console.log(chalk.dim(`  npx tsx examples/autoresearch/autoresearch.ts "${goal}" ${opts.iterations}`));
          return;
        }

        // ── Bootstrap research agents against the shared infrastructure ─────────
        console.log(chalk.cyan("Registering Research Agents"));
        console.log(chalk.dim("─".repeat(50)));

        let readSoul: (rel: string) => string;
        try {
          readSoul = (rel: string) => readFileSync(join(AGENTS_DIR, rel), "utf-8");
          readSoul("research-hypothesis-agent/soul.md"); // probe
        } catch {
          console.log(chalk.red("Error: soul.md manifests not found at"));
          console.log(chalk.dim(`  ${AGENTS_DIR}`));
          console.log(chalk.dim("Make sure you are running from the repo root."));
          console.log(chalk.dim("Or use the standalone demo:"));
          console.log(chalk.dim(`  npx tsx examples/autoresearch/autoresearch.ts "${goal}" ${opts.iterations}`));
          process.exitCode = 1;
          return;
        }

        const sharedOpts = { bus: services.bus, registry: services.registry, contracts: services.contracts };
        const [hypAgent, codeAgent, evalAgent, logAgent] = await Promise.all([
          createAgent({ ...sharedOpts, soulMd: readSoul("research-hypothesis-agent/soul.md"), onTask: hypothesisHandler }),
          createAgent({ ...sharedOpts, soulMd: readSoul("code-modifier-agent/soul.md"), onTask: codeModifierHandler }),
          createAgent({ ...sharedOpts, soulMd: readSoul("experiment-evaluator-agent/soul.md"), onTask: evaluatorHandler }),
          createAgent({ ...sharedOpts, soulMd: readSoul("experiment-logger-agent/soul.md"), onTask: loggerHandler }),
        ]);

        for (const agent of [hypAgent, codeAgent, evalAgent, logAgent]) {
          console.log(`  ${chalk.green("●")} ${agent.identity.name.padEnd(34)} ${chalk.dim(agent.identity.capabilities[0]?.taxonomy ?? "")}`);
        }
        console.log();

        // ── Orchestrator identity ────────────────────────────────────────────────
        const ORCHESTRATOR: AgentIdentity = {
          name: "autoresearch-orchestrator",
          displayName: "Autoresearch Orchestrator",
          description: "Manages the autonomous ML research loop",
          version: "1.0.0",
          operator: "clawdia-labs",
          publicKey: "autoresearch-orchestrator",
          capabilities: [],
          requirements: [],
          runtime: {},
        };

        // ── Research loop ────────────────────────────────────────────────────────
        console.log(chalk.cyan("Research Loop"));
        console.log(chalk.dim("─".repeat(50)));

        const ORIGINAL_BASELINE = opts.baselineBpb;
        let currentCode = BASELINE_CODE;
        let currentBaseline = ORIGINAL_BASELINE;
        const experimentHistory: ExperimentRecord[] = [];
        let totalCostUsdc = 0;

        for (let iter = 1; iter <= opts.iterations; iter++) {
          console.log(`\n  ${chalk.magenta(`Iteration ${iter}/${opts.iterations}`)}  ${chalk.dim(`baseline: ${currentBaseline.toFixed(3)}`)}`);

          // Hypothesis
          const { output: hypOut } = await executeStep(
            services.bus, services.contracts, ORCHESTRATOR, hypAgent.identity,
            "research.ml.hypothesis", { current_code: currentCode, experiment_history: experimentHistory, goal }, 0.02,
          );
          totalCostUsdc += 0.02;
          const hyp = hypOut as HypothesisSpec;
          console.log(`    ${chalk.dim("[hyp]")}  ${hyp.hypothesis.slice(0, 70)}`);

          // Code modification
          const { output: codeOut } = await executeStep(
            services.bus, services.contracts, ORCHESTRATOR, codeAgent.identity,
            "coding.ml.modify", { current_code: currentCode, ...hyp }, 0.03,
          );
          totalCostUsdc += 0.03;
          const code = codeOut as { modified_code: string; diff_summary: string };
          console.log(`    ${chalk.dim("[code]")} ${code.diff_summary.slice(0, 70)}`);

          // Mock training stub
          const spec = HYPOTHESIS_POOL.find((h) => h.id === hyp.id) ?? HYPOTHESIS_POOL[0]!;
          const { val_bpb: newValBpb, simulated_duration_s } = mockTrainingRun(iter, spec, currentBaseline);
          console.log(`    ${chalk.dim("[stub]")} val_bpb: ${chalk.magenta(newValBpb.toFixed(3))}  ${chalk.dim(`(${Math.floor(simulated_duration_s / 60)}m sim — TODO: real GPU)`)}`);

          // Evaluation
          const { output: evalOut } = await executeStep(
            services.bus, services.contracts, ORCHESTRATOR, evalAgent.identity,
            "analysis.ml.evaluate",
            { iteration: iter, hypothesis: hyp.hypothesis, val_bpb: newValBpb, baseline_val_bpb: currentBaseline, original_baseline_val_bpb: ORIGINAL_BASELINE, experiment_history: experimentHistory },
            0.015,
          );
          totalCostUsdc += 0.015;
          const evaluation = evalOut as { decision: "kept" | "discarded"; delta: number; new_baseline: number };
          const decisionStr = evaluation.decision === "kept" ? chalk.green("KEPT ✓") : chalk.red("discarded");
          console.log(`    ${chalk.dim("[eval]")} ${decisionStr}  delta: ${evaluation.delta < 0 ? chalk.green(evaluation.delta.toFixed(3)) : chalk.red("+" + evaluation.delta.toFixed(3))}`);

          // Log
          await executeStep(
            services.bus, services.contracts, ORCHESTRATOR, logAgent.identity,
            "data.experiment.log",
            { iteration: iter, hypothesis: hyp.hypothesis, target_parameter: hyp.target_parameter, diff_summary: code.diff_summary, val_bpb: newValBpb, baseline_val_bpb: currentBaseline, delta: evaluation.delta, decision: evaluation.decision, experiment_history: experimentHistory },
            0.01,
          );
          totalCostUsdc += 0.01;

          if (evaluation.decision === "kept") {
            currentCode = code.modified_code;
            currentBaseline = evaluation.new_baseline;
          }
          experimentHistory.push({
            iteration: iter,
            hypothesis: hyp.hypothesis,
            target_parameter: hyp.target_parameter ?? "",
            val_bpb: newValBpb,
            baseline_val_bpb: currentBaseline,
            delta: evaluation.delta,
            decision: evaluation.decision,
          });
        }

        // ── Summary ──────────────────────────────────────────────────────────────
        console.log();
        console.log(chalk.cyan("Summary"));
        console.log(chalk.dim("─".repeat(50)));

        const kept = experimentHistory.filter((r) => r.decision === "kept");
        const totalDelta = currentBaseline - ORIGINAL_BASELINE;
        const totalImprovementPct = Math.round((-totalDelta / ORIGINAL_BASELINE) * 1000) / 10;

        console.log(`  Starting baseline:  ${chalk.magenta(`${ORIGINAL_BASELINE.toFixed(3)} val_bpb`)}`);
        console.log(`  Final val_bpb:      ${chalk.magenta(`${currentBaseline.toFixed(3)} val_bpb`)}`);
        console.log(`  Total improvement:  ${chalk.green(`${totalImprovementPct.toFixed(1)}%`)}`);
        console.log(`  Experiments kept:   ${kept.length}/${opts.iterations}`);
        console.log(`  Total contracts:    ${opts.iterations * 4}`);
        console.log(`  Total cost:         ${chalk.yellow(`${totalCostUsdc.toFixed(4)} USDC`)}`);
        console.log();

        if (kept.length > 0) {
          console.log(chalk.cyan("Leaderboard"));
          console.log(chalk.dim("─".repeat(50)));
          for (const [i, r] of kept.sort((a, b) => a.val_bpb - b.val_bpb).slice(0, 3).entries()) {
            const impPct = Math.round((-r.delta / r.baseline_val_bpb) * 1000) / 10;
            console.log(`  ${chalk.cyan(`#${i + 1}`)}  iter ${r.iteration}  ${r.hypothesis.slice(0, 40).padEnd(42)} ${chalk.magenta(r.val_bpb.toFixed(3))}  ${chalk.green(`${r.delta.toFixed(3)} (${impPct.toFixed(1)}%)`)}`);
          }
          console.log();
        }

        // Cleanup agents
        await Promise.all([hypAgent, codeAgent, evalAgent, logAgent].map((a) => a.stop()));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red("Error:"), message);
        process.exitCode = 1;
      }
    });
}
