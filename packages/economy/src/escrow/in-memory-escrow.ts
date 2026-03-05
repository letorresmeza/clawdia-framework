import { v7 as uuid } from "uuid";
import type {
  TaskContract,
  Dispute,
  DisputeEvidence,
  DisputeRuling,
  DisputeResolutionTier,
  EscrowHandle,
  ClawMessage,
  AgentIdentity,
} from "@clawdia/types";
import type { IClawBus } from "@clawdia/core";

type TxHash = string;

const SYSTEM_IDENTITY: AgentIdentity = {
  name: "escrow-engine",
  displayName: "Escrow Engine",
  description: "Manages payment escrow",
  version: "1.0.0",
  operator: "system",
  publicKey: "system",
  capabilities: [],
  requirements: [],
  runtime: {},
};

const TIER_ORDER: DisputeResolutionTier[] = ["automated", "arbitrator_agent", "human"];

export class InMemoryEscrow {
  private escrows = new Map<string, EscrowHandle>();
  private disputes = new Map<string, Dispute>();
  private balances = new Map<string, bigint>();
  private contractEscrowMap = new Map<string, string>(); // contractId → escrowId
  private subscriptionIds: string[] = [];

  constructor(private bus: IClawBus) {}

  /** Start listening to contract lifecycle events */
  start(): void {
    this.subscriptionIds.push(
      this.bus.subscribe("task.request", this.onContractTransition.bind(this)),
    );
  }

  /** Stop listening */
  stop(): void {
    for (const id of this.subscriptionIds) {
      this.bus.unsubscribe(id);
    }
    this.subscriptionIds = [];
  }

  /** Create an escrow for a contract */
  createEscrow(contract: TaskContract): EscrowHandle {
    const handle: EscrowHandle = {
      id: uuid(),
      contractId: contract.id,
      amount: BigInt(Math.round(contract.payment.amount * 1_000_000)), // Convert to micro-units
      currency: contract.payment.currency,
      status: "created",
    };
    this.escrows.set(handle.id, handle);
    this.contractEscrowMap.set(contract.id, handle.id);
    return { ...handle };
  }

  /** Fund the escrow — transitions to "funded" */
  async fundEscrow(handle: EscrowHandle, amount?: bigint): Promise<TxHash> {
    const escrow = this.escrows.get(handle.id);
    if (!escrow) throw new Error(`Escrow "${handle.id}" not found`);
    if (escrow.status !== "created") {
      throw new Error(`Cannot fund escrow in "${escrow.status}" status`);
    }

    escrow.status = "funded";
    if (amount !== undefined) escrow.amount = amount;

    const txHash = `0x${uuid().replace(/-/g, "")}`;

    await this.bus.publish(
      "settlement.request",
      {
        contractId: escrow.contractId,
        action: "fund",
        amount: Number(escrow.amount),
        currency: escrow.currency,
        escrowId: escrow.id,
      },
      SYSTEM_IDENTITY,
    );

    return txHash;
  }

  /** Release escrow to the recipient — transitions to "released" */
  async releaseEscrow(
    handle: EscrowHandle,
    recipient: string,
    contract?: TaskContract,
  ): Promise<TxHash> {
    const escrow = this.escrows.get(handle.id);
    if (!escrow) throw new Error(`Escrow "${handle.id}" not found`);
    if (escrow.status !== "funded") {
      throw new Error(`Cannot release escrow in "${escrow.status}" status`);
    }

    escrow.status = "released";

    // Credit recipient balance
    const current = this.balances.get(recipient) ?? 0n;
    this.balances.set(recipient, current + escrow.amount);

    const txHash = `0x${uuid().replace(/-/g, "")}`;

    await this.bus.publish(
      "settlement.complete",
      {
        contractId: escrow.contractId,
        action: "release",
        amount: Number(escrow.amount),
        currency: escrow.currency,
        recipient,
        escrowId: escrow.id,
        contract: contract ?? undefined,
      },
      SYSTEM_IDENTITY,
    );

    return txHash;
  }

  /** Initiate a dispute on an escrow */
  async disputeEscrow(handle: EscrowHandle, reason: string): Promise<Dispute> {
    const escrow = this.escrows.get(handle.id);
    if (!escrow) throw new Error(`Escrow "${handle.id}" not found`);
    if (escrow.status !== "funded") {
      throw new Error(`Cannot dispute escrow in "${escrow.status}" status`);
    }

    escrow.status = "disputed";

    const dispute: Dispute = {
      id: uuid(),
      contractId: escrow.contractId,
      initiatedBy: "system",
      reason,
      currentTier: "automated",
      evidence: [],
      createdAt: new Date().toISOString(),
    };

    this.disputes.set(dispute.id, dispute);

    await this.bus.publish(
      "escalation",
      {
        contractId: escrow.contractId,
        sessionId: "",
        reason: `Dispute: ${reason}`,
        severity: "warning" as const,
        context: { disputeId: dispute.id, escrowId: escrow.id },
      },
      SYSTEM_IDENTITY,
    );

    return { ...dispute };
  }

  /** Add evidence to a dispute */
  addEvidence(disputeId: string, evidence: DisputeEvidence): void {
    const dispute = this.disputes.get(disputeId);
    if (!dispute) throw new Error(`Dispute "${disputeId}" not found`);
    if (dispute.resolvedAt) throw new Error("Dispute already resolved");
    dispute.evidence.push(evidence);
  }

