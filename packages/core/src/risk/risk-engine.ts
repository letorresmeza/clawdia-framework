import type { ClawMessage, RiskAlertPayload, AgentIdentity } from "@clawdia/types";
import type { IClawBus } from "../bus/clawbus.js";

// ─────────────────────────────────────────────────────────
// Budget tracking
// ─────────────────────────────────────────────────────────

export interface AgentBudget {
  maxComputeMs: number;
  maxApiCalls: number;
  maxSpendUsd: number;
  usedComputeMs: number;
  usedApiCalls: number;
  usedSpendUsd: number;
}

export type ResourceType = "compute" | "api_calls" | "spend";

// ─────────────────────────────────────────────────────────
// Circuit breaker
// ─────────────────────────────────────────────────────────

export type BreakerState = "closed" | "open" | "half_open";

export interface CircuitBreaker {
  agentName: string;
  state: BreakerState;
  failures: number;
  lastFailure?: string;
  openedAt?: string;
}

// ─────────────────────────────────────────────────────────
// Risk Engine config
// ─────────────────────────────────────────────────────────

export interface RiskEngineConfig {
  /** Number of failures before circuit opens */
  failureThreshold: number;
  /** Time in ms before an open circuit transitions to half-open */
  resetTimeoutMs: number;
  /** Default budget for new agents */
  defaultBudget: Partial<AgentBudget>;
}

const DEFAULT_CONFIG: RiskEngineConfig = {
  failureThreshold: 3,
  resetTimeoutMs: 60_000,
  defaultBudget: {
    maxComputeMs: 300_000,
    maxApiCalls: 1_000,
    maxSpendUsd: 10,
  },
};

// ─────────────────────────────────────────────────────────
// Risk Engine
// ─────────────────────────────────────────────────────────

export class RiskEngine {
  private budgets = new Map<string, AgentBudget>();
  private breakers = new Map<string, CircuitBreaker>();
  private config: RiskEngineConfig;
  private subscriptionIds: string[] = [];

  constructor(
    private bus: IClawBus,
    config?: Partial<RiskEngineConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Start listening to bus events */
  start(): void {
    this.subscriptionIds.push(
      this.bus.subscribe("task.failed", this.onTaskFailed.bind(this)),
      this.bus.subscribe("task.result", this.onTaskResult.bind(this)),
      this.bus.subscribe("heartbeat", this.onHeartbeat.bind(this)),
    );
  }

  /** Stop listening */
  stop(): void {
    for (const id of this.subscriptionIds) {
      this.bus.unsubscribe(id);
    }
    this.subscriptionIds = [];
  }

  // ─── Budget Management ───

  /** Set resource budget for an agent */
  setBudget(agentName: string, budget: Partial<AgentBudget>): void {
    this.budgets.set(agentName, {
      maxComputeMs: budget.maxComputeMs ?? this.config.defaultBudget.maxComputeMs ?? 300_000,
      maxApiCalls: budget.maxApiCalls ?? this.config.defaultBudget.maxApiCalls ?? 1_000,
      maxSpendUsd: budget.maxSpendUsd ?? this.config.defaultBudget.maxSpendUsd ?? 10,
      usedComputeMs: 0,
      usedApiCalls: 0,
      usedSpendUsd: 0,
    });
  }

  /** Check if an agent can consume a resource */
  checkBudget(agentName: string, resource: ResourceType, amount: number): boolean {
    // Circuit breaker check first
    const breaker = this.breakers.get(agentName);
    if (breaker?.state === "open") {
      // Check if it's time to transition to half-open
      if (breaker.openedAt) {
        const elapsed = Date.now() - new Date(breaker.openedAt).getTime();
        if (elapsed >= this.config.resetTimeoutMs) {
          breaker.state = "half_open";
        } else {
          return false;
        }
      }
    }

    const budget = this.budgets.get(agentName);
    if (!budget) return true; // No budget = unlimited

    switch (resource) {
      case "compute":
        return budget.usedComputeMs + amount <= budget.maxComputeMs;
      case "api_calls":
        return budget.usedApiCalls + amount <= budget.maxApiCalls;
      case "spend":
        return budget.usedSpendUsd + amount <= budget.maxSpendUsd;
      default:
        return true;
    }
  }

  /** Record resource consumption */
  recordUsage(agentName: string, resource: ResourceType, amount: number): void {
    const budget = this.budgets.get(agentName);
    if (!budget) return;

    switch (resource) {
      case "compute":
        budget.usedComputeMs += amount;
        break;
      case "api_calls":
        budget.usedApiCalls += amount;
        break;
      case "spend":
        budget.usedSpendUsd += amount;
        break;
    }

    // Check if budget exceeded
    const exceeded =
      budget.usedComputeMs > budget.maxComputeMs ||
      budget.usedApiCalls > budget.maxApiCalls ||
      budget.usedSpendUsd > budget.maxSpendUsd;

    if (exceeded) {
      this.bus.publish(
        "risk.budget.exceeded",
        {
          type: "budget_exceeded" as const,
          agent: agentName,
          details: {
            compute: `${budget.usedComputeMs}/${budget.maxComputeMs}ms`,
            apiCalls: `${budget.usedApiCalls}/${budget.maxApiCalls}`,
            spend: `$${budget.usedSpendUsd}/$${budget.maxSpendUsd}`,
          },
        } satisfies RiskAlertPayload,
        { name: "risk-engine" } as AgentIdentity,
      );
    }
  }

  /** Get current budget status for an agent */
  getBudget(agentName: string): AgentBudget | undefined {
    return this.budgets.get(agentName);
  }

  // ─── Circuit Breaker ───

  /** Get circuit breaker state for an agent */
  getBreaker(agentName: string): CircuitBreaker | undefined {
    return this.breakers.get(agentName);
  }

  /** Manually reset a circuit breaker */
  resetBreaker(agentName: string): void {
    const breaker = this.breakers.get(agentName);
    if (breaker) {
      breaker.state = "closed";
      breaker.failures = 0;
      breaker.openedAt = undefined;
    }
  }

  // ─── Event Handlers ───

  private async onTaskFailed(msg: ClawMessage): Promise<void> {
    const agentName = msg.sender.name;
    const breaker = this.breakers.get(agentName) ?? {
      agentName,
      state: "closed" as BreakerState,
      failures: 0,
    };

    breaker.failures++;
    breaker.lastFailure = msg.timestamp;

    if (breaker.failures >= this.config.failureThreshold && breaker.state !== "open") {
      breaker.state = "open";
      breaker.openedAt = new Date().toISOString();

      await this.bus.publish(
        "risk.alert",
        {
          type: "circuit_breaker_open",
          agent: agentName,
          details: {
            failures: breaker.failures,
            threshold: this.config.failureThreshold,
          },
        } satisfies RiskAlertPayload,
        msg.sender,
      );
    }

    this.breakers.set(agentName, breaker);
  }

  private async onTaskResult(msg: ClawMessage): Promise<void> {
    const agentName = msg.sender.name;
    const breaker = this.breakers.get(agentName);

    // Successful task in half-open state → close the breaker
    if (breaker?.state === "half_open") {
      breaker.state = "closed";
      breaker.failures = 0;
      breaker.openedAt = undefined;
    }
  }

  private async onHeartbeat(msg: ClawMessage): Promise<void> {
    // Heartbeat in half-open state → close the breaker
    const breaker = this.breakers.get(msg.sender.name);
    if (breaker?.state === "half_open") {
      breaker.state = "closed";
      breaker.failures = 0;
      breaker.openedAt = undefined;
    }
  }
}
