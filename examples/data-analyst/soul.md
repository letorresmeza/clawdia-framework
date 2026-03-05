version: "2.0"
kind: AgentManifest

identity:
  name: data-analyst
  display_name: "Data Analyst"
  description: "Processes, analyzes, and visualizes structured data from CSV and JSON sources, generating statistical insights and trend reports"
  version: "1.0.0"
  operator: "clawdia-labs"

capabilities:
  provides:
    - taxonomy: analysis.data.csv
      description: "Parse and analyze CSV data — compute statistics, detect anomalies, and identify trends"
      input_schema:
        type: object
        properties:
          csv_data:
            type: string
            description: "Raw CSV content (inline) or a URL to fetch"
          columns:
            type: array
            items: { type: string }
            description: "Specific columns to analyze (all if omitted)"
          operations:
            type: array
            items:
              type: string
              enum: ["describe", "correlate", "trend", "anomaly", "group_by", "histogram"]
            default: ["describe"]
          group_by:
            type: string
            description: "Column name to group results by"
        required: ["csv_data"]
      output_schema:
        type: object
        properties:
          rows_analyzed: { type: integer }
          columns_analyzed: { type: integer }
          statistics:
            type: object
            description: "Column-level stats: mean, median, std, min, max, nulls"
          correlations:
            type: array
            items:
              type: object
              properties:
                col_a: { type: string }
                col_b: { type: string }
                coefficient: { type: number }
          anomalies:
            type: array
            items:
              type: object
              properties:
                row: { type: integer }
                column: { type: string }
                value: {}
                z_score: { type: number }
          trends:
            type: array
            items:
              type: object
              properties:
                column: { type: string }
                direction: { type: string, enum: ["up", "down", "flat"] }
                confidence: { type: number }
          summary: { type: string }
      sla:
        max_latency_ms: 20000
        availability: 0.98
      pricing:
        model: per_request
        amount: 0.05
        currency: USDC

    - taxonomy: analysis.data.json
      description: "Parse and analyze JSON data structures — extract patterns, validate schemas, compute aggregations"
      input_schema:
        type: object
        properties:
          json_data:
            type: string
            description: "Raw JSON content or a URL to fetch"
          schema:
            type: object
            description: "Optional JSON Schema to validate against"
          operations:
            type: array
            items:
              type: string
              enum: ["validate", "aggregate", "flatten", "diff", "extract_paths"]
            default: ["aggregate"]
          extract_paths:
            type: array
            items: { type: string }
            description: "JSONPath expressions to extract"
        required: ["json_data"]
      output_schema:
        type: object
        properties:
          valid: { type: boolean }
          validation_errors:
            type: array
            items: { type: string }
          aggregations: { type: object }
          extracted:
            type: array
            items: { type: object }
          structure_summary: { type: string }
          record_count: { type: integer }
      sla:
        max_latency_ms: 15000
        availability: 0.98
      pricing:
        model: per_request
        amount: 0.04
        currency: USDC

runtime:
  model: "claude-sonnet-4-6"
  memory_mb: 1024
  timeout_s: 120
  environment:
    - DATA_STORAGE_URL

reputation:
  registry: "clawdia-testnet"
  minimum_stake: 8.0
