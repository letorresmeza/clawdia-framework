import type { AgentIdentity } from "./identity.js";
import type { ClawMessage, ClawChannel } from "./messages.js";
import type { TaskContract } from "./contracts.js";

// ─────────────────────────────────────────────────────────
// Plugin System — 8 swappable integration slots
// ─────────────────────────────────────────────────────────

/** All plugin types in the framework */
export type PluginType =
  | "agent"
  | "runtime"
  | "data"
  | "tracker"
  | "notifier"
  | "settlement"
  | "storage"
  | "observability";

/** Every plugin exports this module shape */
export interface PluginModule<T = unknown> {
  /** Unique plugin name */
  name: string;
  /** Plugin type (determines which slot it fills) */
  type: PluginType;
  /** Factory function to create plugin instance */
  create: (config?: Record<string, unknown>) => T;
  /** Plugin version */
  version?: string;
}

// ─────────────────────────────────────────────────────────
// Slot 1: Agent Adapter
// ─────────────────────────────────────────────────────────

export interface AgentConfig {
  identity: AgentIdentity;
  task?: string;
  env?: Record<string, string>;
  systemPrompt?: string;
}

export interface TaskPayload {
  contractId: string;
  capability: string;
  input: unknown;
  context?: Record<string, unknown>;
}

export interface TaskResult {
  output: unknown;
  metrics: {
    durationMs: number;
    tokensUsed?: number;
    resourceCost?: number;
  };
  logs?: string[];
}

export interface TaskChunk {
  type: "text" | "tool_use" | "progress" | "error";
  content: string;
  timestamp: string;
}

export interface AgentStatus {
  state: "idle" | "working" | "error" | "terminated";
  currentTask?: string;
  uptime: number;
  tasksCompleted: number;
}

export interface IAgentAdapter {
  readonly name: string;
  initialize(config: AgentConfig): Promise<void>;
  execute(task: TaskPayload): Promise<TaskResult>;
  stream(task: TaskPayload): AsyncIterable<TaskChunk>;
  report(): AgentStatus;
  terminate(reason?: string): Promise<void>;
}

// ─────────────────────────────────────────────────────────
// Slot 2: Runtime Provider
// ─────────────────────────────────────────────────────────

export interface RuntimeSpec {
  name: string;
  image?: string;
  memoryMb?: number;
  cpus?: number;
  env?: Record<string, string>;
  network?: string;
  volumes?: Array<{ host: string; container: string; readonly?: boolean }>;
  command?: string[];
}

export interface RuntimeHandle {
  id: string;
  name: string;
  runtime: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface HealthStatus {
  alive: boolean;
  uptime: number;
  memoryUsedMb?: number;
  cpuPercent?: number;
}

export interface IRuntimeProvider {
  readonly name: string;
  spawn(spec: RuntimeSpec): Promise<RuntimeHandle>;
  destroy(handle: RuntimeHandle): Promise<void>;
  exec(handle: RuntimeHandle, cmd: string): Promise<ExecResult>;
  logs(handle: RuntimeHandle): AsyncIterable<string>;
  healthCheck(handle: RuntimeHandle): Promise<HealthStatus>;
}

// ─────────────────────────────────────────────────────────
// Slot 3: Data Connector
// ─────────────────────────────────────────────────────────

export interface DataSourceConfig {
  url: string;
  auth?: { type: "bearer" | "basic" | "api_key"; credentials: string };
  options?: Record<string, unknown>;
}

export interface DataEvent {
  source: string;
  type: string;
  data: unknown;
  timestamp: string;
}

export interface QueryParams {
  query: string;
  params?: Record<string, unknown>;
  limit?: number;
  offset?: number;
}

export interface QueryResult {
  data: unknown[];
  total: number;
  hasMore: boolean;
}

export interface IDataConnector {
  readonly name: string;
  connect(config: DataSourceConfig): Promise<void>;
  subscribe(channel: string): AsyncIterable<DataEvent>;
  query(params: QueryParams): Promise<QueryResult>;
  disconnect(): Promise<void>;
}

// ─────────────────────────────────────────────────────────
// Slot 4: Tracker Integration
// ─────────────────────────────────────────────────────────

export interface TrackerIssue {
  id: string;
  title: string;
  description: string;
  status: string;
  labels: string[];
  assignee?: string;
  url: string;
}

export interface PRSpec {
  title: string;
  body: string;
  baseBranch: string;
  headBranch: string;
  labels?: string[];
  reviewers?: string[];
}

export interface PRHandle {
  id: string;
  number: number;
  url: string;
}

export interface ITrackerPlugin {
  readonly name: string;
  fetchIssue(id: string): Promise<TrackerIssue>;
  updateStatus(id: string, status: string): Promise<void>;
  createPR(spec: PRSpec): Promise<PRHandle>;
  addComment(issueId: string, body: string): Promise<void>;
}

// ─────────────────────────────────────────────────────────
// Slot 5: Notifier
// ─────────────────────────────────────────────────────────

export interface Notification {
  level: "info" | "warning" | "critical";
  title: string;
  body: string;
  channel?: string;
  actions?: Array<{ label: string; url: string }>;
  metadata?: Record<string, unknown>;
}

export interface INotifierPlugin {
  readonly name: string;
  send(notification: Notification): Promise<void>;
  sendBatch(notifications: Notification[]): Promise<void>;
}

// ─────────────────────────────────────────────────────────
// Slot 6: Settlement Rail
// ─────────────────────────────────────────────────────────

export type TxHash = string;

export interface EscrowHandle {
  id: string;
  contractId: string;
  amount: bigint;
  currency: string;
  status: "created" | "funded" | "released" | "disputed" | "refunded";
}

export interface ISettlementRail {
  readonly name: string;
  createEscrow(contract: TaskContract): Promise<EscrowHandle>;
  fundEscrow(handle: EscrowHandle, amount: bigint): Promise<TxHash>;
  releaseEscrow(handle: EscrowHandle, recipient: string): Promise<TxHash>;
  disputeEscrow(handle: EscrowHandle, reason: string): Promise<void>;
  getBalance(address: string): Promise<bigint>;
}

// ─────────────────────────────────────────────────────────
// Slot 7: Storage Provider
// ─────────────────────────────────────────────────────────

export interface IStorageProvider {
  readonly name: string;
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
  has(key: string): Promise<boolean>;
}

// ─────────────────────────────────────────────────────────
// Slot 8: Observability
// ─────────────────────────────────────────────────────────

export interface IObservability {
  readonly name: string;
  counter(name: string, value?: number, labels?: Record<string, string>): void;
  histogram(name: string, value: number, labels?: Record<string, string>): void;
  gauge(name: string, value: number, labels?: Record<string, string>): void;
  trace<T>(name: string, fn: () => Promise<T>): Promise<T>;
}
