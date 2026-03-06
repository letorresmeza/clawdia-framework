import { spawn, ChildProcess } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type {
  IAgentAdapter,
  AgentConfig,
  TaskPayload,
  TaskResult,
  TaskChunk,
  AgentStatus,
  PluginModule,
} from "@clawdia/types";
import type { IClawBus } from "@clawdia/core";

// ─────────────────────────────────────────────────────────
// Types mirroring risk.json and trader-state.json
// ─────────────────────────────────────────────────────────

interface RiskConfig {
  position_sizing: {
    max_position_pct: number;
    min_position_usd: number;
    max_position_usd: number;
  };
  limits: {
    max_concurrent_positions: number;
    daily_loss_limit_pct: number;
    min_balance_usd: number;
    max_daily_trades: number;
  };
  circuit_breaker: {
    consecutive_losses_trigger: number;
    cooldown_seconds: number;
    escalation: Record<string, number>;
  };
  exit_rules: {
    stop_loss_pct: number;
    take_profit_pct: number;
    max_hold_hours: number;
    check_interval_seconds: number;
  };
  market_filters: {
    min_volume_usd: number;
    min_liquidity_usd: number;
    min_time_to_resolution_hours: number;
    max_time_to_resolution_hours: number;
  };
  scoring: {
    min_composite_score: number;
    weights: Record<string, number>;
  };
  alerts: {
    quiet_hours_utc: number[];
    on_trade_entry: boolean;
    on_trade_exit: boolean;
  };
}

interface TradingState {
  positions: Record<string, unknown>;
  consecutive_losses: number;
  circuit_breaker_until: number;
  daily_pnl: number;
  daily_start_balance: number;
  daily_reset_date: string;
  daily_trade_count: number;
  total_trades: number;
  total_wins: number;
  total_losses: number;
  lifetime_pnl: number;
}

// ─────────────────────────────────────────────────────────
// Python inline script builders
// Each produces a self-contained script that loads the
// existing auto-trade.py or guardrails.py via importlib
// (no modifications to the original Python files).
// ─────────────────────────────────────────────────────────

function buildLoadModule(filePath: string): string {
  return `
import importlib.util, sys, os
spec = importlib.util.spec_from_file_location('_module', '${filePath}')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
`.trim();
}

function buildScanScript(scriptsDir: string): string {
  const autoTradePath = join(scriptsDir, "auto-trade.py");
  return `
import json
${buildLoadModule(autoTradePath)}
markets = mod.get_markets(50)
scored = []
for m in markets:
    scores = mod.score_market(m)
    m['_scores'] = scores
    if scores['composite'] >= mod.RISK['scoring']['min_composite_score']:
        scored.append({
            'market_id': m.get('id',''),
            'question': m.get('question','')[:80],
            'probability': m.get('current_probability', 0.5),
            'side': 'yes' if m.get('current_probability', 0.5) > 0.5 else 'no',
            'composite_score': scores['composite'],
            'scores': scores,
        })
scored.sort(key=lambda x: x['composite_score'], reverse=True)
state = mod.load_state()
cb_active = mod.time.time() < state.get('circuit_breaker_until', 0)
print(json.dumps({
    'markets_scanned': len(markets),
    'markets_qualified': len(scored),
    'candidates': scored,
    'circuit_breaker_active': cb_active,
    'timestamp': mod.datetime.now(mod.timezone.utc).isoformat(),
}))
`.trim();
}

function buildExecuteScript(scriptsDir: string): string {
  const autoTradePath = join(scriptsDir, "auto-trade.py");
  return `
import json
${buildLoadModule(autoTradePath)}
state = mod.load_state()
state = mod.reconcile_state(state)
state = mod.check_daily_reset(state)
entries_before = state.get('total_trades', 0)
state = mod.scan_and_trade(state)
entries_made = state.get('total_trades', 0) - entries_before
balance = 0.0
try:
    balance = mod.get_balance()
except Exception:
    pass
cb_active = mod.time.time() < state.get('circuit_breaker_until', 0)
print(json.dumps({
    'entries_made': entries_made,
    'positions_open': len(state.get('positions', {})),
    'balance_after': balance,
    'circuit_breaker_active': cb_active,
    'timestamp': mod.datetime.now(mod.timezone.utc).isoformat(),
}))
`.trim();
}

