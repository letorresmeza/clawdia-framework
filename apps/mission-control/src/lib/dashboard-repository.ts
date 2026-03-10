import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DashboardVersionConflictError } from "@/lib/dashboard-errors";
import { seedDashboard, type DashboardPayload } from "@/lib/mission-control";
import { validateDashboardShape } from "@/lib/dashboard-validation";

declare global {
  var __missionControlRepository:
    | {
        dashboard: DashboardPayload;
        initialized: boolean;
        writeChain: Promise<void>;
      }
    | undefined;
}

const repository = globalThis.__missionControlRepository ?? {
  dashboard: structuredClone(seedDashboard),
  initialized: false,
  writeChain: Promise.resolve(),
};

if (!globalThis.__missionControlRepository) {
  globalThis.__missionControlRepository = repository;
}

const dataDirectory = path.join(process.cwd(), "data");
const dataFile = path.join(dataDirectory, "dashboard.json");

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function makeId(prefix: string, source: string, index: number) {
  const slug = slugify(source) || `${prefix}-${index + 1}`;
  return `${prefix}-${slug}-${index + 1}`;
}

function normalizeDashboard(raw: unknown): DashboardPayload {
  if (!raw || typeof raw !== "object") {
    return structuredClone(seedDashboard);
  }

  const candidate = raw as Partial<DashboardPayload> & Record<string, unknown>;
  const now = new Date().toISOString();
  const systemUser = "system";

  const dashboard: DashboardPayload = {
    version:
      typeof candidate.version === "number" && Number.isFinite(candidate.version)
        ? candidate.version
        : 1,
    updatedAt:
      typeof candidate.updatedAt === "string" && candidate.updatedAt.length > 0
        ? candidate.updatedAt
        : now,
    agents: Array.isArray(candidate.agents)
      ? candidate.agents.map((item, index) => {
          const agent = item as Record<string, unknown>;
          return {
            id:
              typeof agent.id === "string" && agent.id.length > 0
                ? agent.id
                : makeId("agent", String(agent.name ?? "agent"), index),
            createdAt:
              typeof agent.createdAt === "string" && agent.createdAt.length > 0
                ? agent.createdAt
                : now,
            updatedAt:
              typeof agent.updatedAt === "string" && agent.updatedAt.length > 0
                ? agent.updatedAt
                : now,
            createdBy:
              typeof agent.createdBy === "string" && agent.createdBy.length > 0
                ? agent.createdBy
                : systemUser,
            updatedBy:
              typeof agent.updatedBy === "string" && agent.updatedBy.length > 0
                ? agent.updatedBy
                : systemUser,
            name: String(agent.name ?? `Agent ${index + 1}`),
            role: String(agent.role ?? "Unassigned"),
            status: (agent.status ?? "Available") as DashboardPayload["agents"][number]["status"],
            mode: (agent.mode ?? "Standby") as DashboardPayload["agents"][number]["mode"],
            utilization:
              typeof agent.utilization === "number" ? agent.utilization : 0,
            latency: typeof agent.latency === "number" ? agent.latency : 0,
            successRate:
              typeof agent.successRate === "number" ? agent.successRate : 0,
            spend: typeof agent.spend === "number" ? agent.spend : 0,
            accent: String(agent.accent ?? "var(--accent-white)"),
            owner: String(agent.owner ?? "Unassigned"),
            permissions: Array.isArray(agent.permissions)
              ? agent.permissions.filter((value): value is string => typeof value === "string")
              : [],
            currentTask: String(agent.currentTask ?? "No task assigned"),
            queueDepth: typeof agent.queueDepth === "number" ? agent.queueDepth : 0,
            lastActive: String(agent.lastActive ?? "unknown"),
          };
        })
      : structuredClone(seedDashboard.agents),
    events: Array.isArray(candidate.events)
      ? candidate.events.map((item, index) => {
          const event = item as Record<string, unknown>;
          return {
            id:
              typeof event.id === "string" && event.id.length > 0
                ? event.id
                : makeId("event", String(event.title ?? "event"), index),
            createdAt:
              typeof event.createdAt === "string" && event.createdAt.length > 0
                ? event.createdAt
                : now,
            updatedAt:
              typeof event.updatedAt === "string" && event.updatedAt.length > 0
                ? event.updatedAt
                : now,
            createdBy:
              typeof event.createdBy === "string" && event.createdBy.length > 0
                ? event.createdBy
                : systemUser,
            updatedBy:
              typeof event.updatedBy === "string" && event.updatedBy.length > 0
                ? event.updatedBy
                : systemUser,
            time: String(event.time ?? "--"),
            title: String(event.title ?? `Event ${index + 1}`),
            detail: String(event.detail ?? ""),
          };
        })
      : structuredClone(seedDashboard.events),
    contracts: Array.isArray(candidate.contracts)
      ? candidate.contracts.map((item, index) => {
          const contract = item as Record<string, unknown>;
          return {
            id:
              typeof contract.id === "string" && contract.id.length > 0
                ? contract.id
                : makeId("contract", String(contract.team ?? "contract"), index),
            createdAt:
              typeof contract.createdAt === "string" && contract.createdAt.length > 0
                ? contract.createdAt
                : now,
            updatedAt:
              typeof contract.updatedAt === "string" && contract.updatedAt.length > 0
                ? contract.updatedAt
                : now,
            createdBy:
              typeof contract.createdBy === "string" && contract.createdBy.length > 0
                ? contract.createdBy
                : systemUser,
            updatedBy:
              typeof contract.updatedBy === "string" && contract.updatedBy.length > 0
                ? contract.updatedBy
                : systemUser,
            team: String(contract.team ?? `Team ${index + 1}`),
            count: String(contract.count ?? "00"),
            description: String(contract.description ?? ""),
          };
        })
      : structuredClone(seedDashboard.contracts),
    tasks: Array.isArray(candidate.tasks)
      ? candidate.tasks.map((item, index) => {
          const task = item as Record<string, unknown>;
          return {
            id:
              typeof task.id === "string" && task.id.length > 0
                ? task.id
                : makeId("task", String(task.label ?? "task"), index),
            createdAt:
              typeof task.createdAt === "string" && task.createdAt.length > 0
                ? task.createdAt
                : now,
            updatedAt:
              typeof task.updatedAt === "string" && task.updatedAt.length > 0
                ? task.updatedAt
                : now,
            createdBy:
              typeof task.createdBy === "string" && task.createdBy.length > 0
                ? task.createdBy
                : systemUser,
            updatedBy:
              typeof task.updatedBy === "string" && task.updatedBy.length > 0
                ? task.updatedBy
                : systemUser,
            label: String(task.label ?? `Task ${index + 1}`),
            owner: String(task.owner ?? "Unassigned"),
            state: (task.state ?? "Queued") as DashboardPayload["tasks"][number]["state"],
          };
        })
      : structuredClone(seedDashboard.tasks),
  };

  const validated = validateDashboardShape(dashboard);
  return validated.ok ? validated.value : structuredClone(seedDashboard);
}

