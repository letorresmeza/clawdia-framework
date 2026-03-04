version: "2.0"
kind: AgentManifest

identity:
  name: code-builder
  display_name: "Code Builder"
  description: "Full-stack coding agent capable of implementing features, fixing bugs, and writing tests"
  version: "1.0.0"
  operator: "clawdia-labs"

capabilities:
  provides:
    - taxonomy: coding.implementation.fullstack
      description: "Implement features from issue descriptions or specifications"
      input_schema:
        type: object
        properties:
          issue_description:
            type: string
          repo_url:
            type: string
          branch:
            type: string
          language:
            type: string
        required: ["issue_description"]
      output_schema:
        type: object
        properties:
          files_changed:
            type: array
            items:
              type: object
              properties:
                path: { type: string }
                action: { type: string, enum: ["created", "modified", "deleted"] }
          tests_passed:
            type: boolean
          pr_url:
            type: string
      sla:
        max_latency_ms: 600000
        availability: 0.99
      pricing:
        model: per_request
        amount: 0.50
        currency: USDC

    - taxonomy: coding.review.security
      description: "Security-focused code review"
      input_schema:
        type: object
        properties:
          pr_url: { type: string }
          focus_areas:
            type: array
            items: { type: string }
        required: ["pr_url"]
      output_schema:
        type: object
        properties:
          vulnerabilities:
            type: array
            items:
              type: object
              properties:
                severity: { type: string }
                location: { type: string }
                description: { type: string }
                fix_suggestion: { type: string }
          overall_risk: { type: string, enum: ["low", "medium", "high", "critical"] }
      sla:
        max_latency_ms: 120000
        availability: 0.99
      pricing:
        model: per_request
        amount: 0.10
        currency: USDC

  requires:
    - taxonomy: data.source.github

runtime:
  model: "claude-sonnet-4-5-20250929"
  image: "node:20-slim"
  memory_mb: 1024
  cpus: 2
  timeout_s: 600
  environment:
    - GITHUB_TOKEN
    - NPM_TOKEN

reputation:
  registry: "clawdia-testnet"
  minimum_stake: 25.0
