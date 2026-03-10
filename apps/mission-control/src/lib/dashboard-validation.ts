import {
  agentModes,
  agentStatuses,
  taskStates,
  type AuditFields,
  type Agent,
  type AgentMode,
  type AgentStatus,
  type Contract,
  type DashboardPayload,
  type EventItem,
  type TaskItem,
  type TaskState,
} from "@/lib/mission-control";

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

type Auditless<T> = Omit<T, keyof AuditFields>;

export type CreateAgentInput = Auditless<Agent> & { id?: string };
export type UpdateAgentInput = Partial<Auditless<Agent>>;
export type CreateTaskInput = Auditless<TaskItem> & { id?: string };
export type UpdateTaskInput = Partial<Auditless<TaskItem>>;
export type CreateEventInput = Auditless<EventItem> & { id?: string };
export type UpdateEventInput = Partial<Auditless<EventItem>>;
export type CreateContractInput = Auditless<Contract> & { id?: string };
export type UpdateContractInput = Partial<Auditless<Contract>>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isAgentStatus(value: unknown): value is AgentStatus {
  return typeof value === "string" && agentStatuses.includes(value as AgentStatus);
}

function isAgentMode(value: unknown): value is AgentMode {
  return typeof value === "string" && agentModes.includes(value as AgentMode);
}

function isTaskState(value: unknown): value is TaskState {
  return typeof value === "string" && taskStates.includes(value as TaskState);
}

function validateAgentLike(value: unknown): ValidationResult<CreateAgentInput> {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "agent payload must be an object" };
  }

  const candidate = value as Record<string, unknown>;
  if (!isNonEmptyString(candidate.name)) return { ok: false, error: "name is required" };
  if (!isNonEmptyString(candidate.role)) return { ok: false, error: "role is required" };
  if (!isAgentStatus(candidate.status)) return { ok: false, error: "invalid status" };
  if (!isAgentMode(candidate.mode)) return { ok: false, error: "invalid mode" };
  if (!isFiniteNumber(candidate.utilization)) {
    return { ok: false, error: "utilization must be a number" };
  }
  if (!isFiniteNumber(candidate.latency)) {
    return { ok: false, error: "latency must be a number" };
  }
  if (!isFiniteNumber(candidate.successRate)) {
    return { ok: false, error: "successRate must be a number" };
  }
  if (!isFiniteNumber(candidate.spend)) {
    return { ok: false, error: "spend must be a number" };
  }
  if (!isNonEmptyString(candidate.accent)) return { ok: false, error: "accent is required" };
  if (!isNonEmptyString(candidate.owner)) return { ok: false, error: "owner is required" };
  if (!isStringArray(candidate.permissions)) {
    return { ok: false, error: "permissions must be a string array" };
  }
  if (!isNonEmptyString(candidate.currentTask)) {
    return { ok: false, error: "currentTask is required" };
  }
  if (!isFiniteNumber(candidate.queueDepth)) {
    return { ok: false, error: "queueDepth must be a number" };
  }
  if (!isNonEmptyString(candidate.lastActive)) {
    return { ok: false, error: "lastActive is required" };
  }

  return {
    ok: true,
    value: {
      id: isNonEmptyString(candidate.id) ? candidate.id : undefined,
      name: candidate.name,
      role: candidate.role,
      status: candidate.status,
      mode: candidate.mode,
      utilization: candidate.utilization,
      latency: candidate.latency,
      successRate: candidate.successRate,
      spend: candidate.spend,
      accent: candidate.accent,
      owner: candidate.owner,
      permissions: candidate.permissions,
      currentTask: candidate.currentTask,
      queueDepth: candidate.queueDepth,
      lastActive: candidate.lastActive,
    },
  };
}

export function validateCreateAgent(value: unknown): ValidationResult<CreateAgentInput> {
  return validateAgentLike(value);
}

