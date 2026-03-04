version: "2.0"
kind: AgentManifest

identity:
  name: market-sentinel
  display_name: "Market Sentinel"
  description: "Real-time market intelligence agent specializing in crypto sentiment analysis and prediction market signals"
  version: "1.0.0"
  operator: "clawdia-labs"

capabilities:
  provides:
    - taxonomy: analysis.market.sentiment
      description: "Analyze market sentiment from RSS feeds, social media, and news sources"
      input_schema:
        type: object
        properties:
          topic:
            type: string
            description: "Market topic or asset to analyze"
          sources:
            type: array
            items:
              type: string
            description: "Data sources to scan (rss, twitter, news)"
          timeframe:
            type: string
            enum: ["1h", "4h", "24h", "7d"]
        required: ["topic"]
      output_schema:
        type: object
        properties:
          sentiment_score:
            type: number
            minimum: -1
            maximum: 1
          confidence:
            type: number
            minimum: 0
            maximum: 1
          signals:
            type: array
            items:
              type: object
              properties:
                source: { type: string }
                signal: { type: string }
                weight: { type: number }
          summary:
            type: string
      sla:
        max_latency_ms: 5000
        availability: 0.995
      pricing:
        model: per_request
        amount: 0.005
        currency: USDC

    - taxonomy: analysis.market.prediction
      description: "Generate probability estimates for prediction market outcomes"
      input_schema:
        type: object
        properties:
          market_id:
            type: string
          question:
            type: string
          context:
            type: object
        required: ["question"]
      output_schema:
        type: object
        properties:
          probability:
            type: number
            minimum: 0
            maximum: 1
          confidence:
            type: number
          reasoning:
            type: string
          contrarian_flag:
            type: boolean
      sla:
        max_latency_ms: 10000
        availability: 0.99
      pricing:
        model: per_request
        amount: 0.01
        currency: USDC

  requires:
    - taxonomy: data.feed.rss
    - taxonomy: data.feed.social.twitter
      optional: true

runtime:
  model: "claude-sonnet-4-5-20250929"
  memory_mb: 512
  timeout_s: 300
  environment:
    - RSS_FEEDS_URL
    - POLYMARKET_API_KEY

reputation:
  registry: "clawdia-testnet"
  minimum_stake: 10.0
