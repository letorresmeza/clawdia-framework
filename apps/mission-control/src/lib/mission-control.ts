export type AgentStatus = "Hired" | "Trial" | "Available" | "Paused";
export type AgentMode = "Live" | "Watching" | "Learning" | "Standby" | "Queued";
export type TaskState = "Running" | "Blocked" | "Queued" | "Ready" | "Done";

export type DashboardMeta = {
  version: number;
  updatedAt: string;
};

export type AuditFields = {
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
};

export type Agent = AuditFields & {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  mode: AgentMode;
  utilization: number;
  latency: number;
  successRate: number;
  spend: number;
  accent: string;
  owner: string;
  permissions: string[];
  currentTask: string;
  queueDepth: number;
  lastActive: string;
};

export type EventItem = AuditFields & {
  id: string;
  time: string;
  title: string;
  detail: string;
};

export type Contract = AuditFields & {
  id: string;
  team: string;
  count: string;
  description: string;
};

export type TaskItem = AuditFields & {
  id: string;
  label: string;
  owner: string;
  state: TaskState;
};

export type DashboardPayload = DashboardMeta & {
  agents: Agent[];
  events: EventItem[];
  contracts: Contract[];
  tasks: TaskItem[];
};

export const agentStatuses: AgentStatus[] = [
  "Hired",
  "Trial",
  "Available",
  "Paused",
];

export const agentModes: AgentMode[] = [
  "Live",
  "Watching",
  "Learning",
  "Standby",
  "Queued",
];

export const taskStates: TaskState[] = [
  "Running",
  "Blocked",
  "Queued",
  "Ready",
  "Done",
];

const defaultTimestamp = "2026-03-10T00:00:00.000Z";
const systemUser = "system";