function buildMonitorScript(scriptsDir: string): string {
  const autoTradePath = join(scriptsDir, "auto-trade.py");
  return `
import json
${buildLoadModule(autoTradePath)}
state = mod.load_state()
positions_before = set(state.get('positions', {}).keys())
state = mod.monitor_positions(state)
positions_after = set(state.get('positions', {}).keys())
closed = positions_before - positions_after
cb_active = mod.time.time() < state.get('circuit_breaker_until', 0)
print(json.dumps({
    'positions_checked': len(positions_before),
    'exits_executed': len(closed),
    'positions_open': len(positions_after),
    'daily_pnl': state.get('daily_pnl', 0),
    'consecutive_losses': state.get('consecutive_losses', 0),
    'circuit_breaker_active': cb_active,
    'timestamp': mod.datetime.now(mod.timezone.utc).isoformat(),
}))
`.trim();
}

function buildPortfolioScript(scriptsDir: string): string {
  const autoTradePath = join(scriptsDir, "auto-trade.py");
  return `
import json
${buildLoadModule(autoTradePath)}
state = mod.load_state()
state = mod.check_daily_reset(state)
balance = 0.0
try:
    balance = mod.get_balance()
except Exception:
    pass
total_trades = state.get('total_trades', 0)
total_wins = state.get('total_wins', 0)
win_rate = total_wins / max(total_trades, 1)
daily_pnl = state.get('daily_pnl', 0)
start_bal = state.get('daily_start_balance', 0)
daily_loss_pct = 0.0
if start_bal > 0:
    daily_loss_pct = (daily_pnl / start_bal) * 100
if balance >= 5000:
    phase = 'phase4'
elif balance >= 1000:
    phase = 'phase3'
elif balance >= 200:
    phase = 'phase2'
else:
    phase = 'phase1'
cb_active = mod.time.time() < state.get('circuit_breaker_until', 0)
print(json.dumps({
    'balance_usdc': balance,
    'daily_pnl': daily_pnl,
    'daily_start_balance': start_bal,
    'daily_trade_count': state.get('daily_trade_count', 0),
    'positions_open': len(state.get('positions', {})),
    'positions': state.get('positions', {}),
    'total_trades': total_trades,
    'total_wins': total_wins,
    'total_losses': state.get('total_losses', 0),
    'win_rate': round(win_rate, 3),
    'lifetime_pnl': state.get('lifetime_pnl', 0),
    'consecutive_losses': state.get('consecutive_losses', 0),
    'circuit_breaker_active': cb_active,
    'circuit_breaker_until': state.get('circuit_breaker_until', 0),
    'daily_loss_pct': round(daily_loss_pct, 2),
    'phase': phase,
    'timestamp': mod.datetime.now(mod.timezone.utc).isoformat(),
}))
`.trim();
}

function buildSentimentScript(
  scriptsDir: string,
  keywords: string[],
  query: string,
): string {
  const guardrailsPath = join(scriptsDir, "guardrails.py");
  const kw = JSON.stringify(keywords);
  const q = JSON.stringify(query);
  return `
import json
${buildLoadModule(guardrailsPath)}
crypto = mod.get_crypto_sentiment(${kw})
news = mod.get_news_sentiment(${q})
cryptopanic_ok = bool(os.environ.get('CRYPTOPANIC_KEY',''))
newsapi_ok = bool(os.environ.get('NEWSAPI_KEY',''))
from datetime import datetime, timezone
print(json.dumps({
    'crypto_sentiment': crypto,
    'news_sentiment': news,
    'sources_available': {'cryptopanic': cryptopanic_ok, 'newsapi': newsapi_ok},
    'timestamp': datetime.now(timezone.utc).isoformat(),
}))
`.trim();
}

