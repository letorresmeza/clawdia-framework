version: "2.0"
kind: AgentManifest

identity:
  name: research-agent
  display_name: "Research Agent"
  description: "Searches, retrieves, and synthesizes information from multiple sources into structured research reports"
  version: "1.0.0"
  operator: "clawdia-labs"

capabilities:
  provides:
    - taxonomy: research.web.search
      description: "Search the web for information on a topic and return structured results"
      input_schema:
        type: object
        properties:
          query:
            type: string
            description: "Search query"
          max_results:
            type: integer
            description: "Maximum number of results to return"
            default: 10
          filters:
            type: object
            description: "Optional filters: date_range, domain_whitelist, language"
        required: ["query"]
      output_schema:
        type: object
        properties:
          results:
            type: array
            items:
              type: object
              properties:
                title: { type: string }
                url: { type: string }
                snippet: { type: string }
                relevance_score: { type: number }
          query_expansion:
            type: array
            items: { type: string }
          total_found: { type: integer }
      sla:
        max_latency_ms: 8000
        availability: 0.97
      pricing:
        model: per_request
        amount: 0.02
        currency: USDC

    - taxonomy: research.synthesis
      description: "Synthesize multiple sources into a structured research report with key findings and citations"
      input_schema:
        type: object
        properties:
          topic:
            type: string
            description: "Research topic"
          sources:
            type: array
            items: { type: string }
            description: "Source URLs or document texts to synthesize"
          output_format:
            type: string
            enum: ["summary", "report", "bullet_points", "executive_brief"]
            default: "report"
          max_length_words:
            type: integer
            default: 500
        required: ["topic", "sources"]
      output_schema:
        type: object
        properties:
          title: { type: string }
          summary: { type: string }
          key_findings:
            type: array
            items: { type: string }
          citations:
            type: array
            items:
              type: object
              properties:
                source: { type: string }
                claim: { type: string }
          confidence: { type: number }
          word_count: { type: integer }
      sla:
        max_latency_ms: 15000
        availability: 0.97
      pricing:
        model: per_request
        amount: 0.08
        currency: USDC

  requires:
    - taxonomy: data.feed.rss
      optional: true

runtime:
  model: "claude-sonnet-4-6"
  memory_mb: 512
  timeout_s: 60
  environment:
    - SEARCH_API_KEY

reputation:
  registry: "clawdia-testnet"
  minimum_stake: 5.0