export function validateUpdateAgent(value: unknown): ValidationResult<UpdateAgentInput> {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "agent update must be an object" };
  }

  const candidate = value as Record<string, unknown>;
  const next: UpdateAgentInput = {};

  if ("name" in candidate) {
    if (!isNonEmptyString(candidate.name)) return { ok: false, error: "name must be a string" };
    next.name = candidate.name;
  }
  if ("role" in candidate) {
    if (!isNonEmptyString(candidate.role)) return { ok: false, error: "role must be a string" };
    next.role = candidate.role;
  }
  if ("status" in candidate) {
    if (!isAgentStatus(candidate.status)) return { ok: false, error: "invalid status" };
    next.status = candidate.status;
  }
  if ("mode" in candidate) {
    if (!isAgentMode(candidate.mode)) return { ok: false, error: "invalid mode" };
    next.mode = candidate.mode;
  }
  if ("utilization" in candidate) {
    if (!isFiniteNumber(candidate.utilization)) {
      return { ok: false, error: "utilization must be a number" };
    }
    next.utilization = candidate.utilization;
  }
  if ("latency" in candidate) {
    if (!isFiniteNumber(candidate.latency)) return { ok: false, error: "latency must be a number" };
    next.latency = candidate.latency;
  }
  if ("successRate" in candidate) {
    if (!isFiniteNumber(candidate.successRate)) {
      return { ok: false, error: "successRate must be a number" };
    }
    next.successRate = candidate.successRate;
  }
  if ("spend" in candidate) {
    if (!isFiniteNumber(candidate.spend)) return { ok: false, error: "spend must be a number" };
    next.spend = candidate.spend;
  }
  if ("accent" in candidate) {
    if (!isNonEmptyString(candidate.accent)) return { ok: false, error: "accent must be a string" };
    next.accent = candidate.accent;
  }
  if ("owner" in candidate) {
    if (!isNonEmptyString(candidate.owner)) return { ok: false, error: "owner must be a string" };
    next.owner = candidate.owner;
  }
  if ("permissions" in candidate) {
    if (!isStringArray(candidate.permissions)) {
      return { ok: false, error: "permissions must be a string array" };
    }
    next.permissions = candidate.permissions;
  }
  if ("currentTask" in candidate) {
    if (!isNonEmptyString(candidate.currentTask)) {
      return { ok: false, error: "currentTask must be a string" };
    }
    next.currentTask = candidate.currentTask;
  }
  if ("queueDepth" in candidate) {
    if (!isFiniteNumber(candidate.queueDepth)) {
      return { ok: false, error: "queueDepth must be a number" };
    }
    next.queueDepth = candidate.queueDepth;
  }
  if ("lastActive" in candidate) {
    if (!isNonEmptyString(candidate.lastActive)) {
      return { ok: false, error: "lastActive must be a string" };
    }
    next.lastActive = candidate.lastActive;
  }

  if (Object.keys(next).length === 0) {
    return { ok: false, error: "at least one field is required" };
  }

  return { ok: true, value: next };
}

function validateTaskLike(value: unknown): ValidationResult<CreateTaskInput> {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "task payload must be an object" };
  }

  const candidate = value as Record<string, unknown>;
  if (!isNonEmptyString(candidate.label)) return { ok: false, error: "label is required" };
  if (!isNonEmptyString(candidate.owner)) return { ok: false, error: "owner is required" };
  if (!isTaskState(candidate.state)) return { ok: false, error: "invalid state" };

  return {
    ok: true,
    value: {
      id: isNonEmptyString(candidate.id) ? candidate.id : undefined,
      label: candidate.label,
      owner: candidate.owner,
      state: candidate.state,
    },
  };
}

export function validateCreateTask(value: unknown): ValidationResult<CreateTaskInput> {
  return validateTaskLike(value);
}

export function validateUpdateTask(value: unknown): ValidationResult<UpdateTaskInput> {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "task update must be an object" };
  }

  const candidate = value as Record<string, unknown>;
  const next: UpdateTaskInput = {};

  if ("label" in candidate) {
    if (!isNonEmptyString(candidate.label)) return { ok: false, error: "label must be a string" };
    next.label = candidate.label;
  }
  if ("owner" in candidate) {
    if (!isNonEmptyString(candidate.owner)) return { ok: false, error: "owner must be a string" };
    next.owner = candidate.owner;
  }
  if ("state" in candidate) {
    if (!isTaskState(candidate.state)) return { ok: false, error: "invalid state" };
    next.state = candidate.state;
  }

  if (Object.keys(next).length === 0) {
    return { ok: false, error: "at least one field is required" };
  }

  return { ok: true, value: next };
}

