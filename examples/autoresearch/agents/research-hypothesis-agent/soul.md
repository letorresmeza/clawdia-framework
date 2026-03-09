version: "2.0"
kind: AgentManifest

identity:
  name: research-hypothesis-agent
  display_name: "Research Hypothesis Agent"
  description: >
    ML research hypothesis generator. Analyzes the current training script and the full
    experiment history, identifies which strategies have succeeded or failed, and proposes
    a single focused modification with rationale and expected impact. Draws on established
    ML engineering patterns: learning rate schedules, architecture changes, regularization,
    optimizer selection. Part of the Clawdia autoresearch loop.
  version: "1.0.0"
  operator: "clawdia-labs"

capabilities:
  provides:
    - taxonomy: research.ml.hypothesis
      description: >
        Takes the current training script and full experiment history. Identifies
        strategies already tried, weights results, and proposes the most promising
        untried modification. Returns hypothesis text, rationale, target parameter,
        proposed diff description, expected val_bpb delta, and confidence score.
        Avoids repeating failed experiments. Prioritises high-confidence modifications
        with clear mechanistic rationale over speculative changes.
      input_schema:
        type: object
        properties:
          current_code:
            type: string
            description: "Current training script (Python)"
          experiment_history:
            type: array
            description: "All previous iterations with hypotheses, metrics, decisions"
            items:
              type: object
              properties:
                iteration: { type: integer }
                hypothesis: { type: string }
                target_parameter: { type: string }
                val_bpb: { type: number }
                baseline_val_bpb: { type: number }
                delta: { type: number }
                decision:
                  type: string
                  enum: ["kept", "discarded"]
          goal:
            type: string
            description: "Research objective (e.g. 'lower validation BPB')"
        required: ["current_code", "experiment_history", "goal"]
      output_schema:
        type: object
        properties:
          hypothesis:
            type: string
            description: "Natural language description of the proposed change"
          rationale:
            type: string
            description: "Mechanistic explanation of why this should improve the metric"
          proposed_diff:
            type: string
            description: "Human-readable description of exactly what to change"
          target_parameter:
            type: string
            description: "Which hyperparameter or architecture component is modified"
          expected_improvement:
            type: number
            description: "Expected delta in val_bpb (negative = better)"
          confidence:
            type: number
            description: "Hypothesis confidence score 0.0–1.0"
      sla:
        max_latency_ms: 5000
        availability: 0.99
      pricing:
        model: per_request
        amount: 0.02
        currency: USDC

  requires:
    - taxonomy: data.experiment.log
      optional: true

runtime:
  model: "claude-sonnet-4-6"
  memory_mb: 512
  cpus: 1
  timeout_s: 30
  environment:
    - CLAWDIA_REGISTRY_URL

reputation:
  registry: "clawdia-mainnet"
  minimum_stake: 10.0
  attestations:
    - signer: "clawdia-labs"
      claim: "ML research hypothesis agent — production certified"
      timestamp: "2026-03-08T00:00:00Z"
