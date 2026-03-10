import { v7 as uuid } from "uuid";
import type {
  ReputationRecord,
  ReputationEvent,
  TaskContract,
  ClawMessage,
  AgentIdentity,
} from "@clawdia/types";
import type { IClawBus } from "@clawdia/core";

export interface ReputationConfig {
  /** Decay factor for older scores (0.0–1.0). Default 0.95 */
  decayFactor: number;
  /** Weight multiplier for recent performance. Default 2.0 */
  recentWeight: number;
  /** Minimum stake to participate (sybil protection). Default 10 */
  minimumStake: number;
  /** Currency for stake. Default "USDC" */
  stakeCurrency: string;
  /** Percent of stake slashed on failed contracts with SLA violations. Default 0.1 */
  slashRate: number;
}

const DEFAULT_CONFIG: ReputationConfig = {
  decayFactor: 0.95,
  recentWeight: 2.0,
  minimumStake: 10,
  stakeCurrency: "USDC",
  slashRate: 0.1,
};

type Dimension = "reliability" | "quality" | "speed" | "costEfficiency";

const SYSTEM_IDENTITY: AgentIdentity = {
  name: "reputation-engine",
  displayName: "Reputation Engine",
  description: "Tracks agent reputation",
  version: "1.0.0",
  operator: "system",
  publicKey: "system",
  capabilities: [],
  requirements: [],
  runtime: {},
};

export class ReputationEngine {
  private records = new Map<string, ReputationRecord>();
  private config: ReputationConfig;
  private subscriptionIds: string[] = [];

