import type { AgentIdentity } from "./identity.js";

// ─────────────────────────────────────────────────────────
// Agent Session — tracks a running agent's lifecycle
// ─────────────────────────────────────────────────────────

export type SessionState =
  | "initializing"
  | "running"
  | "paused"
  | "completing"
  | "terminating"
  | "dead";

export interface AgentSession {
  /** Unique session identifier */
  id: string;
  /** Agent identity for this session */
  identity: AgentIdentity;
  /** Runtime handle (container ID, tmux session, etc.) */
  runtimeHandle: { id: string; name: string; runtime: string };
  /** Current session state */
  state: SessionState;
  /** When the session was started */
  startedAt: string;
  /** Last heartbeat received */
  lastHeartbeat: string;
  /** Number of tasks completed in this session */
  tasksCompleted: number;
  /** Active contract IDs being worked on */
  activeContracts: string[];
  /** Error info if session died */
  error?: { code: string; message: string; timestamp: string };
}

// ─────────────────────────────────────────────────────────
// Service Registry types
// ─────────────────────────────────────────────────────────

export interface RegistryEntry {
  identity: AgentIdentity;
  registeredAt: string;
  lastSeen: string;
  status: "online" | "offline" | "busy";
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface RegistryQuery {
  /** Capability taxonomy pattern (supports * wildcard) */
  taxonomy?: string;
  /** Minimum reputation score */
  minReputation?: number;
  /** Maximum price per request */
  maxPrice?: number;
  /** Currency filter */
  currency?: string;
  /** Only return online agents */
  onlineOnly?: boolean;
  /** Maximum results */
  limit?: number;
}

export interface RegistryQueryResult {
  entries: RegistryEntry[];
  total: number;
}

// ─────────────────────────────────────────────────────────
// Workflow Engine types
// ─────────────────────────────────────────────────────────

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  /** DAG nodes */
  steps: WorkflowStep[];
  /** Edges between steps */
  edges: WorkflowEdge[];
}

export interface WorkflowStep {
  id: string;
  name: string;
  /** Required capability for this step */
  capability: string;
  /** Input mapping from previous steps */
  inputMapping?: Record<string, string>;
  /** Timeout for this step */
  timeoutMs?: number;
  /** Retry configuration */
  retries?: number;
  /** Parallel fan-out count (spawn N agents, take best) */
  fanOut?: number;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  /** Condition for traversing this edge */
  condition?: {
    field: string;
    operator: "eq" | "neq" | "gt" | "lt" | "contains";
    value: unknown;
  };
}

export type WorkflowState = "pending" | "running" | "paused" | "completed" | "failed";

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  state: WorkflowState;
  /** Per-step execution state */
  stepStates: Map<string, {
    state: "pending" | "running" | "completed" | "failed" | "skipped";
    output?: unknown;
    error?: string;
    startedAt?: string;
    completedAt?: string;
  }>;
  startedAt: string;
  completedAt?: string;
}