export const seedDashboard: DashboardPayload = {
  version: 1,
  updatedAt: defaultTimestamp,
  agents: [
    {
      id: "agent-orion",
      createdAt: defaultTimestamp,
      updatedAt: defaultTimestamp,
      createdBy: systemUser,
      updatedBy: systemUser,
      name: "Orion",
      role: "Operations Architect",
      status: "Hired",
      mode: "Live",
      utilization: 92,
      latency: 0.8,
      successRate: 99.1,
      spend: 1284,
      accent: "var(--accent-cyan)",
      owner: "Operations",
      permissions: ["deploy", "assign", "budget"],
      currentTask: "Syncing vendor deltas and reprioritizing onboarding queue",
      queueDepth: 9,
      lastActive: "26s ago",
    },
    {
      id: "agent-nyx",
      createdAt: defaultTimestamp,
      updatedAt: defaultTimestamp,
      createdBy: systemUser,
      updatedBy: systemUser,
      name: "Nyx",
      role: "Threat Sentinel",
      status: "Hired",
      mode: "Watching",
      utilization: 67,
      latency: 1.4,
      successRate: 97.8,
      spend: 642,
      accent: "var(--accent-green)",
      owner: "Security",
      permissions: ["audit", "alert", "escalate"],
      currentTask: "Investigating elevated auth requests across 3 workspaces",
      queueDepth: 4,
      lastActive: "09s ago",
    },
    {
      id: "agent-kite",
      createdAt: defaultTimestamp,
      updatedAt: defaultTimestamp,
      createdBy: systemUser,
      updatedBy: systemUser,
      name: "Kite",
      role: "Revenue Optimizer",
      status: "Trial",
      mode: "Learning",
      utilization: 41,
      latency: 2.3,
      successRate: 91.4,
      spend: 390,
      accent: "var(--accent-amber)",
      owner: "Growth",
      permissions: ["recommend", "simulate"],
      currentTask: "Testing bid adjustments before wider rollout",
      queueDepth: 6,
      lastActive: "2m ago",
    },
    {
      id: "agent-vanta",
      createdAt: defaultTimestamp,
      updatedAt: defaultTimestamp,
      createdBy: systemUser,
      updatedBy: systemUser,
      name: "Vanta",
      role: "Workflow Conductor",
      status: "Available",
      mode: "Standby",
      utilization: 18,
      latency: 0.6,
      successRate: 98.6,
      spend: 212,
      accent: "var(--accent-white)",
      owner: "Platform",
      permissions: ["assign", "route"],
      currentTask: "Idle. Ready for orchestration assignment.",
      queueDepth: 0,
      lastActive: "7m ago",
    },
  ],
  events: [
    {
      id: "event-auth-anomaly",
      createdAt: defaultTimestamp,
      updatedAt: defaultTimestamp,
      createdBy: systemUser,
      updatedBy: systemUser,
      time: "09:42 UTC",
      title: "Nyx escalated an auth anomaly",
      detail: "Flagged 3 elevated-permission requests and routed approval to human ops.",
    },
    {
      id: "event-vendor-sync",
      createdAt: defaultTimestamp,
      updatedAt: defaultTimestamp,
      createdBy: systemUser,
      updatedBy: systemUser,
      time: "09:18 UTC",
      title: "Orion closed a vendor sync",
      detail: "Published pricing deltas to procurement and refreshed hiring recommendations.",
    },
    {
      id: "event-campaign-yield",
      createdAt: defaultTimestamp,
      updatedAt: defaultTimestamp,
      createdBy: systemUser,
      updatedBy: systemUser,
      time: "08:57 UTC",
      title: "Kite improved campaign yield",
      detail: "Rolled out a new bidding policy and lifted qualified conversions by 12.4%.",
    },
  ],
  contracts: [
    {
      id: "contract-ops",
      createdAt: defaultTimestamp,
      updatedAt: defaultTimestamp,
      createdBy: systemUser,
      updatedBy: systemUser,
      team: "Ops",
      count: "04",
      description: "Incident routing, reporting, capacity checks",
    },
    {
      id: "contract-sales",
      createdAt: defaultTimestamp,
      updatedAt: defaultTimestamp,
      createdBy: systemUser,
      updatedBy: systemUser,
      team: "Sales",
      count: "03",
      description: "Lead scoring, outbound drafting, renewal watch",
    },
    {
      id: "contract-finance",
      createdAt: defaultTimestamp,
      updatedAt: defaultTimestamp,
      createdBy: systemUser,
      updatedBy: systemUser,
      team: "Finance",
      count: "02",
      description: "Spend guardrails, close prep",
    },
    {
      id: "contract-product",
      createdAt: defaultTimestamp,
      updatedAt: defaultTimestamp,
      createdBy: systemUser,
      updatedBy: systemUser,
      team: "Product",
      count: "03",
      description: "Spec triage, QA sweeps, release notes",
    },
  ],
  tasks: [
    {
      id: "task-contract-renewals",
      createdAt: defaultTimestamp,
      updatedAt: defaultTimestamp,
      createdBy: systemUser,
      updatedBy: systemUser,
      label: "Contract renewals",
      owner: "Orion",
      state: "Running",
    },
    {
      id: "task-anomaly-review",
      createdAt: defaultTimestamp,
      updatedAt: defaultTimestamp,
      createdBy: systemUser,
      updatedBy: systemUser,
      label: "Permission anomaly review",
      owner: "Nyx",
      state: "Blocked",
    },
    {
      id: "task-cac-refresh",
      createdAt: defaultTimestamp,
      updatedAt: defaultTimestamp,
      createdBy: systemUser,
      updatedBy: systemUser,
      label: "CAC model refresh",
      owner: "Kite",
      state: "Queued",
    },
    {
      id: "task-workflow-map",
      createdAt: defaultTimestamp,
      updatedAt: defaultTimestamp,
      createdBy: systemUser,
      updatedBy: systemUser,
      label: "Cross-team workflow map",
      owner: "Vanta",
      state: "Ready",
    },
  ],
};

export const seedAgents = seedDashboard.agents;
export const seedEvents = seedDashboard.events;
export const seedContracts = seedDashboard.contracts;
export const seedTasks = seedDashboard.tasks;
