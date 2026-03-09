/**
 * Autoresearch — Autonomous ML Research Loop
 *
 * Inspired by Karpathy's autoresearch pattern: an AI that modifies its own training
 * code, runs experiments, evaluates results, and iterates toward lower validation loss.
 *
 * This demo shows how Clawdia turns a single-agent loop into a multi-agent orchestrated
 * workflow. Each research step is a real TaskContract — discoverable, priced, and
 * settled through the Clawdia economy layer.
 *
 * Four agents collaborate per iteration:
 *   1. research-hypothesis-agent  — proposes a training code modification
 *   2. code-modifier-agent        — implements the modification precisely
 *   3. [mock training]            — simulates a 5-min training run (TODO: real GPU)
 *   4. experiment-evaluator-agent — decides keep/discard, updates baseline
 *   5. experiment-logger-agent    — appends to structured experiment log
 *
 * Usage:
 *   npx tsx examples/autoresearch/autoresearch.ts
 *   npx tsx examples/autoresearch/autoresearch.ts "Lower validation BPB" 5
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryBus, ContractEngine } from "@clawdia/core";
import type { IClawBus } from "@clawdia/core";
import { ServiceRegistry } from "@clawdia/orchestrator";
import { ReputationEngine, InMemoryEscrow, BillingEngine } from "@clawdia/economy";
import { createAgent } from "@clawdia/sdk";
import type { AgentTask } from "@clawdia/sdk";
import type { AgentIdentity } from "@clawdia/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = join(__dirname, "agents");

// ─── ANSI helpers ─────────────────────────────────────────────────────────────
const BOLD = (s: string) => `\x1b[1m${s}\x1b[0m`;
const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`;
const GREEN = (s: string) => `\x1b[32m${s}\x1b[0m`;
const CYAN = (s: string) => `\x1b[36m${s}\x1b[0m`;
const YELLOW = (s: string) => `\x1b[33m${s}\x1b[0m`;
const MAGENTA = (s: string) => `\x1b[35m${s}\x1b[0m`;
const RED = (s: string) => `\x1b[31m${s}\x1b[0m`;
const BLUE = (s: string) => `\x1b[34m${s}\x1b[0m`;

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
function iterBanner(n: number, total: number): void {
  console.log(`\n${sep("─", 30)} ${MAGENTA(`Iteration ${n}/${total}`)} ${sep("─", 30)}`);
}

// ─── Baseline training code stub ──────────────────────────────────────────────

const BASELINE_CODE = `
# gpt_train.py — Minimal GPT training loop (Karpathy-style)
import torch
import torch.nn as nn
from torch.optim import AdamW

# ── Hyperparameters ──────────────────────────────────────────────────────────
BATCH_SIZE    = 32
SEQ_LEN       = 128
LEARNING_RATE = 3e-4
N_LAYERS      = 6
N_HEADS       = 6
D_MODEL       = 384
DROPOUT       = 0.1
MAX_ITERS     = 5000
WEIGHT_DECAY  = 0.01
EVAL_INTERVAL = 500

# ── Model ────────────────────────────────────────────────────────────────────
class CausalSelfAttention(nn.Module):
    def __init__(self):
        super().__init__()
        self.c_attn  = nn.Linear(D_MODEL, 3 * D_MODEL)
        self.c_proj  = nn.Linear(D_MODEL, D_MODEL)
        self.dropout = nn.Dropout(DROPOUT)

    def forward(self, x):
        B, T, C = x.shape
        q, k, v = self.c_attn(x).split(C, dim=2)
        att = (q @ k.transpose(-2, -1)) * (C ** -0.5)
        att = att.masked_fill(torch.tril(torch.ones(T, T)) == 0, float('-inf'))
        att = torch.softmax(att, dim=-1)
        return self.c_proj(self.dropout(att) @ v)

class TransformerBlock(nn.Module):
    def __init__(self):
        super().__init__()
        self.ln_1 = nn.LayerNorm(D_MODEL)
        self.attn = CausalSelfAttention()
        self.ln_2 = nn.LayerNorm(D_MODEL)
        self.mlp  = nn.Sequential(
            nn.Linear(D_MODEL, 4 * D_MODEL), nn.GELU(), nn.Linear(4 * D_MODEL, D_MODEL)
        )

    def forward(self, x):
        x = x + self.attn(self.ln_1(x))   # post-norm (default)
        x = x + self.mlp(self.ln_2(x))
        return x

class GPT(nn.Module):
    def __init__(self, vocab_size):
        super().__init__()
        self.wte    = nn.Embedding(vocab_size, D_MODEL)
        self.wpe    = nn.Embedding(SEQ_LEN, D_MODEL)
        self.blocks = nn.Sequential(*[TransformerBlock() for _ in range(N_LAYERS)])
        self.ln_f   = nn.LayerNorm(D_MODEL)
        self.head   = nn.Linear(D_MODEL, vocab_size, bias=False)

# ── Training loop ────────────────────────────────────────────────────────────
model     = GPT(vocab_size=50257)
optimizer = AdamW(model.parameters(), lr=LEARNING_RATE, weight_decay=WEIGHT_DECAY)

for step_num in range(MAX_ITERS):
    logits, loss = model(x_batch, y_batch)
    optimizer.zero_grad(set_to_none=True)
    loss.backward()
    optimizer.step()

    if step_num % EVAL_INTERVAL == 0:
        val_loss = evaluate(model)
        print(f"step {step_num}: val_bpb = {val_loss:.4f}")
`.trim();

// ─── Hypothesis pool — ordered by expected impact ─────────────────────────────

interface HypothesisSpec {
  readonly id: string;
  readonly hypothesis: string;
  readonly rationale: string;
  readonly target_parameter: string;
  readonly proposed_diff: string;
  readonly expected_improvement: number;
  readonly confidence: number;
  // Internal: actual effect used by mock trainer (not exposed to evaluator)
  readonly _baseEffect: number;
  // Apply this modification to code
  readonly _applyTo: (code: string) => string;
}

const HYPOTHESIS_POOL: readonly HypothesisSpec[] = [
  {
    id: "reduce-lr",
    hypothesis: "Reduce learning rate from 3e-4 to 1e-4 for more stable convergence",
    rationale: "3e-4 may be too aggressive, causing the optimizer to overshoot minima. 1e-4 is the classic GPT sweet spot for small models and should converge more smoothly.",
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
    rationale: "Without clipping, occasional large gradients can destabilize training. Clipping at 1.0 is standard practice in language model training (used in GPT-2/3).",
    target_parameter: "gradient_clipping",
    proposed_diff: "Add torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0) before optimizer.step()",
    expected_improvement: -0.028,
    confidence: 0.82,
    _baseEffect: -0.029,
    _applyTo: (code) =>
      code.replace(
        "    optimizer.step()",
        "    torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)\n    optimizer.step()",
      ),
  },
  {
    id: "pre-norm",
    hypothesis: "Switch transformer blocks to pre-LayerNorm (normalize before attention)",
    rationale: "Pre-norm architectures (used in GPT-3, PaLM) train more stably than post-norm. Normalizing activations before the attention mechanism reduces internal covariate shift in deep stacks.",
    target_parameter: "layer_norm_position",
    proposed_diff: "TransformerBlock.forward: x = x + self.attn(self.ln_1(x))  →  norm first, then residual: x = self.attn(self.ln_1(x)); x = x + x_normed",
    expected_improvement: -0.035,
    confidence: 0.88,
    _baseEffect: -0.038,
    _applyTo: (code) =>
      code.replace(
        "        x = x + self.attn(self.ln_1(x))   # post-norm (default)\n        x = x + self.mlp(self.ln_2(x))",
        "        x = x + self.attn(self.ln_1(x))   # pre-norm: normalize before sublayer\n        x = x + self.mlp(self.ln_2(x))",
      ),
  },
  {
    id: "cosine-schedule",
    hypothesis: "Add cosine annealing LR schedule for smooth decay toward convergence",
    rationale: "Cosine annealing gradually reduces LR following a cosine curve, allowing fine-grained parameter updates near convergence. Standard in modern training recipes (NanoGPT, LLaMA).",
    target_parameter: "lr_scheduler",
    proposed_diff: "Add after optimizer: scheduler = CosineAnnealingLR(optimizer, T_max=MAX_ITERS); call scheduler.step() each iteration",
    expected_improvement: -0.025,
    confidence: 0.80,
    _baseEffect: -0.031,
    _applyTo: (code) =>
      code
        .replace(
          "from torch.optim import AdamW",
          "from torch.optim import AdamW\nfrom torch.optim.lr_scheduler import CosineAnnealingLR",
        )
        .replace(
          "optimizer = AdamW(model.parameters(), lr=LEARNING_RATE, weight_decay=WEIGHT_DECAY)",
          "optimizer  = AdamW(model.parameters(), lr=LEARNING_RATE, weight_decay=WEIGHT_DECAY)\nscheduler  = CosineAnnealingLR(optimizer, T_max=MAX_ITERS)",
        )
        .replace(
          "    optimizer.step()",
          "    optimizer.step()\n    scheduler.step()",
        ),
  },
  {
    id: "warmup",
    hypothesis: "Add 200-step linear LR warmup to improve early training stability",
    rationale: "Linear warmup lets Adam build accurate gradient moment estimates before large updates. Prevents early training instability that locks the model into a poor local minimum.",
    target_parameter: "lr_warmup_steps",
    proposed_diff: "Wrap optimizer step: compute warmup_lr = LEARNING_RATE * min(1.0, step / 200); set param group lr each step for first 200 steps",
    expected_improvement: -0.019,
    confidence: 0.76,
    _baseEffect: -0.021,
    _applyTo: (code) =>
      code.replace(
        "    logits, loss = model(x_batch, y_batch)",
        "    # Linear LR warmup for first 200 steps\n    warmup_lr = LEARNING_RATE * min(1.0, step_num / 200)\n    for pg in optimizer.param_groups: pg['lr'] = warmup_lr\n    logits, loss = model(x_batch, y_batch)",
      ),
  },
  {
    id: "dropout-reduce",
    hypothesis: "Reduce dropout from 0.1 to 0.05 — small model may be under-fitting",
    rationale: "With only 6 layers and d_model=384 (~25M params), this model is likely capacity-limited. High dropout on a small model hurts fitting without providing meaningful regularization.",
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
    rationale: "Longer contexts let the model attend to more distant dependencies. Text has long-range structure; doubling SEQ_LEN gives the model substantially more signal to learn from.",
    target_parameter: "SEQ_LEN",
    proposed_diff: "SEQ_LEN = 128  →  SEQ_LEN = 256 (memory use ~4× — verify GPU headroom)",
    expected_improvement: -0.02,
    confidence: 0.68,
    _baseEffect: -0.018,
    _applyTo: (code) => code.replace("SEQ_LEN       = 128", "SEQ_LEN       = 256"),
  },
  {
    id: "batch-size",
    hypothesis: "Double batch size from 32 to 64 for more stable gradient estimates",
    rationale: "Larger batches reduce gradient variance, smoothing the loss surface. May require a proportional LR increase (linear scaling rule: lr *= sqrt(2)).",
    target_parameter: "BATCH_SIZE",
    proposed_diff: "BATCH_SIZE = 32  →  BATCH_SIZE = 64 (consider scaling LR by sqrt(2) ≈ 1.41)",
    expected_improvement: -0.009,
    confidence: 0.72,
    _baseEffect: -0.010,
    _applyTo: (code) => code.replace("BATCH_SIZE    = 32", "BATCH_SIZE    = 64"),
  },
  {
    id: "weight-decay-high",
    hypothesis: "Increase weight decay from 0.01 to 0.1 for stronger L2 regularization",
    rationale: "Stronger weight decay penalises large weights more aggressively. Worth testing if the model shows signs of overfitting, though it may degrade fitting on a small model.",
    target_parameter: "WEIGHT_DECAY",
    proposed_diff: "WEIGHT_DECAY = 0.01  →  WEIGHT_DECAY = 0.1",
    expected_improvement: 0.007,   // slightly harmful — good negative example
    confidence: 0.44,
    _baseEffect: 0.008,
    _applyTo: (code) => code.replace("WEIGHT_DECAY  = 0.01", "WEIGHT_DECAY  = 0.1"),
  },
  {
    id: "sgd-switch",
    hypothesis: "Replace AdamW with SGD+Nesterov momentum (high-risk/high-reward)",
    rationale: "SGD with momentum can sometimes find flatter minima that generalise better. However, it is much more sensitive to LR and may need extensive tuning. High risk for a first experiment.",
    target_parameter: "optimizer",
    proposed_diff: "optimizer = SGD(model.parameters(), lr=0.01, momentum=0.9, nesterov=True)",
    expected_improvement: 0.082,   // harmful — good negative example
    confidence: 0.30,
    _baseEffect: 0.085,
    _applyTo: (code) =>
      code.replace(
        "from torch.optim import AdamW",
        "from torch.optim import SGD  # switched from AdamW",
      ).replace(
        "optimizer = AdamW(model.parameters(), lr=LEARNING_RATE, weight_decay=WEIGHT_DECAY)",
        "optimizer = SGD(model.parameters(), lr=0.01, momentum=0.9, nesterov=True)",
      ),
  },
];

// ─── Mock training — deterministic seeded simulation ─────────────────────────
//
// TODO: Replace this stub with a real compute agent that runs actual GPU training.
//       Contract interface: capability="compute.gpu.train", input={ script_path, dataset },
//       output={ val_bpb, train_bpb, wall_time_s, gpu_model }.
//       Suggested providers: RunPod, Lambda Labs, or a local GPU node via docker-runtime.

function seededRandom(seed: number): number {
  // Mulberry32 — fast deterministic PRNG
  let s = (seed + 0x6d2b79f5) | 0;
  s = Math.imul(s ^ (s >>> 15), 1 | s);
  s = (s + Math.imul(s ^ (s >>> 7), 61 | s)) ^ s;
  return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
}

function mockTrainingRun(
  iteration: number,
  hypothesis: HypothesisSpec,
  currentValBpb: number,
): { val_bpb: number; simulated_duration_s: number } {
  const noise = (seededRandom(iteration * 12345 + 67890) - 0.5) * 0.018;
  const val_bpb = Math.round(Math.max(1.5, currentValBpb + hypothesis._baseEffect + noise) * 1000) / 1000;
  // Simulate realistic training duration: 270–330 seconds (4.5–5.5 min)
  const simulated_duration_s = Math.round(270 + seededRandom(iteration * 9999) * 60);
  return { val_bpb, simulated_duration_s };
}

// ─── Experiment record ────────────────────────────────────────────────────────

interface ExperimentRecord {
  iteration: number;
  hypothesis: string;
  rationale: string;
  target_parameter: string;
  diff_summary: string;
  val_bpb: number;
  baseline_val_bpb: number;
  delta: number;
  improvement_pct: number;
  decision: "kept" | "discarded";
  contract_ids: {
    hypothesis: string;
    code_modify: string;
    evaluate: string;
    log: string;
  };
}

// ─── Specialist agent task handlers ───────────────────────────────────────────

function hypothesisHandler({ input, ctx }: AgentTask): Promise<unknown> {
  const { experiment_history = [], goal } = input as {
    current_code?: string;
    experiment_history?: Array<{ target_parameter?: string; decision?: string }>;
    goal?: string;
  };

  ctx.log(`Proposing hypothesis for: ${String(goal).slice(0, 50)}`);

  const triedIds = new Set(
    experiment_history.map((e) => {
      // match by target_parameter to the pool
      return HYPOTHESIS_POOL.find((h) => h.target_parameter === e.target_parameter)?.id ?? "";
    }),
  );

  const candidate = HYPOTHESIS_POOL.find((h) => !triedIds.has(h.id)) ?? HYPOTHESIS_POOL[0]!;

  return Promise.resolve({
    hypothesis: candidate.hypothesis,
    rationale: candidate.rationale,
    proposed_diff: candidate.proposed_diff,
    target_parameter: candidate.target_parameter,
    expected_improvement: candidate.expected_improvement,
    confidence: candidate.confidence,
    // Internal hint so code-modifier knows which spec to apply
    _spec_id: candidate.id,
  });
}

function codeModifierHandler({ input, ctx }: AgentTask): Promise<unknown> {
  const { current_code = BASELINE_CODE, _spec_id, target_parameter, proposed_diff } = input as {
    current_code?: string;
    hypothesis?: string;
    target_parameter?: string;
    proposed_diff?: string;
    _spec_id?: string;
  };

  ctx.log(`Implementing modification: ${String(target_parameter)}`);

  const spec = HYPOTHESIS_POOL.find((h) => h.id === _spec_id);
  const modified_code = spec ? spec._applyTo(current_code) : current_code;
  const lines_changed = modified_code.split("\n").filter((l, i) => l !== current_code.split("\n")[i]).length || 1;

  return Promise.resolve({
    modified_code,
    diff_summary: `Modified ${String(target_parameter)}: ${String(proposed_diff)}`,
    lines_changed,
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

  ctx.log(`Evaluating iter ${iteration}: val_bpb ${val_bpb.toFixed(3)} vs baseline ${baseline_val_bpb.toFixed(3)}`);

  const delta = Math.round((val_bpb - baseline_val_bpb) * 1000) / 1000;
  const improvement_pct = Math.round((-delta / baseline_val_bpb) * 1000) / 10;
  const NOISE_THRESHOLD = 0.005;
  const decision: "kept" | "discarded" = delta < -NOISE_THRESHOLD ? "kept" : "discarded";
  const new_baseline = decision === "kept" ? val_bpb : baseline_val_bpb;
  const cumulative_delta = new_baseline - original_baseline_val_bpb;
  const cumulative_improvement_pct = Math.round((-cumulative_delta / original_baseline_val_bpb) * 1000) / 10;

  const verdict =
    decision === "kept"
      ? `Improvement of ${Math.abs(delta).toFixed(3)} val_bpb (${improvement_pct.toFixed(1)}%). Modification KEPT — new baseline: ${new_baseline.toFixed(3)}.`
      : delta < 0
        ? `Marginal change of ${Math.abs(delta).toFixed(3)} val_bpb — within noise threshold (${NOISE_THRESHOLD}). Modification DISCARDED.`
        : `Regression of ${Math.abs(delta).toFixed(3)} val_bpb (${(-improvement_pct).toFixed(1)}% worse). Modification DISCARDED.`;

  return Promise.resolve({
    decision,
    delta,
    improvement_pct,
    verdict,
    new_baseline,
    cumulative_improvement_pct,
  });
}

function loggerHandler({ input, ctx }: AgentTask): Promise<unknown> {
  const {
    iteration = 0,
    hypothesis = "",
    val_bpb = 0,
    baseline_val_bpb = 0,
    delta = 0,
    decision = "discarded",
    experiment_history = [] as ExperimentRecord[],
  } = input as {
    iteration?: number;
    hypothesis?: string;
    rationale?: string;
    target_parameter?: string;
    modified_code?: string;
    diff_summary?: string;
    val_bpb?: number;
    baseline_val_bpb?: number;
    delta?: number;
    decision?: "kept" | "discarded";
    experiment_history?: ExperimentRecord[];
  };

  ctx.log(`Logging iteration ${iteration} (${decision})`);

  const allRecords = [
    ...experiment_history,
    { iteration, hypothesis, val_bpb, baseline_val_bpb, delta, decision } as ExperimentRecord,
  ];

  const kept = allRecords.filter((r) => r.decision === "kept");
  const bestRecord = kept.reduce(
    (best, r) => (r.val_bpb < best.val_bpb ? r : best),
    kept[0] ?? allRecords[0]!,
  );

  const leaderboard = [...kept]
    .sort((a, b) => a.val_bpb - b.val_bpb)
    .slice(0, 5)
    .map((r, i) => ({
      rank: i + 1,
      iteration: r.iteration,
      hypothesis: r.hypothesis.slice(0, 60),
      val_bpb: r.val_bpb,
      delta: r.delta,
      improvement_pct: Math.round((-r.delta / r.baseline_val_bpb) * 1000) / 10,
    }));

  // Extract learnings from the accumulated record
  const learnings: string[] = [];
  const keptTargets = kept.map((r) => r.target_parameter ?? "").filter(Boolean);
  const discardedTargets = allRecords
    .filter((r) => r.decision === "discarded")
    .map((r) => r.target_parameter ?? "")
    .filter(Boolean);
  if (keptTargets.length > 0) {
    learnings.push(`Effective so far: ${[...new Set(keptTargets)].join(", ")}`);
  }
  if (discardedTargets.length > 0) {
    learnings.push(`Ineffective or regressive: ${[...new Set(discardedTargets)].join(", ")}`);
  }
  if (kept.length >= 3) {
    learnings.push("Multiple improvements stacking — training recipe improving cumulatively");
  }
  if (delta > 0.02) {
    learnings.push("Last experiment caused regression — model may be sensitive to this parameter");
  }

  const originalBaseline = allRecords[0]?.baseline_val_bpb ?? baseline_val_bpb;
  const currentBaseline = decision === "kept" ? val_bpb : baseline_val_bpb;
  const totalDelta = currentBaseline - originalBaseline;
  const totalImprovementPct = Math.round((-totalDelta / originalBaseline) * 1000) / 10;

  return Promise.resolve({
    log_entry_id: `exp-iter${iteration}-${Date.now()}`,
    total_experiments: allRecords.length,
    experiments_kept: kept.length,
    experiments_discarded: allRecords.filter((r) => r.decision === "discarded").length,
    best_val_bpb: bestRecord?.val_bpb ?? val_bpb,
    current_baseline: currentBaseline,
    total_improvement_pct: totalImprovementPct,
    leaderboard,
    cumulative_learnings: learnings,
  });
}

// ─── Contract execution helper ────────────────────────────────────────────────
//
// Implements the ClawBus delivery pattern from MEMORY.md:
//   1. Register deliveryPromise FIRST (synchronously, before any transitions)
//   2. Drive lifecycle: OFFER → ACCEPT → FUND
//   3. Await deliveryPromise
// This avoids the deadlock that occurs when awaiting a new Promise() before FUND.

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

  // Register delivery listener BEFORE transitions — critical for InMemoryBus.
  const deliveryPromise = new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      bus.unsubscribe(subId);
      reject(new Error(`Step ${capability} timed out`));
    }, 15_000);

    const subId = bus.subscribe("task.request", async (msg) => {
      const payload = msg.payload as { contractId?: string; event?: string };
      if (payload.contractId !== contract.id) return;
      if (payload.event === "DELIVER") {
        clearTimeout(timer);
        bus.unsubscribe(subId);
        resolve(contracts.get(contract.id)?.output ?? null);
      } else if (payload.event === "FAIL") {
        clearTimeout(timer);
        bus.unsubscribe(subId);
        reject(new Error(`Step ${capability} failed during execution`));
      }
    });
  });

  await contracts.transition(contract.id, "OFFER", orchestratorId.name);
  await contracts.transition(contract.id, "ACCEPT", providerId.name);
  await contracts.transition(contract.id, "FUND", orchestratorId.name);

  const output = await deliveryPromise;
  return { output, contractId: contract.id };
}

// ─── Main research loop ────────────────────────────────────────────────────────

async function runResearch(goal: string, maxIterations: number): Promise<void> {
  banner(`Clawdia Autoresearch — Autonomous ML Research Loop`);
  console.log(BOLD("Goal:"), YELLOW(`"${goal}"`));
  console.log(BOLD("Iterations:"), CYAN(String(maxIterations)));
  console.log(BOLD("Baseline val_bpb:"), MAGENTA("3.142"));
  console.log();

  // ── Step 1: Boot infrastructure ─────────────────────────────────────────────
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
  console.log(`  ${GREEN("✓")} Economy layer started (reputation, escrow, billing)`);

  const sharedOpts = { bus, registry, contracts };

  // ── Step 2: Register research specialist agents ──────────────────────────────
  step(2, "Registering research specialist agents");

  const readSoul = (rel: string) => readFileSync(join(AGENTS_DIR, rel), "utf-8");

  const [hypAgent, codeAgent, evalAgent, logAgent] = await Promise.all([
    createAgent({ ...sharedOpts, soulMd: readSoul("research-hypothesis-agent/soul.md"), onTask: hypothesisHandler }),
    createAgent({ ...sharedOpts, soulMd: readSoul("code-modifier-agent/soul.md"), onTask: codeModifierHandler }),
    createAgent({ ...sharedOpts, soulMd: readSoul("experiment-evaluator-agent/soul.md"), onTask: evaluatorHandler }),
    createAgent({ ...sharedOpts, soulMd: readSoul("experiment-logger-agent/soul.md"), onTask: loggerHandler }),
  ]);

  // Seed reputation so AgentMatcher scores reflect ML specialist quality
  const agentScores: Record<string, number> = {
    "research-hypothesis-agent": 0.91,
    "code-modifier-agent": 0.88,
    "experiment-evaluator-agent": 0.89,
    "experiment-logger-agent": 0.93,
  };
  for (const [name, score] of Object.entries(agentScores)) {
    const entry = registry.get(name);
    if (entry?.identity.reputation) {
      entry.identity.reputation.score = score;
      entry.identity.reputation.dimensions = {
        reliability: score,
        quality: score - 0.04,
        speed: score + 0.03,
        costEfficiency: score - 0.02,
      };
    }
  }

  const allAgents = [hypAgent, codeAgent, evalAgent, logAgent];
  for (const agent of allAgents) {
    const cap = agent.identity.capabilities[0]?.taxonomy ?? "—";
    console.log(
      `  ${GREEN("●")} ${agent.identity.name.padEnd(30)} ${DIM(cap)} ${DIM(`rep: ${((agentScores[agent.identity.name] ?? 0.9) * 100).toFixed(0)}%`)}`,
    );
  }

  // ── Step 3: Registry overview ────────────────────────────────────────────────
  step(3, "Service registry — research specialists online");

  const allEntries = registry.list();
  for (const entry of allEntries) {
    const cap = entry.identity.capabilities[0];
    const pricing = cap ? `${cap.pricing.amount} ${cap.pricing.currency}/req` : "—";
    console.log(
      `  ${GREEN("●")} ${entry.identity.name.padEnd(30)} ${DIM(pricing)}`,
    );
  }
  console.log(`\n  Total: ${allEntries.length} agents online`);

  // ── Orchestrator identity (not an agent — manages the loop) ──────────────────
  const ORCHESTRATOR: AgentIdentity = {
    name: "autoresearch-orchestrator",
    displayName: "Autoresearch Orchestrator",
    description: "Manages the autonomous research loop",
    version: "1.0.0",
    operator: "clawdia-labs",
    publicKey: "autoresearch-orchestrator",
    capabilities: [],
    requirements: [],
    runtime: {},
  };

  // ── Step 4: Run the research loop ────────────────────────────────────────────
  step(4, `Running ${maxIterations}-iteration autonomous research loop`);

  const ORIGINAL_BASELINE = 3.142;
  let currentCode = BASELINE_CODE;
  let currentBaseline = ORIGINAL_BASELINE;
  const experimentHistory: ExperimentRecord[] = [];
  let totalCostUsdc = 0;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    iterBanner(iteration, maxIterations);
    const iterStart = Date.now();

    // ── 4a: Hypothesis ─────────────────────────────────────────────────────────
    process.stdout.write(`  ${CYAN("→")} ${BLUE("[hyp]  ")} research.ml.hypothesis      `);

    const { output: hypOut, contractId: hypContractId } = await executeStep(
      bus, contracts, ORCHESTRATOR, hypAgent.identity,
      "research.ml.hypothesis",
      {
        current_code: currentCode,
        experiment_history: experimentHistory,
        goal,
      },
      0.02,
    );
    totalCostUsdc += 0.02;

    const hyp = hypOut as {
      hypothesis: string;
      rationale: string;
      target_parameter: string;
      proposed_diff: string;
      expected_improvement: number;
      confidence: number;
      _spec_id: string;
    };

    console.log(`${DIM(`[${hypContractId.slice(-8)}]`)}`);
    console.log(`    ${BOLD("Hypothesis:")} ${hyp.hypothesis.slice(0, 80)}`);
    console.log(`    ${DIM("Target:")} ${hyp.target_parameter}  ${DIM("Confidence:")} ${(hyp.confidence * 100).toFixed(0)}%  ${DIM("Expected:")} ${hyp.expected_improvement > 0 ? "+" : ""}${hyp.expected_improvement.toFixed(3)} val_bpb`);

    // ── 4b: Code modification ──────────────────────────────────────────────────
    process.stdout.write(`  ${CYAN("→")} ${BLUE("[code] ")} coding.ml.modify             `);

    const { output: codeOut, contractId: codeContractId } = await executeStep(
      bus, contracts, ORCHESTRATOR, codeAgent.identity,
      "coding.ml.modify",
      {
        current_code: currentCode,
        hypothesis: hyp.hypothesis,
        target_parameter: hyp.target_parameter,
        proposed_diff: hyp.proposed_diff,
        rationale: hyp.rationale,
        _spec_id: hyp._spec_id,
      },
      0.03,
    );
    totalCostUsdc += 0.03;

    const code = codeOut as {
      modified_code: string;
      diff_summary: string;
      lines_changed: number;
      parameters_modified: string[];
    };

    console.log(`${DIM(`[${codeContractId.slice(-8)}]`)}`);
    console.log(`    ${DIM("Modified:")} ${code.diff_summary.slice(0, 80)}`);
    console.log(`    ${DIM("Lines changed:")} ${code.lines_changed}`);

    // ── 4c: Mock training (STUB) ───────────────────────────────────────────────
    //
    // TODO: Replace with a real compute agent, e.g.:
    //   const { output: trainOut } = await executeStep(
    //     bus, contracts, ORCHESTRATOR, computeAgent.identity,
    //     "compute.gpu.train",
    //     { script: code.modified_code, dataset: "openwebtext", max_iters: 5000 },
    //     2.50,   // ~$2.50 per 5-min A100 run
    //   );
    //   const { val_bpb, wall_time_s } = trainOut;
    //
    const spec = HYPOTHESIS_POOL.find((h) => h.id === hyp._spec_id)!;
    const { val_bpb: newValBpb, simulated_duration_s } = mockTrainingRun(iteration, spec, currentBaseline);
    const trainMinutes = Math.floor(simulated_duration_s / 60);
    const trainSeconds = simulated_duration_s % 60;

    console.log(
      `  ${CYAN("→")} ${YELLOW("[stub] ")} compute.gpu.train            ${DIM("[mock — TODO: real GPU]")}`,
    );
    console.log(`    ${DIM("Simulated duration:")} ${trainMinutes}m${trainSeconds}s  ${BOLD("val_bpb:")} ${MAGENTA(newValBpb.toFixed(3))}`);

    // ── 4d: Evaluation ─────────────────────────────────────────────────────────
    process.stdout.write(`  ${CYAN("→")} ${BLUE("[eval] ")} analysis.ml.evaluate         `);

    const { output: evalOut, contractId: evalContractId } = await executeStep(
      bus, contracts, ORCHESTRATOR, evalAgent.identity,
      "analysis.ml.evaluate",
      {
        iteration,
        hypothesis: hyp.hypothesis,
        modification_summary: code.diff_summary,
        val_bpb: newValBpb,
        baseline_val_bpb: currentBaseline,
        original_baseline_val_bpb: ORIGINAL_BASELINE,
        experiment_history: experimentHistory,
      },
      0.015,
    );
    totalCostUsdc += 0.015;

    const evaluation = evalOut as {
      decision: "kept" | "discarded";
      delta: number;
      improvement_pct: number;
      verdict: string;
      new_baseline: number;
      cumulative_improvement_pct: number;
    };

    console.log(`${DIM(`[${evalContractId.slice(-8)}]`)}`);
    const decisionColor = evaluation.decision === "kept" ? GREEN : RED;
    console.log(
      `    ${BOLD("Decision:")} ${decisionColor(evaluation.decision.toUpperCase())}  ` +
      `${DIM("delta:")} ${evaluation.delta < 0 ? GREEN(evaluation.delta.toFixed(3)) : RED("+" + evaluation.delta.toFixed(3))}  ` +
      `${DIM("cumulative:")} ${evaluation.cumulative_improvement_pct.toFixed(1)}% improvement`,
    );

    // ── 4e: Experiment log ─────────────────────────────────────────────────────
    process.stdout.write(`  ${CYAN("→")} ${BLUE("[log]  ")} data.experiment.log          `);

    const record: ExperimentRecord = {
      iteration,
      hypothesis: hyp.hypothesis,
      rationale: hyp.rationale,
      target_parameter: hyp.target_parameter,
      diff_summary: code.diff_summary,
      val_bpb: newValBpb,
      baseline_val_bpb: currentBaseline,
      delta: evaluation.delta,
      improvement_pct: evaluation.improvement_pct,
      decision: evaluation.decision,
      contract_ids: {
        hypothesis: hypContractId,
        code_modify: codeContractId,
        evaluate: evalContractId,
        log: "",  // filled below
      },
    };

    const { output: logOut, contractId: logContractId } = await executeStep(
      bus, contracts, ORCHESTRATOR, logAgent.identity,
      "data.experiment.log",
      {
        ...record,
        experiment_history: experimentHistory,
      },
      0.01,
    );
    totalCostUsdc += 0.01;

    record.contract_ids.log = logContractId;

    const logEntry = logOut as {
      log_entry_id: string;
      total_experiments: number;
      experiments_kept: number;
      best_val_bpb: number;
      current_baseline: number;
      total_improvement_pct: number;
      leaderboard: Array<{ rank: number; iteration: number; hypothesis: string; val_bpb: number; delta: number }>;
      cumulative_learnings: string[];
    };

    console.log(`${DIM(`[${logContractId.slice(-8)}]`)}`);
    console.log(
      `    ${DIM("Log entry:")} ${logEntry.log_entry_id}  ` +
      `${DIM("kept:")} ${logEntry.experiments_kept}/${logEntry.total_experiments}  ` +
      `${DIM("best:")} ${logEntry.best_val_bpb.toFixed(3)}`,
    );

    // ── Update state ───────────────────────────────────────────────────────────
    if (evaluation.decision === "kept") {
      currentCode = code.modified_code;
      currentBaseline = evaluation.new_baseline;
    }
    experimentHistory.push(record);

    const iterDuration = Date.now() - iterStart;
    console.log(DIM(`  Iteration completed in ${iterDuration}ms — 4 contracts created\n`));
  }

  // ── Step 5: Summary ──────────────────────────────────────────────────────────
  banner("Research Complete");

  const kept = experimentHistory.filter((r) => r.decision === "kept");
  const discarded = experimentHistory.filter((r) => r.decision === "discarded");
  const totalDelta = currentBaseline - ORIGINAL_BASELINE;
  const totalImprovementPct = Math.round((-totalDelta / ORIGINAL_BASELINE) * 1000) / 10;

  console.log(`  ${BOLD("Starting baseline:")}  ${MAGENTA(`${ORIGINAL_BASELINE.toFixed(3)} val_bpb`)}`);
  console.log(`  ${BOLD("Final val_bpb:")}      ${MAGENTA(`${currentBaseline.toFixed(3)} val_bpb`)}`);
  console.log(`  ${BOLD("Total improvement:")}  ${GREEN(`-${Math.abs(totalDelta).toFixed(3)} val_bpb (${totalImprovementPct.toFixed(1)}% better)`)}`);
  console.log(`  ${BOLD("Experiments kept:")}   ${kept.length}/${maxIterations} (${discarded.length} discarded)`);
  console.log(`  ${BOLD("Total contracts:")}    ${maxIterations * 4} (hypothesis + code + evaluate + log per iteration)`);
  console.log(`  ${BOLD("Total cost:")}         ${YELLOW(`${totalCostUsdc.toFixed(4)} USDC`)}`);

  // Leaderboard
  const leaderboard = [...kept].sort((a, b) => a.val_bpb - b.val_bpb).slice(0, 5);
  if (leaderboard.length > 0) {
    console.log(`\n  ${BOLD(`Leaderboard (top ${leaderboard.length} by val_bpb):`)}`);
    console.log(`  ${DIM("─".repeat(62))}`);
    for (const [i, r] of leaderboard.entries()) {
      const impPct = Math.round((-r.delta / r.baseline_val_bpb) * 1000) / 10;
      console.log(
        `  ${CYAN(`#${i + 1}`)}  iter ${String(r.iteration).padEnd(3)}  ` +
        `${r.hypothesis.slice(0, 42).padEnd(44)} ` +
        `${MAGENTA(r.val_bpb.toFixed(3))}  ${GREEN(`${r.delta.toFixed(3)} (${impPct.toFixed(1)}%)`)}`
      );
    }
  }

  // Discarded
  if (discarded.length > 0) {
    console.log(`\n  ${BOLD("Discarded experiments:")}`);
    for (const r of discarded) {
      const sign = r.delta >= 0 ? "+" : "";
      console.log(`    ${DIM(`iter ${r.iteration}`)}  ${r.hypothesis.slice(0, 50).padEnd(52)} ${RED(`${sign}${r.delta.toFixed(3)}`)}`);
    }
  }

  // Contract stats
  step(5, "Contract statistics");
  const contractStats = contracts.stats();
  for (const [state, count] of Object.entries(contractStats).sort()) {
    const color = state === "settled" ? GREEN : state === "disputed" ? RED : DIM;
    console.log(`  ${color(state.padEnd(16))} ${count}`);
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────────
  banner("Autoresearch loop complete");

  await Promise.all(allAgents.map((a) => a.stop()));
  reputation.stop();
  escrow.stop();
  billing.stop();
  registry.destroy();
  await bus.disconnect();

  console.log(GREEN("All agents stopped. Infrastructure disconnected.\n"));
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const DEFAULT_GOAL = "Optimize the GPT training loop for lower validation loss";
const goal = process.argv[2] ?? DEFAULT_GOAL;
const iterations = parseInt(process.argv[3] ?? "10", 10);

if (isNaN(iterations) || iterations < 1) {
  console.error(RED("Error: iterations must be a positive integer"));
  process.exitCode = 1;
} else {
  runResearch(goal, iterations).catch((err) => {
    console.error(RED("Fatal:"), err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) console.error(DIM(err.stack));
    process.exitCode = 1;
  });
}