  /** Escalate a dispute to the next tier */
  async escalateDispute(disputeId: string): Promise<DisputeResolutionTier> {
    const dispute = this.disputes.get(disputeId);
    if (!dispute) throw new Error(`Dispute "${disputeId}" not found`);
    if (dispute.resolvedAt) throw new Error("Dispute already resolved");

    const currentIdx = TIER_ORDER.indexOf(dispute.currentTier);
    if (currentIdx >= TIER_ORDER.length - 1) {
      throw new Error("Already at highest escalation tier");
    }

    const nextTier = TIER_ORDER[currentIdx + 1]!;
    dispute.currentTier = nextTier;

    const severity = nextTier === "human" ? "critical" : "warning";
    await this.bus.publish(
      "escalation",
      {
        contractId: dispute.contractId,
        sessionId: "",
        reason: `Dispute escalated to ${nextTier}: ${dispute.reason}`,
        severity: severity as "warning" | "critical",
        context: { disputeId: dispute.id, tier: nextTier },
      },
      SYSTEM_IDENTITY,
    );

    return nextTier;
  }

  /** Resolve a dispute with a ruling */
  async resolveDispute(disputeId: string, ruling: DisputeRuling): Promise<void> {
    const dispute = this.disputes.get(disputeId);
    if (!dispute) throw new Error(`Dispute "${disputeId}" not found`);
    if (dispute.resolvedAt) throw new Error("Dispute already resolved");

    dispute.ruling = ruling;
    dispute.resolvedAt = new Date().toISOString();

    // Find the escrow
    const escrowId = this.contractEscrowMap.get(dispute.contractId);
    if (!escrowId) return;
    const escrow = this.escrows.get(escrowId);
    if (!escrow) return;

    if (ruling.decision === "requester_wins") {
      // Refund to requester
      escrow.status = "refunded";
    } else if (ruling.decision === "provider_wins") {
      // Release to provider — handled externally
      escrow.status = "released";
    } else if (ruling.decision === "split") {
      // Split funds
      const splitPercent = ruling.splitPercent ?? 50;
      const requesterAmount = (escrow.amount * BigInt(splitPercent)) / 100n;
      const providerAmount = escrow.amount - requesterAmount;

      // Credit both parties (simplified: store under their names)
      const reqBalance = this.balances.get("requester") ?? 0n;
      const provBalance = this.balances.get("provider") ?? 0n;
      this.balances.set("requester", reqBalance + requesterAmount);
      this.balances.set("provider", provBalance + providerAmount);

      escrow.status = "released";
    }

    await this.bus.publish(
      "settlement.complete",
      {
        contractId: dispute.contractId,
        action: "dispute_resolved",
        decision: ruling.decision,
        amount: Number(escrow.amount),
        currency: escrow.currency,
      },
      SYSTEM_IDENTITY,
    );
  }

  /** Get escrow by ID */
  getEscrow(id: string): EscrowHandle | undefined {
    const e = this.escrows.get(id);
    return e ? { ...e } : undefined;
  }

  /** Get escrow by contract ID */
  getEscrowByContract(contractId: string): EscrowHandle | undefined {
    const escrowId = this.contractEscrowMap.get(contractId);
    if (!escrowId) return undefined;
    return this.getEscrow(escrowId);
  }

  /** Get dispute by ID */
  getDispute(id: string): Dispute | undefined {
    const d = this.disputes.get(id);
    return d ? { ...d, evidence: [...d.evidence] } : undefined;
  }

  /** Get balance for an address */
  getBalance(address: string): bigint {
    return this.balances.get(address) ?? 0n;
  }

  /** Set balance for testing */
  setBalance(address: string, amount: bigint): void {
    this.balances.set(address, amount);
  }

  /** List all escrows */
  listEscrows(): EscrowHandle[] {
    return Array.from(this.escrows.values()).map((e) => ({ ...e }));
  }

  /** List all disputes */
  listDisputes(): Dispute[] {
    return Array.from(this.disputes.values()).map((d) => ({
      ...d,
      evidence: [...d.evidence],
    }));
  }

  /** Get aggregate stats */
  stats(): {
    totalEscrows: number;
    funded: number;
    released: number;
    disputed: number;
    totalValue: number;
  } {
    const escrows = Array.from(this.escrows.values());
    return {
      totalEscrows: escrows.length,
      funded: escrows.filter((e) => e.status === "funded").length,
      released: escrows.filter((e) => e.status === "released").length,
      disputed: escrows.filter((e) => e.status === "disputed").length,
      totalValue: escrows.reduce((sum, e) => sum + Number(e.amount), 0),
    };
  }

  private async onContractTransition(msg: ClawMessage): Promise<void> {
    const payload = msg.payload as {
      contractId?: string;
      event?: string;
      newState?: string;
    };

    if (!payload.contractId || !payload.event) return;

    if (payload.event === "FUND" && payload.newState === "in_progress") {
      // Auto-create and fund escrow if not already exists
      const existing = this.contractEscrowMap.get(payload.contractId);
      if (!existing) {
        // We don't have the full contract here, create a minimal escrow
        const handle: EscrowHandle = {
          id: uuid(),
          contractId: payload.contractId,
          amount: 0n,
          currency: "USDC",
          status: "created",
        };
        this.escrows.set(handle.id, handle);
        this.contractEscrowMap.set(payload.contractId, handle.id);
        handle.status = "funded";
      }
    } else if (payload.event === "FAIL" && payload.newState === "disputed") {
      const escrowId = this.contractEscrowMap.get(payload.contractId);
      if (escrowId) {
        const escrow = this.escrows.get(escrowId);
        if (escrow && escrow.status === "funded") {
          await this.disputeEscrow(escrow, "Contract failed");
        }
      }
    }
  }
}
