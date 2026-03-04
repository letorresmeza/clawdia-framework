import type { AgentIdentity } from "./identity.js";

// ─────────────────────────────────────────────────────────
// ClawBus Message Protocol
// ─────────────────────────────────────────────────────────

/** All available message channels */
export type ClawChannel =
  | "task.request"
  | "task.result"
  | "task.failed"
  | "task.progress"
  | "heartbeat"
  | "escalation"
  | "settlement.request"
  | "settlement.complete"
  | "registry.update"
  | "registry.query"
  | "risk.alert"
  | "risk.budget.exceeded"
  | "workflow.step.complete"
  | "workflow.complete";

/** Universal message envelope — all bus messages use this shape */
export interface ClawMessage<T = unknown> {
  /** UUID v7 (time-sortable) */
  id: string;
  /** Message channel */
  channel: ClawChannel;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Sender identity */
  sender: AgentIdentity;
  /** Target agent name (null = broadcast) */
  recipient?: string;
  /** Links related messages in a workflow */
  correlationId: string;
  /** Typed payload */
  payload: T;
  /** Ed25519 signature of JSON.stringify(payload) */
  signature: string;
  /** Time-to-live in seconds (optional) */
  ttl?: number;
  /** Metadata for tracing/debugging */
  metadata?: Record<string, string>;
}

// ─────────────────────────────────────────────────────────
// Channel-specific payloads
// ─────────────────────────────────────────────────────────

export interface TaskRequestPayload {
  contractId: string;
  capability: string;
  input: unknown;
  deadline: string;
  escrowHandle?: string;
  priority?: "low" | "normal" | "high" | "critical";
}

export interface TaskResultPayload {
  contractId: string;
  output: unknown;
  metrics: TaskMetrics;
}

export interface TaskFailedPayload {
  contractId: string;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    stack?: string;
  };
  attempt: number;
  maxRetries: number;
}

export interface TaskProgressPayload {
  contractId: string;
  progress: number; // 0.0 - 1.0
  stage: string;
  message?: string;
}

export interface HeartbeatPayload {
  sessionId: string;
  agentName: string;
  uptime: number;
  resourceUsage: {
    memoryMb: number;
    cpuPercent: number;
    activeContracts: number;
  };
}

export interface EscalationPayload {
  contractId?: string;
  sessionId: string;
  reason: string;
  severity: "info" | "warning" | "critical";
  context: Record<string, unknown>;
}

export interface SettlementRequestPayload {
  contractId: string;
  action: "release" | "dispute" | "refund";
  amount: number;
  currency: string;
  reason?: string;
}

export interface RiskAlertPayload {
  type:
    | "circuit_breaker_open"
    | "circuit_breaker_half_open"
    | "budget_exceeded"
    | "anomaly_detected"
    | "agent_died"
    | "cascading_halt";
  agent: string;
  sessionId?: string;
  details: Record<string, unknown>;
}

export interface RegistryUpdatePayload {
  agentName: string;
  action: "register" | "deregister" | "update" | "status_change";
  identity?: AgentIdentity;
  status?: "online" | "offline" | "busy";
}

// ─────────────────────────────────────────────────────────
// Shared metrics type
// ─────────────────────────────────────────────────────────

export interface TaskMetrics {
  /** Total execution duration in ms */
  durationMs: number;
  /** Tokens consumed (if applicable) */
  tokensUsed?: number;
  /** Estimated cost in USD */
  resourceCost?: number;
  /** Timestamps */
  startedAt: string;
  completedAt: string;
}

/** Handler type for bus subscriptions */
export type MessageHandler<T = unknown> = (msg: ClawMessage<T>) => Promise<void>;
