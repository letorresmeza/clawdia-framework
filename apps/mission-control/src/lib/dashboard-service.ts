import {
  type Agent,
  type AuditFields,
  type Contract,
  type EventItem,
  type TaskItem,
} from "@/lib/mission-control";
import { readDashboard, writeDashboard } from "@/lib/dashboard-repository";
import type {
  CreateAgentInput,
  CreateContractInput,
  CreateEventInput,
  CreateTaskInput,
  UpdateAgentInput,
  UpdateContractInput,
  UpdateEventInput,
  UpdateTaskInput,
} from "@/lib/dashboard-validation";

type MutationOptions = {
  version: number;
  actor: string;
};

function stampCreate<T extends object>(
  item: T,
  actor: string
): T & AuditFields {
  const now = new Date().toISOString();
  return {
    ...item,
    createdAt: now,
    updatedAt: now,
    createdBy: actor,
    updatedBy: actor,
  };
}

function stampUpdate<T extends { updatedAt: string; updatedBy: string }>(
  item: T,
  actor: string
) {
  return {
    ...item,
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function uniqueId(prefix: string, source: string, existing: Set<string>) {
  const base = slugify(source) || prefix;
  let next = `${prefix}-${base}`;
  let index = 2;

  while (existing.has(next)) {
    next = `${prefix}-${base}-${index}`;
    index += 1;
  }

  return next;
}

function touchAgent(agent: Agent, update: UpdateAgentInput): Agent {
  return {
    ...agent,
    ...update,
    lastActive: update.lastActive ?? "just now",
  };
}

export async function getDashboardData() {
  return readDashboard();
}

export async function listAgents() {
  const dashboard = await readDashboard();
  return dashboard.agents;
}

export async function getAgent(id: string) {
  const dashboard = await readDashboard();
  return dashboard.agents.find((agent) => agent.id === id) ?? null;
}

export async function createAgent(input: CreateAgentInput, options: MutationOptions) {
  const dashboard = await writeDashboard((current) => {
    const ids = new Set(current.agents.map((agent) => agent.id));
    const id = input.id && !ids.has(input.id)
      ? input.id
      : uniqueId("agent", input.name, new Set(current.agents.map((agent) => agent.id)));

    const nextAgent: Agent = {
      ...stampCreate(input, options.actor),
      id,
    };

    return {
      ...current,
      agents: [...current.agents, nextAgent],
    };
  }, { expectedVersion: options.version });

  return dashboard.agents.at(-1) ?? null;
}

export async function updateAgent(
  id: string,
  input: UpdateAgentInput,
  options: MutationOptions
) {
  let updated: Agent | null = null;

  await writeDashboard((current) => {
    const index = current.agents.findIndex((agent) => agent.id === id);
    if (index === -1) {
      return current;
    }

    const nextAgents = [...current.agents];
    updated = stampUpdate(touchAgent(nextAgents[index], input), options.actor);
    nextAgents[index] = updated;

    return {
      ...current,
      agents: nextAgents,
    };
  }, { expectedVersion: options.version });

  return updated;
}

export async function deleteAgent(id: string, options: MutationOptions) {
  let deleted = false;

  await writeDashboard((current) => {
    const nextAgents = current.agents.filter((agent) => agent.id !== id);
    if (nextAgents.length === current.agents.length) {
      return current;
    }

    deleted = true;
    return {
      ...current,
      agents: nextAgents,
      tasks: current.tasks.map((task) =>
        task.owner === current.agents.find((agent) => agent.id === id)?.name
          ? { ...task, owner: "Unassigned" }
          : task
      ),
    };
  }, { expectedVersion: options.version });

  return deleted;
}

export async function listTasks() {
  const dashboard = await readDashboard();
  return dashboard.tasks;
}

export async function getTask(id: string) {
  const dashboard = await readDashboard();
  return dashboard.tasks.find((task) => task.id === id) ?? null;
}

export async function createTask(input: CreateTaskInput, options: MutationOptions) {
  const dashboard = await writeDashboard((current) => {
    const ids = new Set(current.tasks.map((task) => task.id));
    const id = input.id && !ids.has(input.id)
      ? input.id
      : uniqueId("task", input.label, ids);

    const nextTask: TaskItem = {
      ...stampCreate(input, options.actor),
      id,
    };

    return {
      ...current,
      tasks: [...current.tasks, nextTask],
    };
  }, { expectedVersion: options.version });

  return dashboard.tasks.at(-1) ?? null;
}

export async function updateTask(
  id: string,
  input: UpdateTaskInput,
  options: MutationOptions
) {
  let updated: TaskItem | null = null;

  await writeDashboard((current) => {
    const index = current.tasks.findIndex((task) => task.id === id);
    if (index === -1) {
      return current;
    }

    const nextTasks = [...current.tasks];
    updated = stampUpdate({ ...nextTasks[index], ...input }, options.actor);
    nextTasks[index] = updated;

    return {
      ...current,
      tasks: nextTasks,
    };
  }, { expectedVersion: options.version });

  return updated;
}

export async function deleteTask(id: string, options: MutationOptions) {
  let deleted = false;

  await writeDashboard((current) => {
    const nextTasks = current.tasks.filter((task) => task.id !== id);
    if (nextTasks.length === current.tasks.length) {
      return current;
    }

    deleted = true;
    return {
      ...current,
      tasks: nextTasks,
    };
  }, { expectedVersion: options.version });

  return deleted;
}

export async function listEvents() {
  const dashboard = await readDashboard();
  return dashboard.events;
}

export async function getEvent(id: string) {
  const dashboard = await readDashboard();
  return dashboard.events.find((event) => event.id === id) ?? null;
}

export async function createEvent(input: CreateEventInput, options: MutationOptions) {
  const dashboard = await writeDashboard((current) => {
    const ids = new Set(current.events.map((event) => event.id));
    const id = input.id && !ids.has(input.id)
      ? input.id
      : uniqueId("event", input.title, ids);

    const nextEvent: EventItem = {
      ...stampCreate(input, options.actor),
      id,
    };

    return {
      ...current,
      events: [nextEvent, ...current.events],
    };
  }, { expectedVersion: options.version });

  return dashboard.events[0] ?? null;
}

export async function updateEvent(
  id: string,
  input: UpdateEventInput,
  options: MutationOptions
) {
  let updated: EventItem | null = null;

  await writeDashboard((current) => {
    const index = current.events.findIndex((event) => event.id === id);
    if (index === -1) {
      return current;
    }

    const nextEvents = [...current.events];
    updated = stampUpdate({ ...nextEvents[index], ...input }, options.actor);
    nextEvents[index] = updated;

    return {
      ...current,
      events: nextEvents,
    };
  }, { expectedVersion: options.version });

  return updated;
}

export async function deleteEvent(id: string, options: MutationOptions) {
  let deleted = false;

  await writeDashboard((current) => {
    const nextEvents = current.events.filter((event) => event.id !== id);
    if (nextEvents.length === current.events.length) {
      return current;
    }

    deleted = true;
    return {
      ...current,
      events: nextEvents,
    };
  }, { expectedVersion: options.version });

  return deleted;
}

export async function listContracts() {
  const dashboard = await readDashboard();
  return dashboard.contracts;
}

export async function getContract(id: string) {
  const dashboard = await readDashboard();
  return dashboard.contracts.find((contract) => contract.id === id) ?? null;
}

export async function createContract(
  input: CreateContractInput,
  options: MutationOptions
) {
  const dashboard = await writeDashboard((current) => {
    const ids = new Set(current.contracts.map((contract) => contract.id));
    const id = input.id && !ids.has(input.id)
      ? input.id
      : uniqueId("contract", input.team, ids);

    const nextContract: Contract = {
      ...stampCreate(input, options.actor),
      id,
    };

    return {
      ...current,
      contracts: [...current.contracts, nextContract],
    };
  }, { expectedVersion: options.version });

  return dashboard.contracts.at(-1) ?? null;
}

export async function updateContract(
  id: string,
  input: UpdateContractInput,
  options: MutationOptions
) {
  let updated: Contract | null = null;

  await writeDashboard((current) => {
    const index = current.contracts.findIndex((contract) => contract.id === id);
    if (index === -1) {
      return current;
    }

    const nextContracts = [...current.contracts];
    updated = stampUpdate({ ...nextContracts[index], ...input }, options.actor);
    nextContracts[index] = updated;

    return {
      ...current,
      contracts: nextContracts,
    };
  }, { expectedVersion: options.version });

  return updated;
}

export async function deleteContract(id: string, options: MutationOptions) {
  let deleted = false;

  await writeDashboard((current) => {
    const nextContracts = current.contracts.filter((contract) => contract.id !== id);
    if (nextContracts.length === current.contracts.length) {
      return current;
    }

    deleted = true;
    return {
      ...current,
      contracts: nextContracts,
    };
  }, { expectedVersion: options.version });

  return deleted;
}