async function persistDashboard() {
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(dataFile, JSON.stringify(repository.dashboard, null, 2), "utf8");
}

export async function ensureDashboardInitialized() {
  if (repository.initialized) {
    return;
  }

  try {
    const file = await readFile(dataFile, "utf8");
    repository.dashboard = normalizeDashboard(JSON.parse(file));
  } catch {
    repository.dashboard = structuredClone(seedDashboard);
    await persistDashboard();
  }

  repository.initialized = true;
}

export async function readDashboard() {
  await ensureDashboardInitialized();
  return structuredClone(repository.dashboard);
}

export async function writeDashboard(
  updater: (current: DashboardPayload) => DashboardPayload,
  options?: { expectedVersion?: number }
) {
  await ensureDashboardInitialized();

  let snapshot = structuredClone(repository.dashboard);

  repository.writeChain = repository.writeChain.then(async () => {
    const current = structuredClone(repository.dashboard);
    if (
      options?.expectedVersion != null &&
      current.version !== options.expectedVersion
    ) {
      throw new DashboardVersionConflictError(
        `expected version ${options.expectedVersion}, received ${current.version}`
      );
    }

    const next = updater(current);
    if (next === current) {
      snapshot = structuredClone(repository.dashboard);
      return;
    }

    const validated = validateDashboardShape(next);

    if (!validated.ok) {
      throw new Error(validated.error);
    }

    repository.dashboard = {
      ...validated.value,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    snapshot = structuredClone(repository.dashboard);
    await persistDashboard();
  });

  await repository.writeChain;
  return snapshot;
}
