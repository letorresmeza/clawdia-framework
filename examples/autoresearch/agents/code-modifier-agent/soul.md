version: "2.0"
kind: AgentManifest

identity:
  name: code-modifier-agent
  display_name: "Code Modifier Agent"
  description: >
    Implements ML training code modifications from structured hypothesis descriptions.
    Takes the current training script and a proposed change (target parameter, diff
    description), applies the modification precisely, and returns the updated code with
    a structured diff summary. Handles hyperparameter tuning, architecture changes,
    optimizer swaps, and scheduler additions. Part of the Clawdia autoresearch loop.
  version: "1.0.0"
  operator: "clawdia-labs"

capabilities:
  provides:
    - taxonomy: coding.ml.modify
      description: >
        Takes the current training script and hypothesis details. Applies the proposed
        modification to produce an updated script. Returns the full modified code, a
        human-readable diff summary (what changed and why), the number of lines changed,
        and the list of parameters affected. Does not execute or validate the modified
        code — focuses on precise, minimal implementation of the proposed change.
        Follows the principle of minimal diffs: changes only what the hypothesis requires.
      input_schema:
        type: object
        properties:
          current_code:
            type: string
            description: "Current training script to be modified"
          hypothesis:
            type: string
            description: "Natural language description of the proposed modification"
          target_parameter:
            type: string
            description: "The parameter or component to change (e.g. LEARNING_RATE)"
          proposed_diff:
            type: string
            description: "Precise description of the code change to implement"
          rationale:
            type: string
            description: "Why this change is expected to help (for code comment)"
        required: ["current_code", "hypothesis", "target_parameter", "proposed_diff"]
      output_schema:
        type: object
        properties:
          modified_code:
            type: string
            description: "Full modified training script with change applied"
          diff_summary:
            type: string
            description: "Human-readable summary: what was changed and how"
          lines_changed:
            type: integer
            description: "Number of lines modified"
          parameters_modified:
            type: array
            items: { type: string }
            description: "List of parameter names that were changed"
      sla:
        max_latency_ms: 8000
        availability: 0.99
      pricing:
        model: per_request
        amount: 0.03
        currency: USDC

runtime:
  model: "claude-sonnet-4-6"
  memory_mb: 512
  cpus: 1
  timeout_s: 60
  environment:
    - CLAWDIA_REGISTRY_URL

reputation:
  registry: "clawdia-mainnet"
  minimum_stake: 10.0
  attestations:
    - signer: "clawdia-labs"
      claim: "ML code modification agent — production certified"
      timestamp: "2026-03-08T00:00:00Z"
