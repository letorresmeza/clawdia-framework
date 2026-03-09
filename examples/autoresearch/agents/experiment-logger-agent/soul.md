version: "2.0"
kind: AgentManifest

identity:
  name: experiment-logger-agent
  display_name: "Experiment Logger Agent"
  description: >
    Maintains the structured experiment log for the autoresearch loop. Appends each
    iteration's hypothesis, code diff, metrics, and keep/discard decision. Produces
    a ranked leaderboard of best results and extracts cumulative learnings (which
    patterns reliably improve performance, which categories consistently fail).
    Provides full provenance for reproducibility — every result is traceable to
    its exact code modification and training run. Part of the Clawdia autoresearch loop.
  version: "1.0.0"
  operator: "clawdia-labs"

capabilities:
  provides:
    - taxonomy: data.experiment.log
      description: >
        Appends a new experiment record to the running log. Computes an updated
        leaderboard (top results ranked by val_bpb). Extracts cumulative learnings:
        patterns that consistently improve performance, patterns that hurt, and
        open questions for future exploration. Returns the log entry ID, leaderboard
        snapshot, aggregate statistics, and a plain-English learning summary.
        All records include the full code diff for reproducibility.
      input_schema:
        type: object
        properties:
          iteration:
            type: integer
          hypothesis:
            type: string
          rationale:
            type: string
          target_parameter:
            type: string
          modified_code:
            type: string
          diff_summary:
            type: string
          val_bpb:
            type: number
          baseline_val_bpb:
            type: number
          delta:
            type: number
          decision:
            type: string
            enum: ["kept", "discarded"]
          experiment_history:
            type: array
            description: "Full prior history for leaderboard and learning extraction"
            items:
              type: object
        required: ["iteration", "hypothesis", "val_bpb", "baseline_val_bpb", "delta", "decision"]
      output_schema:
        type: object
        properties:
          log_entry_id:
            type: string
          total_experiments:
            type: integer
          experiments_kept:
            type: integer
          experiments_discarded:
            type: integer
          best_val_bpb:
            type: number
          current_baseline:
            type: number
          total_improvement_pct:
            type: number
          leaderboard:
            type: array
            items:
              type: object
              properties:
                rank: { type: integer }
                iteration: { type: integer }
                hypothesis: { type: string }
                val_bpb: { type: number }
                delta: { type: number }
                improvement_pct: { type: number }
          cumulative_learnings:
            type: array
            items:
              type: string
            description: "Key insights extracted from all experiments so far"
      sla:
        max_latency_ms: 2000
        availability: 0.999
      pricing:
        model: per_request
        amount: 0.01
        currency: USDC

runtime:
  model: "claude-haiku-4-5-20251001"
  memory_mb: 256
  cpus: 1
  timeout_s: 10
  environment:
    - CLAWDIA_REGISTRY_URL

reputation:
  registry: "clawdia-mainnet"
  minimum_stake: 5.0
  attestations:
    - signer: "clawdia-labs"
      claim: "Experiment logging agent — production certified"
      timestamp: "2026-03-08T00:00:00Z"
