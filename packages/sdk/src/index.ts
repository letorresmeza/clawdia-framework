// ─── Core SDK helpers ───────────────────────────────────────────────────────
export { createAgent } from "./create-agent.js";
export { createWorkflowAgent } from "./workflow-agent.js";
export type {
  CreateAgentOptions,
  AgentHandle,
  AgentTask,
  AgentContext,
  HireOptions,
  HireResult,
} from "./create-agent.js";
export type { CreateWorkflowAgentOptions, WorkflowAgentStep } from "./workflow-agent.js";

export { definePlugin } from "./define-plugin.js";

// ─── Commonly-needed plugin types (re-exported for convenience) ──────────────
export type {
  IAgentAdapter,
  IRuntimeProvider,
  IDataConnector,
  INotifierPlugin,
  ISettlementRail,
  IStorageProvider,
  IObservability,
  PluginModule,
  PluginType,
  AgentConfig,
  TaskPayload,
  TaskResult,
  TaskChunk,
  AgentStatus,
  Notification,
  DataEvent,
  QueryResult,
} from "@clawdia/types";
