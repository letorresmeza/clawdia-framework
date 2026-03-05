import { IdentityRuntime, ContractEngine } from "@clawdia/core";
import type { IClawBus } from "@clawdia/core";
import { ServiceRegistry } from "@clawdia/orchestrator";
import type { AgentIdentity, TaskContract, RegistryQuery } from "@clawdia/types";

// ─────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────

export interface HireOptions {
  /** Name of the agent to hire (must be in registry) */
  agentName: string;
  /** Capability taxonomy to invoke */
  capability: string;
  /** Input data for the task */
  input: unknown;
  /** Payment terms */
  payment: { amount: number; currency: string };
  /** SLA — defaults to 30 s deadline, 1 retry */
  sla?: { deadlineMs: number; maxRetries: number };
}

export interface HireResult {
  /** The settled contract ID */
  contractId: string;
  /** Output returned by the provider */
  output: unknown;
  /** Wall-clock milliseconds from hire() call to settlement */
  durationMs: number;
}

export interface AgentTask {
  /** Full task contract */
  contract: TaskContract;
  /** Convenience alias for contract.input */
  input: unknown;
  /** Context helpers scoped to this agent */
  ctx: AgentContext;
}

export interface AgentContext {
  /** This agent's identity */
  readonly identity: AgentIdentity;
  /** Hire another agent for a subtask (blocks until settled) */
  hire(opts: HireOptions): Promise<HireResult>;
  /** Discover agents matching a taxonomy (supports * wildcard) */
  discover(taxonomy: string, opts?: { maxPrice?: number; currency?: string }): AgentIdentity[];
  /** Emit a log message (printed to stdout in dev) */
  log(message: string, level?: "info" | "warning" | "error"): void;
}

export interface CreateAgentOptions {
  /**
   * soul.md manifest content (YAML string).
   * For file loading, pass the content directly (use fs.readFileSync outside).
   */
  soulMd: string;
  /** A connected IClawBus instance */
  bus: IClawBus;
  /** Shared service registry — creates a new one if omitted */
  registry?: ServiceRegistry;
  /** Shared contract engine — creates a new one if omitted */
  contracts?: ContractEngine;
  /** Called for each task contract where this agent is the provider */
  onTask?: (task: AgentTask) => Promise<unknown>;
  /** Error handler — defaults to console.error */
  onError?: (err: Error, context?: string) => void;
}

// ─────────────────────────────────────────────────────────
// AgentHandle — returned by createAgent()
// ─────────────────────────────────────────────────────────

export class AgentHandle {
  readonly identity: AgentIdentity;
  private readonly _subIds: string[];
  private readonly _bus: IClawBus;
  private readonly _registry: ServiceRegistry;
  private readonly _contracts: ContractEngine;

  constructor(
    identity: AgentIdentity,
    subIds: string[],
    bus: IClawBus,
    registry: ServiceRegistry,
    contracts: ContractEngine,
  ) {
    this.identity = identity;
    this._subIds = subIds;
    this._bus = bus;
    this._registry = registry;
    this._contracts = contracts;
  }

  /** Hire another agent for a subtask (full contract lifecycle) */
  hire(opts: HireOptions): Promise<HireResult> {
    return executeHire(opts, this.identity, this._bus, this._registry, this._contracts);
  }

  /** Discover agents by taxonomy */
  discover(taxonomy: string, opts?: { maxPrice?: number; currency?: string }): AgentIdentity[] {
    const { entries } = this._registry.discover({ taxonomy, ...opts });
    return entries.map((e) => e.identity);
  }

  /** Deregister from registry and unsubscribe from bus */
  async stop(): Promise<void> {
    for (const id of this._subIds) {
      this._bus.unsubscribe(id);
    }
    this._registry.deregister(this.identity.name);
  }
}

// ─────────────────────────────────────────────────────────
// createAgent() — the main SDK entry point
// ─────────────────────────────────────────────────────────

/**
 * Create and register a Clawdia agent from a soul.md manifest.
 *
 * Minimal usage — under 10 lines:
 *
 * ```ts
 * const agent = await createAgent({
 *   soulMd: fs.readFileSync("soul.md", "utf-8"),
 *   bus,
 *   registry,
 *   contracts,
 *   async onTask({ input, ctx }) {
 *     return { result: await doWork(input) };
 *   },
 * });
 * ```
 */
