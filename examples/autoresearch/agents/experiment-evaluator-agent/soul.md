version: "2.0"
kind: AgentManifest

identity:
  name: experiment-evaluator-agent
  display_name: "Experiment Evaluator Agent"
  description: >
    Evaluates ML training experiment results and decides whether to keep or discard
    each modification. Compares the new validation BPB to the current baseline,
    applies a noise threshold (improvements below 0.005 val_bpb are likely noise),
    and produces a structured verdict with improvement statistics. When an experiment
    is kept, the modified code becomes the new baseline for subsequent iterations.
    Part of the Clawdia autoresearch loop.
  version: "1.0.0"
  operator: "clawdia-labs"

capabilities:
  provides:
    - taxonomy: analysis.ml.evaluate
      description: >
        Compares experiment val_bpb to current baseline. Computes delta and improvement
        percentage. Applies a statistical noise threshold: improvements below 0.005
        val_bpb are considered within noise and the experiment is discarded. Returns
        a keep/discard decision, delta, improvement percentage, and the new baseline
        to use for subsequent iterations (unchanged if discarded, new val_bpb if kept).
        Also computes cumulative improvement from the original starting baseline.
      input_schema:
        type: object
        properties:
          iteration:
            type: integer
            description: "Current iteration number"
          hypothesis:
            type: string
            description: "The modification that was tested"
          modification_summary:
            type: string
            description: "Human-readable summary of code changes"
          val_bpb:
            type: number
            description: "Validation BPB achieved by this experiment"
          baseline_val_bpb:
            type: number
            description: "Current baseline val_bpb to compare against"
          original_baseline_val_bpb:
            type: number
            description: "Starting baseline from iteration 0 (for cumulative tracking)"
          experiment_history:
            type: array
            description: "All previous iterations"
            items:
              type: object
        required: ["iteration", "hypothesis", "val_bpb", "baseline_val_bpb", "original_baseline_val_bpb"]
      output_schema:
        type: object
        properties:
          decision:
            type: string
            enum: ["kept", "discarded"]
            description: "Whether to keep or discard this modification"
          delta:
            type: number
            description: "val_bpb change (negative = improvement)"
          improvement_pct:
            type: number
            description: "Percentage improvement over baseline"
          verdict:
            type: string
            description: "Human-readable evaluation summary"
          new_baseline:
            type: number
            description: "val_bpb to use as baseline for the next iteration"
          cumulative_improvement_pct:
            type: number
            description: "Total improvement from original starting baseline"
      sla:
        max_latency_ms: 3000
        availability: 0.99
      pricing:
        model: per_request
        amount: 0.015
        currency: USDC

runtime:
  model: "claude-sonnet-4-6"
  memory_mb: 256
  cpus: 1
  timeout_s: 15
  environment:
    - CLAWDIA_REGISTRY_URL

reputation:
  registry: "clawdia-mainnet"
  minimum_stake: 10.0
  attestations:
    - signer: "clawdia-labs"
      claim: "Experiment evaluation agent — production certified"
      timestamp: "2026-03-08T00:00:00Z"
