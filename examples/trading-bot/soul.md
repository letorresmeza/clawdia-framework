version: "2.0"
kind: AgentManifest

identity:
  name: clawdia-trading-bot
  display_name: "Clawdia — Autonomous Trading Agent"
  description: "Autonomous prediction market trading agent. Scans Polymarket via Simmer Markets API, scores opportunities with a composite 5-factor model, executes trades within strict guardrails, monitors positions with SL/TP enforcement, and reports portfolio health. Mission: accumulate 1 BTC from $60 USDC."
  version: "3.0.0"
  operator: "leo"

capabilities:
  provides:
    - taxonomy: trading.polymarket.scan
      description: "Scan prediction markets, compute composite scores (probability edge, volume momentum, news sentiment, liquidity depth, time value), and return ranked opportunities above the 65/100 threshold. Does not execute trades."
      input_schema:
        type: object
        properties:
          limit:
            type: integer
            description: "Max markets to fetch from Simmer API"
            default: 50
          min_score:
            type: number
            description: "Minimum composite score (0-100). Default: 65"
            default: 65
          news_signals:
            type: object
            description: "Optional pre-fetched news sentiment map {market_id: score}"
        required: []
      output_schema:
        type: object
        properties:
          markets_scanned:
            type: integer
          markets_qualified:
            type: integer
          candidates:
            type: array
            items:
              type: object
              properties:
                market_id: { type: string }
                question: { type: string }
                probability: { type: number }
                side: { type: string, enum: ["yes", "no"] }
                composite_score: { type: number }
                scores:
                  type: object
                  properties:
                    probability_edge: { type: number }
                    volume_momentum: { type: number }
                    news_sentiment: { type: number }
                    liquidity_depth: { type: number }
                    time_value: { type: number }
          circuit_breaker_active: { type: boolean }
          timestamp: { type: string }
      sla:
        max_latency_ms: 30000
        availability: 0.99
      pricing:
        model: per_request
        amount: 0.001
        currency: USDC

    - taxonomy: trading.polymarket.execute
      description: "Run full scan-score-validate-execute cycle. Enters positions that pass composite scoring (>=65) and all guardrail checks (balance, position count, daily limits, circuit breaker). Position sizing: 10% of equity, min $2, max $15. Stop-loss at -15%, take-profit at +6%."
      input_schema:
        type: object
        properties:
          limit:
            type: integer
            description: "Max markets to scan"
            default: 50
          news_signals:
            type: object
            description: "Pre-fetched news sentiment signals"
        required: []
      output_schema:
        type: object
        properties:
          entries_made:
            type: integer
          skipped:
            type: integer
          positions_open:
            type: integer
          balance_after:
            type: number
          trades:
            type: array
            items:
              type: object
              properties:
                market_id: { type: string }
                question: { type: string }
                side: { type: string }
                size_usd: { type: number }
                entry_price: { type: number }
                composite_score: { type: number }
                action: { type: string, enum: ["ENTRY", "SKIP", "ERROR"] }
          circuit_breaker_active: { type: boolean }
          timestamp: { type: string }
      sla:
        max_latency_ms: 60000
        availability: 0.999
      pricing:
        model: per_request
        amount: 0.005
        currency: USDC

    - taxonomy: trading.monitoring.positions
      description: "Check all open positions against stop-loss (-15%), take-profit (+6%), and max-hold-time (168h) rules. Execute exits where triggered. Updates state and reports outcomes."
      input_schema:
        type: object
        properties: {}
        required: []
      output_schema:
        type: object
        properties:
          positions_checked:
            type: integer
          exits_executed:
            type: integer
          exits:
            type: array
            items:
              type: object
              properties:
                market_id: { type: string }
                reason: { type: string, enum: ["STOP_LOSS", "TAKE_PROFIT", "MAX_HOLD_TIME"] }
                pnl_pct: { type: number }
                pnl_usd: { type: number }
          positions_open:
            type: integer
          daily_pnl: { type: number }
          consecutive_losses: { type: integer }
          circuit_breaker_active: { type: boolean }
          timestamp: { type: string }
      sla:
        max_latency_ms: 15000
        availability: 0.999
      pricing:
        model: per_request
        amount: 0.001
        currency: USDC

    - taxonomy: trading.monitoring.portfolio
      description: "Full portfolio health check: current balance, open positions, daily P&L, lifetime P&L, win/loss record, circuit breaker status. Triggers daily summary if new day detected."
      input_schema:
        type: object
        properties: {}
        required: []
      output_schema:
        type: object
        properties:
          balance_usdc: { type: number }
          daily_pnl: { type: number }
          daily_start_balance: { type: number }
          daily_trade_count: { type: integer }
          positions_open: { type: integer }
          positions:
            type: object
            description: "Map of market_id to position details"
          total_trades: { type: integer }
          total_wins: { type: integer }
          total_losses: { type: integer }
          win_rate: { type: number }
          lifetime_pnl: { type: number }
          consecutive_losses: { type: integer }
          circuit_breaker_active: { type: boolean }
          circuit_breaker_until: { type: number }
          daily_loss_pct: { type: number }
          phase:
            type: string
            description: "Compound Edge Protocol phase (1-4 based on balance)"
            enum: ["phase1", "phase2", "phase3", "phase4"]
          timestamp: { type: string }
      sla:
        max_latency_ms: 10000
        availability: 0.99
      pricing:
        model: per_request
        amount: 0.001
        currency: USDC

    - taxonomy: analysis.market.sentiment
      description: "Fetch and score crypto news sentiment from CryptoPanic and NewsAPI. Returns per-keyword sentiment scores (0-100, 50=neutral) and fact-vs-rumor classification. Used to feed the news_sentiment factor into composite scoring."
      input_schema:
        type: object
        properties:
          keywords:
            type: array
            items: { type: string }
            description: "Keywords to score sentiment for (e.g. ['bitcoin', 'ethereum'])"
          query:
            type: string
            description: "General news query for NewsAPI"
        required: []
      output_schema:
        type: object
        properties:
          crypto_sentiment:
            type: object
            description: "Map of keyword to sentiment score 0-100"
          news_sentiment:
            type: number
            description: "General news sentiment 0-100"
          sources_available:
            type: object
            properties:
              cryptopanic: { type: boolean }
              newsapi: { type: boolean }
          timestamp: { type: string }
      sla:
        max_latency_ms: 15000
        availability: 0.95
      pricing:
        model: per_request
        amount: 0.002
        currency: USDC

    - taxonomy: analysis.market.weather
      description: "Scan Polymarket for weather prediction markets, cross-reference with NOAA forecast data to identify pricing discrepancies. Returns weather markets ranked by composite score with NOAA alignment signal."
      input_schema:
        type: object
        properties:
          limit:
            type: integer
            default: 50
            description: "Max markets to fetch"
          weather_keywords:
            type: array
            items: { type: string }
            description: "Weather terms to filter markets (default: temperature, rain, storm, hurricane, snow)"
        required: []
      output_schema:
        type: object
        properties:
          markets_scanned: { type: integer }
          weather_markets_found: { type: integer }
          candidates:
            type: array
            items:
              type: object
              properties:
                market_id: { type: string }
                question: { type: string }
                probability: { type: number }
                composite_score: { type: number }
                weather_keyword_matched: { type: string }
          timestamp: { type: string }
      sla:
        max_latency_ms: 30000
        availability: 0.95
      pricing:
        model: per_request
        amount: 0.002
        currency: USDC

  requires:
    - taxonomy: data.feed.news.cryptopanic
      optional: true
    - taxonomy: data.feed.news.newsapi
      optional: true
    - taxonomy: data.feed.weather.noaa
      optional: true

runtime:
  image: "python:3.11-slim"
  memory_mb: 256
  cpus: 1
  timeout_s: 120
  environment:
    - SIMMER_API_KEY
    - TELEGRAM_BOT_TOKEN
    - TELEGRAM_CHAT_ID
    - CRYPTOPANIC_KEY
    - NEWSAPI_KEY
    - STATE_DIR
    - LOG_DIR
    - CLAWDIA_V3_DIR

reputation:
  registry: "clawdia-mainnet"
  minimum_stake: 5.0