function validateEventLike(value: unknown): ValidationResult<CreateEventInput> {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "event payload must be an object" };
  }

  const candidate = value as Record<string, unknown>;
  if (!isNonEmptyString(candidate.time)) return { ok: false, error: "time is required" };
  if (!isNonEmptyString(candidate.title)) return { ok: false, error: "title is required" };
  if (!isNonEmptyString(candidate.detail)) return { ok: false, error: "detail is required" };

  return {
    ok: true,
    value: {
      id: isNonEmptyString(candidate.id) ? candidate.id : undefined,
      time: candidate.time,
      title: candidate.title,
      detail: candidate.detail,
    },
  };
}

export function validateCreateEvent(value: unknown): ValidationResult<CreateEventInput> {
  return validateEventLike(value);
}

export function validateUpdateEvent(value: unknown): ValidationResult<UpdateEventInput> {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "event update must be an object" };
  }

  const candidate = value as Record<string, unknown>;
  const next: UpdateEventInput = {};

  if ("time" in candidate) {
    if (!isNonEmptyString(candidate.time)) return { ok: false, error: "time must be a string" };
    next.time = candidate.time;
  }
  if ("title" in candidate) {
    if (!isNonEmptyString(candidate.title)) return { ok: false, error: "title must be a string" };
    next.title = candidate.title;
  }
  if ("detail" in candidate) {
    if (!isNonEmptyString(candidate.detail)) return { ok: false, error: "detail must be a string" };
    next.detail = candidate.detail;
  }

  if (Object.keys(next).length === 0) {
    return { ok: false, error: "at least one field is required" };
  }

  return { ok: true, value: next };
}

function validateContractLike(value: unknown): ValidationResult<CreateContractInput> {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "contract payload must be an object" };
  }

  const candidate = value as Record<string, unknown>;
  if (!isNonEmptyString(candidate.team)) return { ok: false, error: "team is required" };
  if (!isNonEmptyString(candidate.count)) return { ok: false, error: "count is required" };
  if (!isNonEmptyString(candidate.description)) {
    return { ok: false, error: "description is required" };
  }

  return {
    ok: true,
    value: {
      id: isNonEmptyString(candidate.id) ? candidate.id : undefined,
      team: candidate.team,
      count: candidate.count,
      description: candidate.description,
    },
  };
}

export function validateCreateContract(value: unknown): ValidationResult<CreateContractInput> {
  return validateContractLike(value);
}

export function validateUpdateContract(value: unknown): ValidationResult<UpdateContractInput> {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "contract update must be an object" };
  }

  const candidate = value as Record<string, unknown>;
  const next: UpdateContractInput = {};

  if ("team" in candidate) {
    if (!isNonEmptyString(candidate.team)) return { ok: false, error: "team must be a string" };
    next.team = candidate.team;
  }
  if ("count" in candidate) {
    if (!isNonEmptyString(candidate.count)) return { ok: false, error: "count must be a string" };
    next.count = candidate.count;
  }
  if ("description" in candidate) {
    if (!isNonEmptyString(candidate.description)) {
      return { ok: false, error: "description must be a string" };
    }
    next.description = candidate.description;
  }

  if (Object.keys(next).length === 0) {
    return { ok: false, error: "at least one field is required" };
  }

  return { ok: true, value: next };
}

export function validateDashboardShape(dashboard: DashboardPayload): ValidationResult<DashboardPayload> {
  const ids = new Set<string>();

  for (const agent of dashboard.agents) {
    if (ids.has(agent.id)) return { ok: false, error: `duplicate id ${agent.id}` };
    ids.add(agent.id);
    if (!agentStatuses.includes(agent.status)) {
      return { ok: false, error: `invalid agent status for ${agent.id}` };
    }
    if (!agentModes.includes(agent.mode)) {
      return { ok: false, error: `invalid agent mode for ${agent.id}` };
    }
  }

  for (const task of dashboard.tasks) {
    if (ids.has(task.id)) return { ok: false, error: `duplicate id ${task.id}` };
    ids.add(task.id);
    if (!taskStates.includes(task.state)) {
      return { ok: false, error: `invalid task state for ${task.id}` };
    }
  }

  for (const event of dashboard.events) {
    if (ids.has(event.id)) return { ok: false, error: `duplicate id ${event.id}` };
    ids.add(event.id);
  }

  for (const contract of dashboard.contracts) {
    if (ids.has(contract.id)) return { ok: false, error: `duplicate id ${contract.id}` };
    ids.add(contract.id);
  }

  return { ok: true, value: dashboard };
}