function buildWeatherScanScript(
  scriptsDir: string,
  weatherKeywords: string[],
): string {
  const autoTradePath = join(scriptsDir, "auto-trade.py");
  const kw = JSON.stringify(weatherKeywords);
  return `
import json
${buildLoadModule(autoTradePath)}
WEATHER_KEYWORDS = ${kw}
markets = mod.get_markets(50)
weather_candidates = []
for m in markets:
    q = m.get('question','').lower()
    matched = next((k for k in WEATHER_KEYWORDS if k in q), None)
    if matched:
        scores = mod.score_market(m)
        weather_candidates.append({
            'market_id': m.get('id',''),
            'question': m.get('question','')[:80],
            'probability': m.get('current_probability', 0.5),
            'composite_score': scores['composite'],
            'weather_keyword_matched': matched,
        })
weather_candidates.sort(key=lambda x: x['composite_score'], reverse=True)
print(json.dumps({
    'markets_scanned': len(markets),
    'weather_markets_found': len(weather_candidates),
    'candidates': weather_candidates,
    'timestamp': mod.datetime.now(mod.timezone.utc).isoformat(),
}))
`.trim();
}

// ─────────────────────────────────────────────────────────
// Python subprocess runner
// ─────────────────────────────────────────────────────────

async function runPythonInline(
  code: string,
  env: Record<string, string>,
  timeoutMs = 30000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", ["-c", code], {
      env: { ...process.env, ...env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`Python subprocess timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on("close", (exitCode) => {
      clearTimeout(timer);
      if (exitCode === 0) {
        resolve(stdout.trim());
      } else {
        reject(
          new Error(
            `Python subprocess exited ${exitCode}: ${stderr.slice(0, 500)}`,
          ),
        );
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn python3: ${err.message}`));
    });
  });
}

// ─────────────────────────────────────────────────────────
// Alert parser — intercept Python log output and republish
// on ClawBus as escalation events
// ─────────────────────────────────────────────────────────

