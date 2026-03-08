import { v7 as uuid } from "uuid";
import type {
  TaskContract,
  ContractState,
  ContractEvent,
  ContractHistoryEntry,
  CreateContractSpec,
  AgentIdentity,
} from "@clawdia/types";
import type { IClawBus } from "../bus/clawbus.js";

// ─────────────────────────────────────────────────────────
// Valid state transitions
// ─────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<ContractState, Partial<Record<ContractEvent, ContractState>>> = {
  draft: { OFFER: "offered", CANCEL: "cancelled" },
  offered: { ACCEPT: "accepted", CANCEL: "cancelled", TIMEOUT: "cancelled" },
  accepted: { FUND: "in_progress", CANCEL: "cancelled", TIMEOUT: "cancelled" },
  in_progress: { DELIVER: "delivered", FAIL: "disputed", TIMEOUT: "disputed" },
  delivered: { VERIFY: "verified", REJECT: "disputed" },
  verified: { SETTLE: "settled" },
  disputed: { RESOLVE: "settled", CANCEL: "cancelled" },
  settled: {},
  cancelled: {},
};

// ─────────────────────────────────────────────────────────
// ConflictError — thrown on optimistic concurrency version mismatch
// ─────────────────────────────────────────────────────────

export class ConflictError extends Error {
  readonly contractId: string;
  readonly expected: number;
  readonly actual: number;

  constructor(contractId: string, expected: number, actual: number) {
    super(
      `Conflict on contract "${contractId}": expected version ${expected}, actual version ${actual}`,
    );
    this.name = "ConflictError";
    this.contractId = contractId;
    this.expected = expected;
    this.actual = actual;
  }
}

// ─────────────────────────────────────────────────────────
// Contract Engine
// ─────────────────────────────────────────────────────────

export class ContractEngine {
  private contracts = new Map<string, TaskContract>();
  private locks = new Map<string, Promise<unknown>>();

  constructor(private bus: IClawBus) {}

  /**
   * Create a new Task Contract in "draft" state.
   */
  create(spec: Omit<CreateContractSpec, "history" | "signatures"> & {
    requester: AgentIdentity;
    provider?: AgentIdentity;
  }): TaskContract {
    const now = new Date().toISOString();
    const contract: TaskContract = {
      id: uuid(),
      state: "draft",
      version: 0,
      requester: spec.requester,
      provider: spec.provider,
      capability: spec.capability,
      inputSchema: spec.inputSchema,
      outputSchema: spec.outputSchema,
      input: spec.input,
      payment: spec.payment,
      sla: spec.sla,
      verification: spec.verification,
      signatures: {},
      createdAt: now,
      updatedAt: now,
      history: [],
    };

    this.contracts.set(contract.id, contract);
    return { ...contract };
  }

  /**
   * Transition a contract to a new state via an event.
   * Validates the transition, records history, and publishes to ClawBus.
   * Optionally accepts an expectedVersion for optimistic concurrency control.
   */
  async transition(
    contractId: string,
    event: ContractEvent,
    triggeredBy: string,
    metadata?: Record<string, unknown>,
    expectedVersion?: number,
  ): Promise<TaskContract> {
    // The lock guards only the state mutation. Publishing happens outside so
    // that InMemoryBus handlers (e.g. onTask calling transition again) cannot
    // deadlock waiting for the lock we already hold.
    interface PublishInfo {
      snapshot: TaskContract;
      requester: AgentIdentity;
      previousState: ContractState;
    }
    let publishInfo: PublishInfo | undefined;

    await this.withLock(contractId, async () => {
      const contract = this.contracts.get(contractId);
      if (!contract) {
        throw new Error(`Contract "${contractId}" not found`);
      }

      // Optimistic concurrency check
      if (expectedVersion !== undefined && contract.version !== expectedVersion) {
        throw new ConflictError(contractId, expectedVersion, contract.version);
      }

      const currentState = contract.state;
      const transitions = VALID_TRANSITIONS[currentState];
      const nextState = transitions?.[event];

      if (!nextState) {
        throw new Error(
          `Invalid transition: cannot apply "${event}" to contract in "${currentState}" state. ` +
          `Valid events: ${Object.keys(transitions ?? {}).join(", ") || "none (terminal state)"}`,
        );
      }

      // Record history
      const historyEntry: ContractHistoryEntry = {
        from: currentState,
        to: nextState,
        event,
        timestamp: new Date().toISOString(),
        triggeredBy,
        metadata,
      };

      // Mutate state atomically under the lock
      contract.state = nextState;
      contract.updatedAt = historyEntry.timestamp;
      contract.history.push(historyEntry);
      contract.version += 1;

      publishInfo = { snapshot: { ...contract }, requester: contract.requester, previousState: currentState };
    });

    if (!publishInfo) throw new Error(`Contract "${contractId}" not found`);

    // Publish AFTER the lock is released so bus handlers can re-enter transition()
    await this.bus.publish(
      "task.request",
      {
        contractId: publishInfo.snapshot.id,
        event,
        previousState: publishInfo.previousState,
        newState: publishInfo.snapshot.state,
        triggeredBy,
      },
      publishInfo.requester,
      { correlationId: publishInfo.snapshot.id },
    );

    return publishInfo.snapshot;
  }

  /**
   * Set the provider (accepting agent) on a contract.
   */
  setProvider(contractId: string, provider: AgentIdentity): void {
    const contract = this.contracts.get(contractId);
    if (!contract) throw new Error(`Contract "${contractId}" not found`);
    if (contract.state !== "offered") {
      throw new Error(`Can only set provider on "offered" contracts, current: "${contract.state}"`);
    }
    contract.provider = provider;
  }

  /**
   * Attach output data to a delivered contract.
   */
  setOutput(contractId: string, output: unknown): void {
    const contract = this.contracts.get(contractId);
    if (!contract) throw new Error(`Contract "${contractId}" not found`);
    contract.output = output;
  }

  /** Get a contract by ID */
  get(contractId: string): TaskContract | undefined {
    const c = this.contracts.get(contractId);
    return c ? { ...c } : undefined;
  }

  /** List all contracts, optionally filtered by state */
  list(filter?: { state?: ContractState; requester?: string; provider?: string }): TaskContract[] {
    let results = Array.from(this.contracts.values());

    if (filter?.state) {
      results = results.filter((c) => c.state === filter.state);
    }
    if (filter?.requester) {
      results = results.filter((c) => c.requester.name === filter.requester);
    }
    if (filter?.provider) {
      results = results.filter((c) => c.provider?.name === filter.provider);
    }

    return results.map((c) => ({ ...c }));
  }

  /** Get count of contracts by state */
  stats(): Record<ContractState, number> {
    const stats: Record<string, number> = {};
    for (const contract of this.contracts.values()) {
      stats[contract.state] = (stats[contract.state] ?? 0) + 1;
    }
    return stats as Record<ContractState, number>;
  }

  // ─── Per-contract async mutex ───

  private async withLock<T>(contractId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(contractId) ?? Promise.resolve();
    let resolve!: () => void;
    const next = new Promise<void>((r) => { resolve = r; });
    this.locks.set(contractId, next);
    try {
      await prev;
      return await fn();
    } finally {
      resolve();
      if (this.locks.get(contractId) === next) {
        this.locks.delete(contractId);
      }
    }
  }
}