export async function createAgent(opts: CreateAgentOptions): Promise<AgentHandle> {
  const identityRuntime = new IdentityRuntime();
  const identity = await identityRuntime.register(opts.soulMd);

  const registry = opts.registry ?? new ServiceRegistry(opts.bus);
  const contracts = opts.contracts ?? new ContractEngine(opts.bus);

  // Register in the service registry
  registry.register(identity);

  const subIds: string[] = [];

  if (opts.onTask) {
    const handler = opts.onTask;
    const onError =
      opts.onError ??
      ((err: Error, ctx?: string) =>
        console.error(`[${identity.name}] error${ctx ? ` in ${ctx}` : ""}:`, err.message));

    const ctx: AgentContext = {
      identity,
      hire: (hireOpts) => executeHire(hireOpts, identity, opts.bus, registry, contracts),
      discover: (taxonomy, dOpts) => {
        const { entries } = registry.discover({ taxonomy, ...dOpts });
        return entries.map((e) => e.identity);
      },
      log: (msg, level = "info") => {
        const prefix = level === "error" ? "✗" : level === "warning" ? "⚠" : "·";
        console.log(`  ${prefix} [${identity.name}] ${msg}`);
      },
    };

    // Trigger onTask whenever this agent's contract moves to in_progress (FUND event)
    const subId = opts.bus.subscribe("task.request", async (msg) => {
      const payload = msg.payload as {
        contractId?: string;
        event?: string;
        newState?: string;
      };

      if (payload.event !== "FUND" || payload.newState !== "in_progress") return;
      if (!payload.contractId) return;

      const contract = contracts.get(payload.contractId);
      if (!contract || contract.provider?.name !== identity.name) return;

      try {
        const output = await handler({ contract, input: contract.input, ctx });
        contracts.setOutput(contract.id, output);
        await contracts.transition(contract.id, "DELIVER", identity.name);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        onError(error, `contract ${contract.id}`);
        try {
          await contracts.transition(contract.id, "FAIL", identity.name);
        } catch {
          // contract may already be in a terminal state
        }
      }
    });

    subIds.push(subId);
  }

  return new AgentHandle(identity, subIds, opts.bus, registry, contracts);
}

// ─────────────────────────────────────────────────────────
// executeHire() — full contract lifecycle in one call
// ─────────────────────────────────────────────────────────

async function executeHire(
  opts: HireOptions,
  requester: AgentIdentity,
  bus: IClawBus,
  registry: ServiceRegistry,
  contracts: ContractEngine,
): Promise<HireResult> {
  const entry = registry.get(opts.agentName);
  if (!entry) {
    throw new Error(
      `Agent "${opts.agentName}" not found in registry. ` +
        `Online agents: ${registry
          .list()
          .filter((e) => e.status !== "offline")
          .map((e) => e.identity.name)
          .join(", ") || "none"}`,
    );
  }

  const cap = entry.identity.capabilities.find((c) => c.taxonomy === opts.capability);
  if (!cap) {
    throw new Error(
      `Agent "${opts.agentName}" does not provide "${opts.capability}". ` +
        `Available: ${entry.identity.capabilities.map((c) => c.taxonomy).join(", ")}`,
    );
  }

  const sla = opts.sla ?? { deadlineMs: 30_000, maxRetries: 1 };

  const contract = contracts.create({
    requester,
    provider: entry.identity,
    capability: opts.capability,
    inputSchema: cap.inputSchema,
    outputSchema: cap.outputSchema,
    input: opts.input,
    payment: { amount: opts.payment.amount, currency: opts.payment.currency },
    sla,
    verification: { method: "schema_match" },
  });

  const startMs = Date.now();

  // Listen for DELIVER before triggering FUND, so we never miss it
  const deliveryPromise = new Promise<unknown>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      bus.unsubscribe(deliverSubId);
      reject(new Error(`hire() timed out after ${sla.deadlineMs}ms (contract: ${contract.id})`));
    }, sla.deadlineMs);

    const deliverSubId = bus.subscribe("task.request", async (msg) => {
      const payload = msg.payload as { contractId?: string; event?: string };
      if (payload.contractId !== contract.id) return;

      if (payload.event === "DELIVER") {
        clearTimeout(timeoutId);
        bus.unsubscribe(deliverSubId);
        resolve(contracts.get(contract.id)?.output ?? null);
      } else if (payload.event === "FAIL") {
        clearTimeout(timeoutId);
        bus.unsubscribe(deliverSubId);
        reject(new Error(`Contract ${contract.id} failed during provider execution`));
      }
    });
  });

  // Drive the lifecycle: OFFER → ACCEPT → FUND (triggers provider)
  await contracts.transition(contract.id, "OFFER", requester.name);
  await contracts.transition(contract.id, "ACCEPT", entry.identity.name);
  await contracts.transition(contract.id, "FUND", requester.name);

  // Wait for provider to DELIVER
  const output = await deliveryPromise;

  // Verify and settle
  await contracts.transition(contract.id, "VERIFY", requester.name);
  await contracts.transition(contract.id, "SETTLE", requester.name);

  return { contractId: contract.id, output, durationMs: Date.now() - startMs };
}