const ALERT_PATTERNS = [
  { pattern: /CIRCUIT_BREAKER/i, severity: "critical" as const },
  { pattern: /AUTH FAILURE/i, severity: "critical" as const },
  { pattern: /\[ALERT/i, severity: "warning" as const },
];

function parseAlerts(
  output: string,
): Array<{ message: string; severity: "info" | "warning" | "critical" }> {
  const alerts: Array<{
    message: string;
    severity: "info" | "warning" | "critical";
  }> = [];
  for (const line of output.split("\n")) {
    for (const { pattern, severity } of ALERT_PATTERNS) {
      if (pattern.test(line)) {
        alerts.push({ message: line.trim(), severity });
        break;
      }
    }
  }
  return alerts;
}

// ─────────────────────────────────────────────────────────
// Trading Bot Adapter
// ─────────────────────────────────────────────────────────

class TradingBotAdapter implements IAgentAdapter {
  readonly name = "agent-trading";

  private config: AgentConfig | null = null;
  private riskConfig: RiskConfig | null = null;
  private botDir = "";
  private scriptsDir = "";
  private configDir = "";
  private stateFile = "";
  private startTime = 0;
  private tasksCompleted = 0;
  private currentTask: string | undefined;
  private daemonProcess: ChildProcess | null = null;
  private bus?: IClawBus;
  private daemonLogs: string[] = [];

  /** Optional ClawBus for publishing alerts */
  setBus(bus: IClawBus): void {
    this.bus = bus;
  }

  async initialize(config: AgentConfig): Promise<void> {
    this.config = config;
    this.startTime = Date.now();

    // Resolve the v3 bot directory from env or a convention default
    this.botDir =
      config.env?.["CLAWDIA_V3_DIR"] ?? "/root/clawdia-v3";
    this.scriptsDir = join(this.botDir, "scripts");
    this.configDir = join(this.botDir, "config");

    const riskPath = join(this.configDir, "risk.json");
    if (!existsSync(riskPath)) {
      throw new Error(
        `risk.json not found at ${riskPath}. Set CLAWDIA_V3_DIR env var.`,
      );
    }

    this.riskConfig = JSON.parse(
      readFileSync(riskPath, "utf8"),
    ) as RiskConfig;

    // Resolve state file path
    const stateDir =
      config.env?.["STATE_DIR"] ??
      `${process.env["HOME"] ?? "/root"}/.openclaw/workspace/state`;
    this.stateFile = join(stateDir, "trader-state.json");

    // Start the auto-trade.py daemon in the background
    await this.startDaemon();
  }

  /** Spawn auto-trade.py as a background daemon, capturing its output. */
  private async startDaemon(): Promise<void> {
    if (this.daemonProcess) return;

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...(this.config?.env ?? {}),
    };

    this.daemonProcess = spawn(
      "python3",
      [join(this.scriptsDir, "auto-trade.py")],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );

    this.daemonProcess.stdout?.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n");
      for (const line of lines) {
        if (line.trim()) {
          this.daemonLogs.push(line);
          // Keep rolling window of 1000 lines
          if (this.daemonLogs.length > 1000) {
            this.daemonLogs.shift();
          }
          // Parse and forward alerts to ClawBus
          const alerts = parseAlerts(line);
          for (const alert of alerts) {
            this.publishAlert(alert.message, alert.severity);
          }
        }
      }
    });

    this.daemonProcess.stderr?.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n");
      for (const line of lines) {
        if (line.trim()) this.daemonLogs.push(`[ERR] ${line}`);
      }
    });

    this.daemonProcess.on("exit", (code) => {
      this.daemonLogs.push(`[daemon] exited with code ${code}`);
      this.daemonProcess = null;
    });
  }

  private publishAlert(
    message: string,
    severity: "info" | "warning" | "critical",
  ): void {
    if (!this.bus || !this.config) return;
    // Fire-and-forget — bus failures must not block trading
    this.bus
      .publish(
        "escalation",
        {
          sessionId: this.name,
          reason: message,
          severity,
          context: { source: "clawdia-trading-bot", agent: this.name },
        },
        this.config.identity,
      )
      .catch(() => {
        /* non-fatal */
      });
  }

  /** Route a task to the appropriate Python subprocess. */
  async execute(task: TaskPayload): Promise<TaskResult> {
    const started = Date.now();
    this.currentTask = task.contractId;
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...(this.config?.env ?? {}),
    };

    let output: unknown;
    const logs: string[] = [];

    try {
      const input = task.input as Record<string, unknown> | null ?? {};

      switch (task.capability) {
        case "trading.polymarket.scan": {
          const raw = await runPythonInline(
            buildScanScript(this.scriptsDir),
            env,
            30000,
          );
          output = JSON.parse(raw);
          break;
        }

        case "trading.polymarket.execute": {
          const raw = await runPythonInline(
            buildExecuteScript(this.scriptsDir),
            env,
            90000,
          );
          output = JSON.parse(raw);
          break;
        }

        case "trading.monitoring.positions": {
          const raw = await runPythonInline(
            buildMonitorScript(this.scriptsDir),
            env,
            30000,
          );
          output = JSON.parse(raw);
          // If circuit breaker just triggered, publish risk alert
          const result = output as Record<string, unknown>;
          if (result["circuit_breaker_active"]) {
            this.publishAlert(
              `Circuit breaker active after ${result["consecutive_losses"]} consecutive losses`,
              "critical",
            );
          }
          break;
        }

        case "trading.monitoring.portfolio": {
          const raw = await runPythonInline(
            buildPortfolioScript(this.scriptsDir),
            env,
            15000,
          );
          output = JSON.parse(raw);
          break;
        }

        case "analysis.market.sentiment": {
          const keywords = (input["keywords"] as string[]) ?? [
            "bitcoin",
            "ethereum",
            "crypto",
          ];
          const query = (input["query"] as string) ?? "crypto prediction markets";
          const raw = await runPythonInline(
            buildSentimentScript(this.scriptsDir, keywords, query),
            env,
            20000,
          );
          output = JSON.parse(raw);
          break;
        }

        case "analysis.market.weather": {
          const weatherKeywords = (input["weather_keywords"] as string[]) ?? [
            "temperature",
            "rain",
            "storm",
            "hurricane",
            "snow",
            "flood",
            "drought",
            "heat",
          ];
          const raw = await runPythonInline(
            buildWeatherScanScript(this.scriptsDir, weatherKeywords),
            env,
            30000,
          );
          output = JSON.parse(raw);
          break;
        }

        default:
          throw new Error(
            `Unknown capability: ${task.capability}. ` +
              `Supported: trading.polymarket.scan, trading.polymarket.execute, ` +
              `trading.monitoring.positions, trading.monitoring.portfolio, ` +
              `analysis.market.sentiment, analysis.market.weather`,
          );
      }

      this.tasksCompleted++;
    } finally {
      this.currentTask = undefined;
    }

    const durationMs = Date.now() - started;
    return {
      output,
      metrics: { durationMs },
      logs,
    };
  }

  /** Stream Python subprocess output as chunks for long-running tasks. */
  async *stream(task: TaskPayload): AsyncIterable<TaskChunk> {
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...(this.config?.env ?? {}),
    };

    let code: string;
    switch (task.capability) {
      case "trading.polymarket.scan":
        code = buildScanScript(this.scriptsDir);
        break;
      case "trading.polymarket.execute":
        code = buildExecuteScript(this.scriptsDir);
        break;
      case "trading.monitoring.positions":
        code = buildMonitorScript(this.scriptsDir);
        break;
      default:
        yield {
          type: "error",
          content: `Streaming not supported for ${task.capability}`,
          timestamp: new Date().toISOString(),
        };
        return;
    }

    const proc = spawn("python3", ["-c", code], {
      env: { ...process.env, ...env },
    });

    for await (const chunk of proc.stdout ?? []) {
      yield {
        type: "text",
        content: (chunk as Buffer).toString(),
        timestamp: new Date().toISOString(),
      };
    }

    for await (const chunk of proc.stderr ?? []) {
      yield {
        type: "error",
        content: (chunk as Buffer).toString(),
        timestamp: new Date().toISOString(),
      };
    }
  }

  report(): AgentStatus {
    return {
      state: this.daemonProcess ? "working" : "idle",
      currentTask: this.currentTask,
      uptime: Date.now() - this.startTime,
      tasksCompleted: this.tasksCompleted,
    };
  }

  async terminate(reason?: string): Promise<void> {
    if (this.daemonProcess) {
      // Give the daemon a chance to finish its current cycle
      this.daemonProcess.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          this.daemonProcess?.kill("SIGKILL");
          resolve();
        }, 5000);
        this.daemonProcess!.once("exit", () => {
          clearTimeout(t);
          resolve();
        });
      });
      this.daemonProcess = null;
    }

    const reasonMsg = reason ? ` Reason: ${reason}` : "";
    console.info(
      `[agent-trading] Terminated.${reasonMsg} Tasks completed: ${this.tasksCompleted}`,
    );
  }
}

// ─────────────────────────────────────────────────────────
// Plugin Module export
// ─────────────────────────────────────────────────────────

export default {
  name: "agent-trading",
  type: "agent",
  version: "3.0.0",
  create: () => new TradingBotAdapter(),
} satisfies PluginModule<TradingBotAdapter>;

export type { TradingBotAdapter };
