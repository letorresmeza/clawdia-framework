/**
 * StateManager — persists framework state to /var/lib/clawdia/state.json
 *
 * Provides crash recovery by saving/loading: registry entries, contract stats,
 * reputation data, scheduler last-run timestamps, and P&L totals.
 * Auto-saves every 60 seconds and on graceful shutdown.
 * Optionally imports legacy trading positions from clawdia-v3 trader-state.json.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const STATE_DIR = "/var/lib/clawdia";
const STATE_FILE = path.join(STATE_DIR, "state.json");
const OLD_TRADER_STATE_PATHS = [
  "/root/clawdia-v3/data/trader-state.json",
  "/root/clawdia-v3/state/trader-state.json",
];

export interface PnlStats {
  totalBrokeredUsdc: number;
  marginEarnedUsdc: number;
  contractsSettled: number;
  contractsFailed: number;
  weeklyBrokeredUsdc: number;
  weeklyMarginEarnedUsdc: number;
  weekStartedAt: string;
}

export interface SchedulerStats {
  lastRuns: Record<string, string>;
  successCounts: Record<string, number>;
  errorCounts: Record<string, number>;
}

export interface ClawdiaState {
  version: string;
  savedAt: string;
  daemonStartedAt: string;
  registry: {
    agentCount: number;
    agents: Array<{ name: string; status: string; registeredAt: string }>;
  };
  contracts: {
    total: number;
    byState: Record<string, number>;
  };
  scheduler: SchedulerStats;
  pnl: PnlStats;
  trading?: {
    positions?: unknown;
    balance?: number;
    importedFrom?: string;
    importedAt?: string;
  };
}

const DEFAULT_STATE: ClawdiaState = {
  version: "1.0",
  savedAt: new Date().toISOString(),
  daemonStartedAt: new Date().toISOString(),
  registry: { agentCount: 0, agents: [] },
  contracts: { total: 0, byState: {} },
  scheduler: { lastRuns: {}, successCounts: {}, errorCounts: {} },
  pnl: {
    totalBrokeredUsdc: 0,
    marginEarnedUsdc: 0,
    contractsSettled: 0,
    contractsFailed: 0,
    weeklyBrokeredUsdc: 0,
    weeklyMarginEarnedUsdc: 0,
    weekStartedAt: new Date().toISOString(),
  },
};

export class StateManager {
  private state: ClawdiaState;
  private saveTimer?: NodeJS.Timeout;

  constructor() {
    this.state = structuredClone(DEFAULT_STATE);
    this.state.daemonStartedAt = new Date().toISOString();
  }

  /** Load persisted state from disk. Call once on daemon boot. */
  load(): void {
    ensureDir(STATE_DIR);

    if (fs.existsSync(STATE_FILE)) {
      try {
        const raw = fs.readFileSync(STATE_FILE, "utf-8");
        const loaded = JSON.parse(raw) as Partial<ClawdiaState>;
        // Merge loaded state preserving defaults for missing fields
        this.state = {
          ...structuredClone(DEFAULT_STATE),
          ...loaded,
          daemonStartedAt: new Date().toISOString(),
          pnl: { ...DEFAULT_STATE.pnl, ...(loaded.pnl ?? {}) },
          scheduler: { ...DEFAULT_STATE.scheduler, ...(loaded.scheduler ?? {}) },
        };
        console.log(`[state] Loaded from ${STATE_FILE} (saved ${loaded.savedAt ?? "unknown"})`);
      } catch (err) {
        console.error("[state] Failed to parse state file, starting fresh:", err);
        this.state = structuredClone(DEFAULT_STATE);
        this.state.daemonStartedAt = new Date().toISOString();
      }
    }

    this.importLegacyTraderState();
  }

  /** Save current state to disk. */
  save(): void {
    ensureDir(STATE_DIR);
    this.state.savedAt = new Date().toISOString();
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2), "utf-8");
    } catch (err) {
      console.error("[state] Save failed:", err);
    }
  }

  /** Start periodic auto-save. */
  startAutoSave(intervalMs = 60_000): void {
    this.saveTimer = setInterval(() => this.save(), intervalMs);
    this.saveTimer.unref(); // don't prevent process exit
  }

  /** Stop auto-save and perform final save. */
  destroy(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = undefined;
    }
    this.save();
  }

  get(): Readonly<ClawdiaState> {
    return this.state;
  }

  // ─── Mutators ───

  updateRegistryStats(agents: Array<{ name: string; status: string; registeredAt: string }>): void {
    this.state.registry = { agentCount: agents.length, agents };
  }

  updateContractStats(total: number, byState: Record<string, number>): void {
    this.state.contracts = { total, byState };
  }

  recordSchedulerRun(jobName: string, success: boolean): void {
    this.state.scheduler.lastRuns[jobName] = new Date().toISOString();
    if (success) {
      this.state.scheduler.successCounts[jobName] =
        (this.state.scheduler.successCounts[jobName] ?? 0) + 1;
    } else {
      this.state.scheduler.errorCounts[jobName] =
        (this.state.scheduler.errorCounts[jobName] ?? 0) + 1;
    }
  }

  addPnl(delta: {
    brokeredUsdc?: number;
    marginUsdc?: number;
    settled?: number;
    failed?: number;
  }): void {
    if (delta.brokeredUsdc) {
      this.state.pnl.totalBrokeredUsdc += delta.brokeredUsdc;
      this.state.pnl.weeklyBrokeredUsdc += delta.brokeredUsdc;
    }
    if (delta.marginUsdc) {
      this.state.pnl.marginEarnedUsdc += delta.marginUsdc;
      this.state.pnl.weeklyMarginEarnedUsdc += delta.marginUsdc;
    }
    if (delta.settled) this.state.pnl.contractsSettled += delta.settled;
    if (delta.failed) this.state.pnl.contractsFailed += delta.failed;
  }

  resetWeeklyPnl(): void {
    this.state.pnl.weeklyBrokeredUsdc = 0;
    this.state.pnl.weeklyMarginEarnedUsdc = 0;
    this.state.pnl.weekStartedAt = new Date().toISOString();
  }

  // ─── Private ───

  private importLegacyTraderState(): void {
    if (this.state.trading?.importedAt) return; // already imported

    for (const statePath of OLD_TRADER_STATE_PATHS) {
      if (!fs.existsSync(statePath)) continue;
      try {
        const raw = fs.readFileSync(statePath, "utf-8");
        const traderState = JSON.parse(raw) as Record<string, unknown>;
        this.state.trading = {
          positions: traderState["positions"],
          balance: typeof traderState["balance"] === "number" ? traderState["balance"] : undefined,
          importedFrom: statePath,
          importedAt: new Date().toISOString(),
        };
        console.log(`[state] Imported legacy trader state from ${statePath}`);
        break;
      } catch {
        // Not found or invalid — skip
      }
    }
  }
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