  constructor(
    private bus: IClawBus,
    config?: Partial<ReputationConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Start listening to bus events for auto-updates */
  start(): void {
    this.subscriptionIds.push(
      this.bus.subscribe("settlement.complete", this.onSettlementComplete.bind(this)),
    );
  }

  /** Stop listening */
  stop(): void {
    for (const id of this.subscriptionIds) {
      this.bus.unsubscribe(id);
    }
    this.subscriptionIds = [];
  }

  /** Initialize a new agent's reputation record */
  initAgent(agentName: string, stakedAmount?: number): ReputationRecord {
    const record: ReputationRecord = {
      agentName,
      overallScore: 0.5,
      dimensions: {
        reliability: 0.5,
        quality: 0.5,
        speed: 0.5,
        costEfficiency: 0.5,
      },
      contractsCompleted: 0,
      contractsFailed: 0,
      stakedAmount: stakedAmount ?? 0,
      stakeCurrency: this.config.stakeCurrency,
      history: [],
      updatedAt: new Date().toISOString(),
    };
    this.records.set(agentName, record);
    return { ...record };
  }

  /** Add stake to an agent's record. */
  stake(agentName: string, amount: number): ReputationRecord {
    if (amount <= 0) {
      throw new Error("Stake amount must be greater than 0");
    }

    let record = this.records.get(agentName);
    if (!record) {
      record = this.initAgent(agentName);
    }

    record.stakedAmount += amount;
    record.updatedAt = new Date().toISOString();
    return this.getRecord(agentName)!;
  }

  /** Remove unlocked stake from an agent's record. */
  unstake(agentName: string, amount: number): ReputationRecord {
    if (amount <= 0) {
      throw new Error("Unstake amount must be greater than 0");
    }

    const record = this.records.get(agentName);
    if (!record) {
      throw new Error(`Agent "${agentName}" not found`);
    }
    if (record.stakedAmount < amount) {
      throw new Error(`Agent "${agentName}" does not have enough stake`);
    }

    record.stakedAmount -= amount;
    record.updatedAt = new Date().toISOString();
    return this.getRecord(agentName)!;
  }

  /** Slash stake after an SLA failure or dispute ruling. */
  slashStake(agentName: string, amount: number, contractId: string, reason: string): ReputationRecord {
    if (amount <= 0) {
      throw new Error("Slash amount must be greater than 0");
    }

    let record = this.records.get(agentName);
    if (!record) {
      record = this.initAgent(agentName);
    }

    record.stakedAmount = Math.max(0, record.stakedAmount - amount);
    record.updatedAt = new Date().toISOString();
    record.history.push({
      contractId,
      dimension: "reliability",
      delta: -1,
      reason: `stake slashed: ${reason}`,
      timestamp: record.updatedAt,
    });
    return this.getRecord(agentName)!;
  }

  /**
   * Update an agent's reputation across dimensions.
   * Each dimension delta should be in range [-1.0, 1.0].
   */
  updateReputation(
    agentName: string,
    contractId: string,
    dimensions: Partial<Record<Dimension, number>>,
  ): void {
    let record = this.records.get(agentName);
    if (!record) {
      this.initAgent(agentName);
      record = this.records.get(agentName)!;
    }

    const now = new Date().toISOString();
    const { decayFactor, recentWeight } = this.config;

    for (const [dim, delta] of Object.entries(dimensions) as [Dimension, number][]) {
      if (delta === undefined) continue;

      const oldScore = record.dimensions[dim];
      // Apply decay to old score, add weighted delta
      const newScore = oldScore * decayFactor + delta * (1 - decayFactor) * recentWeight;
      record.dimensions[dim] = Math.max(0, Math.min(1, newScore));

      record.history.push({
        contractId,
        dimension: dim,
        delta,
        reason: `${dim} updated: ${delta > 0 ? "+" : ""}${delta.toFixed(2)}`,
        timestamp: now,
      });
    }

    // Recalculate overall score as average of dimensions
    const dims = record.dimensions;
    record.overallScore = (dims.reliability + dims.quality + dims.speed + dims.costEfficiency) / 4;
    record.updatedAt = now;
  }

  /** Process a settled contract — update both agents' reputation */
  recordSettledContract(contract: TaskContract): void {
    if (!contract.provider) return;

    const providerName = contract.provider.name;
    const requesterName = contract.requester.name;

    // Ensure records exist
    if (!this.records.has(providerName)) this.initAgent(providerName);
    if (!this.records.has(requesterName)) this.initAgent(requesterName);

    const providerRecord = this.records.get(providerName)!;
    providerRecord.contractsCompleted++;

    // Calculate dimensional deltas for provider
    const speedDelta = this.calculateSpeedDelta(contract);
    this.updateReputation(providerName, contract.id, {
      reliability: 1.0,
      quality: 0.5,
      speed: speedDelta,
      costEfficiency: 0.5,
    });

    // Requester gets a small reliability boost for completing contracts
    this.updateReputation(requesterName, contract.id, {
      reliability: 0.3,
    });
  }

  /** Process a failed contract — penalize provider reputation */
  recordFailedContract(contract: TaskContract): void {
    if (!contract.provider) return;

    const providerName = contract.provider.name;
    if (!this.records.has(providerName)) this.initAgent(providerName);

    const providerRecord = this.records.get(providerName)!;
    providerRecord.contractsFailed++;

    this.updateReputation(providerName, contract.id, {
      reliability: -1.0,
      quality: -0.5,
    });

    const slashAmount = providerRecord.stakedAmount * this.config.slashRate;
    if (slashAmount > 0) {
      this.slashStake(providerName, slashAmount, contract.id, "SLA violation");
    }
  }

  /** Check if an agent meets the minimum stake requirement */
  checkStake(agentName: string): boolean {
    const record = this.records.get(agentName);
    if (!record) return false;
    return record.stakedAmount >= this.config.minimumStake;
  }

  /** Get an agent's reputation record */
  getRecord(agentName: string): ReputationRecord | undefined {
    const r = this.records.get(agentName);
    return r ? { ...r, dimensions: { ...r.dimensions }, history: [...r.history] } : undefined;
  }

  /** List all reputation records */
  listRecords(): ReputationRecord[] {
    return Array.from(this.records.values()).map((r) => ({
      ...r,
      dimensions: { ...r.dimensions },
      history: [...r.history],
    }));
  }

  /** Get aggregate stats */
  stats(): { totalAgents: number; averageScore: number; aboveThreshold: number } {
    const records = Array.from(this.records.values());
    const totalAgents = records.length;
    const averageScore =
      totalAgents > 0 ? records.reduce((sum, r) => sum + r.overallScore, 0) / totalAgents : 0;
    const aboveThreshold = records.filter((r) => r.stakedAmount >= this.config.minimumStake).length;
    return { totalAgents, averageScore, aboveThreshold };
  }

  private calculateSpeedDelta(contract: TaskContract): number {
    // Check if delivered within SLA deadline
    const created = new Date(contract.createdAt).getTime();
    const updated = new Date(contract.updatedAt).getTime();
    const durationMs = updated - created;

    if (durationMs <= contract.sla.deadlineMs * 0.5) return 1.0; // Well within SLA
    if (durationMs <= contract.sla.deadlineMs) return 0.5; // Within SLA
    return -0.5; // Exceeded SLA
  }

  private async onSettlementComplete(msg: ClawMessage): Promise<void> {
    const payload = msg.payload as {
      contractId?: string;
      contract?: TaskContract;
      action?: string;
    };

    if (payload.contract && payload.action === "release") {
      this.recordSettledContract(payload.contract);
    }
  }
}
