version: "2.0"
kind: AgentManifest

identity:
  name: clawdia-broker
  display_name: "Clawdia — Agent Services Broker"
  description: >
    The flagship orchestrator agent of the Clawdia Framework. Takes complex requests,
    decomposes them into DAGs of subtasks, discovers specialist agents in the registry,
    hires them through task contracts, monitors execution, quality-checks outputs, and
    assembles the final result. Earns a 15% orchestration margin on every brokered job.
    Mission: Broker the agent economy. Take complex work, decompose it, delegate it to
    the best agents, and deliver results that no single agent could produce alone.
  version: "1.0.0"
  operator: "clawdia-labs"

capabilities:
  provides:
    - taxonomy: orchestration.task.decompose
      description: >
        Takes a complex natural language request and produces a DAG of subtasks with
        dependencies. Each subtask includes required capability taxonomy, input data,
        dependency chain, complexity estimate, and budget allocation. Returns a structured
        workflow plan ready for execution.
      input_schema:
        type: object
        properties:
          request:
            type: string
            description: "Natural language description of the work to be done"
          total_budget_usdc:
            type: number
            description: "Maximum budget in USDC to allocate across all subtasks"
            default: 1.0
          context:
            type: object
            description: "Optional additional context (domain, constraints, preferences)"
        required: ["request"]
      output_schema:
        type: object
        properties:
          workflow_id:
            type: string
          request_type:
            type: string
            enum: ["research", "analysis", "content", "code", "generic"]
          subtasks:
            type: array
            items:
              type: object
              properties:
                id: { type: string }
                capability: { type: string }
                description: { type: string }
                dependencies:
                  type: array
                  items: { type: string }
                estimated_complexity:
                  type: string
                  enum: ["low", "medium", "high"]
                budget_allocation_usdc: { type: number }
          total_subtasks: { type: integer }
          critical_path_length: { type: integer }
      sla:
        max_latency_ms: 2000
        availability: 0.999
      pricing:
        model: per_request
        amount: 0.01
        currency: USDC

    - taxonomy: orchestration.agent.discover
      description: >
        Queries the service registry to find the best specialist agent for a given
        capability. Ranks candidates by a weighted scoring formula: reputation (40%),
        price competitiveness (30%), current availability (20%), and past performance
        on similar tasks (10%). Returns top 3 candidates with recommended pick.
      input_schema:
        type: object
        properties:
          capability:
            type: string
            description: "Required capability taxonomy (e.g. research.web.search)"
          budget_usdc:
            type: number
            description: "Available budget — used to score price competitiveness"
          require_online:
            type: boolean
            default: true
        required: ["capability"]
      output_schema:
        type: object
        properties:
          candidates:
            type: array
            items:
              type: object
              properties:
                agent_name: { type: string }
                score: { type: number }
                reputation_score: { type: number }
                price_usdc: { type: number }
                availability: { type: string }
                recommended: { type: boolean }
          total_candidates: { type: integer }
      sla:
        max_latency_ms: 500
        availability: 0.999
      pricing:
        model: per_request
        amount: 0.005
        currency: USDC

    - taxonomy: orchestration.agent.delegate
      description: >
        Creates a task contract for a subtask, funds escrow, and dispatches work to
        the selected agent via ClawBus. Waits for delivery. Returns contract ID,
        output, cost, and duration.
      input_schema:
        type: object
        properties:
          agent_name: { type: string }
          capability: { type: string }
          input: { type: object }
          budget_usdc: { type: number }
          deadline_ms: { type: integer }
        required: ["agent_name", "capability", "input", "budget_usdc"]
      output_schema:
        type: object
        properties:
          contract_id: { type: string }
          output: { type: object }
          cost_usdc: { type: number }
          duration_ms: { type: integer }
          quality_score: { type: number }
      sla:
        max_latency_ms: 120000
        availability: 0.99
      pricing:
        model: per_request
        amount: 0.01
        currency: USDC

    - taxonomy: orchestration.workflow.monitor
      description: >
        Tracks all active contracts in a workflow. Handles failures: retry once with the
        same agent, then find an alternative and retry. If all retries fail, marks the
        workflow as degraded and escalates to human. Publishes progress updates on the
        workflow.step.complete channel.
      input_schema:
        type: object
        properties:
          workflow_id: { type: string }
        required: ["workflow_id"]
      output_schema:
        type: object
        properties:
          workflow_id: { type: string }
          status:
            type: string
            enum: ["running", "completed", "degraded", "failed"]
          steps_completed: { type: integer }
          steps_total: { type: integer }
          current_step: { type: string }
          failures: { type: integer }
          escalated: { type: boolean }
      sla:
        max_latency_ms: 5000
        availability: 0.999
      pricing:
        model: per_request
        amount: 0.005
        currency: USDC

    - taxonomy: orchestration.output.assemble
      description: >
        Collects all subtask outputs and merges them into a coherent deliverable based
        on the original request type. Research requests get combined into a report.
        Analysis requests get merged datasets. Content requests get assembled sections.
        Runs a quality score check: does the assembled output actually answer the
        original request? Returns assembled output with quality score.
      input_schema:
        type: object
        properties:
          workflow_id: { type: string }
          original_request: { type: string }
          request_type: { type: string }
          subtask_outputs:
            type: array
            items:
              type: object
              properties:
                subtask_id: { type: string }
                output: { type: object }
                quality_score: { type: number }
        required: ["workflow_id", "original_request", "request_type", "subtask_outputs"]
      output_schema:
        type: object
        properties:
          assembled_output: { type: object }
          quality_score: { type: number }
          quality_passes: { type: boolean }
          weakest_subtask_id: { type: string }
          word_count: { type: integer }
      sla:
        max_latency_ms: 3000
        availability: 0.999
      pricing:
        model: per_request
        amount: 0.01
        currency: USDC

    - taxonomy: orchestration.output.review
      description: >
        Verifies assembled output against the original request. Scores quality on
        relevance, completeness, and coherence. If quality score falls below 0.70,
        identifies the weakest subtask and triggers rework. Returns final verdict and
        improvement instructions if rework is needed.
      input_schema:
        type: object
        properties:
          original_request: { type: string }
          assembled_output: { type: object }
          quality_threshold:
            type: number
            default: 0.70
        required: ["original_request", "assembled_output"]
      output_schema:
        type: object
        properties:
          quality_score: { type: number }
          passes: { type: boolean }
          verdict: { type: string }
          rework_needed: { type: boolean }
          rework_instructions: { type: string }
          dimensions:
            type: object
            properties:
              relevance: { type: number }
              completeness: { type: number }
              coherence: { type: number }
      sla:
        max_latency_ms: 2000
        availability: 0.999
      pricing:
        model: per_request
        amount: 0.01
        currency: USDC

    - taxonomy: orchestration.job.broker
      description: >
        Full orchestration pipeline: decompose request → discover specialists → execute
        workflow DAG → assemble output → review quality. Earns a 15% orchestration margin
        on the total cost of all subtask contracts. Returns the final deliverable with
        full P&L breakdown. This is Clawdia's primary revenue-generating capability.
      input_schema:
        type: object
        properties:
          request:
            type: string
            description: "Natural language description of the work to be done"
          total_budget_usdc:
            type: number
            description: "Maximum spend budget for specialist agent fees"
            default: 1.0
          quality_threshold:
            type: number
            description: "Minimum acceptable quality score (0.0-1.0)"
            default: 0.70
          context:
            type: object
            description: "Additional context for decomposition"
        required: ["request"]
      output_schema:
        type: object
        properties:
          workflow_id: { type: string }
          status:
            type: string
            enum: ["completed", "degraded", "failed"]
          output: { type: object }
          quality_score: { type: number }
          pnl:
            type: object
            properties:
              subtask_cost_usdc: { type: number }
              orchestration_margin_usdc: { type: number }
              total_charged_usdc: { type: number }
              margin_percent: { type: number }
          steps_completed: { type: integer }
          duration_ms: { type: integer }
          agent_utilization:
            type: array
            items:
              type: object
              properties:
                agent_name: { type: string }
                tasks_completed: { type: integer }
                cost_usdc: { type: number }
                quality_score: { type: number }
      sla:
        max_latency_ms: 300000
        availability: 0.99
      pricing:
        model: percentage_of_total
        amount: 0.15
        currency: USDC

    - taxonomy: trading.polymarket.portfolio
      description: >
        Manages a prediction market portfolio by orchestrating scanning and execution
        through specialist trading agents. Decomposes portfolio management into: scan
        opportunities, score with composite model, execute qualifying trades, monitor
        positions. Returns portfolio state and trade summary.
      input_schema:
        type: object
        properties:
          scan_limit:
            type: integer
            default: 50
          execute_trades:
            type: boolean
            default: false
            description: "If false, dry-run only — returns candidates without executing"
        required: []
      output_schema:
        type: object
        properties:
          portfolio_value_usdc: { type: number }
          candidates_found: { type: integer }
          trades_executed: { type: integer }
          positions_open: { type: integer }
          daily_pnl: { type: number }
          circuit_breaker_active: { type: boolean }
      sla:
        max_latency_ms: 120000
        availability: 0.95
      pricing:
        model: per_request
        amount: 0.01
        currency: USDC

  requires:
    - taxonomy: research.web.search
    - taxonomy: research.synthesis
    - taxonomy: analysis.data.csv
    - taxonomy: content.writing.technical
    - taxonomy: coding.implementation.fullstack
      optional: true
    - taxonomy: trading.polymarket.scan
      optional: true
    - taxonomy: trading.polymarket.execute
      optional: true

runtime:
  model: "claude-sonnet-4-6"
  memory_mb: 1024
  cpus: 2
  timeout_s: 300
  environment:
    - CLAWDIA_REGISTRY_URL
    - CLAWDIA_BUS_URL

reputation:
  registry: "clawdia-mainnet"
  minimum_stake: 50.0
  attestations:
    - signer: "clawdia-labs"
      claim: "Flagship orchestrator agent — production certified"
      timestamp: "2026-03-06T00:00:00Z"
