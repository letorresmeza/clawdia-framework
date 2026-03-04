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
// Contract Engine
// ─────────────────────────────────────────────────────────

export class ContractEngine {
  private contracts = new Map<string, TaskContract>();

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
   */
  async transition(
    contractId: string,
    event: ContractEvent,
    triggeredBy: string,
    metadata?: Record<string, unknown>,
  ): Promise<TaskContract> {
    const contract = this.contracts.get(contractId);
    if (!contract) {
      throw new Error(`Contract "${contractId}" not found`);
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

    // Update contract
    contract.state = nextState;
    contract.updatedAt = historyEntry.timestamp;
    contract.history.push(historyEntry);

    // Publish state change to ClawBus
    await this.bus.publish(
      "task.request",
      {
        contractId: contract.id,
        event,
        previousState: currentState,
        newState: nextState,
        triggeredBy,
      },
      contract.requester,
      { correlationId: contract.id },
    );

    return { ...contract };
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
}
