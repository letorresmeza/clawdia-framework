import { v7 as uuid } from "uuid";
import type {
  UsageRecord,
  Invoice,
  InvoiceLineItem,
  TaskContract,
  ClawMessage,
  AgentIdentity,
} from "@clawdia/types";
import type { IClawBus } from "@clawdia/core";

export interface BillingConfig {
  /** Platform transaction fee percentage. Default 3 */
  transactionFeePercent: number;
  /** Default currency for billing. Default "USDC" */
  defaultCurrency: string;
}

const DEFAULT_CONFIG: BillingConfig = {
  transactionFeePercent: 3,
  defaultCurrency: "USDC",
};

const SYSTEM_IDENTITY: AgentIdentity = {
  name: "billing-engine",
  displayName: "Billing Engine",
  description: "Meters usage and generates invoices",
  version: "1.0.0",
  operator: "system",
  publicKey: "system",
  capabilities: [],
  requirements: [],
  runtime: {},
};

export class BillingEngine {
  private records: UsageRecord[] = [];
  private invoices = new Map<string, Invoice>();
  private agentOperators = new Map<string, string>(); // agentName → operator
  private config: BillingConfig;
  private subscriptionIds: string[] = [];

  constructor(
    private bus: IClawBus,
    config?: Partial<BillingConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Start listening to bus events for auto-metering */
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

  /** Register an agent's operator for invoice grouping */
  registerOperator(agentName: string, operator: string): void {
    this.agentOperators.set(agentName, operator);
  }

  /** Record a usage event */
  recordUsage(opts: {
    agentName: string;
    resourceType: string;
    quantity: number;
    unit: string;
    cost: number;
    currency?: string;
    contractId?: string;
    metadata?: Record<string, unknown>;
  }): UsageRecord {
    const record: UsageRecord = {
      id: uuid(),
      agentName: opts.agentName,
      resourceType: opts.resourceType,
      quantity: opts.quantity,
      unit: opts.unit,
      cost: opts.cost,
      currency: opts.currency ?? this.config.defaultCurrency,
      timestamp: new Date().toISOString(),
      contractId: opts.contractId,
      metadata: opts.metadata,
    };
    this.records.push(record);
    return { ...record };
  }

  /** Meter a task execution — creates usage records for duration, tokens, cost */
  meterTaskExecution(
    contract: TaskContract,
    metrics: { durationMs: number; tokensUsed?: number; cost: number },
  ): UsageRecord[] {
    const agentName = contract.provider?.name ?? contract.requester.name;
    const created: UsageRecord[] = [];

    // Duration record
    created.push(
      this.recordUsage({
        agentName,
        resourceType: "compute_ms",
        quantity: metrics.durationMs,
        unit: "ms",
        cost: 0,
        contractId: contract.id,
      }),
    );

    // Tokens record (if applicable)
    if (metrics.tokensUsed !== undefined && metrics.tokensUsed > 0) {
      created.push(
        this.recordUsage({
          agentName,
          resourceType: "tokens",
          quantity: metrics.tokensUsed,
          unit: "tokens",
          cost: 0,
          contractId: contract.id,
        }),
      );
    }

    // Cost record
    created.push(
      this.recordUsage({
        agentName,
        resourceType: "task_cost",
        quantity: 1,
        unit: "task",
        cost: metrics.cost,
        currency: contract.payment.currency,
        contractId: contract.id,
      }),
    );

    return created;
  }

  /** Get usage records for an agent, optionally filtered by time range */
  getUsageByAgent(
    agentName: string,
    opts?: { from?: string; to?: string },
  ): UsageRecord[] {
    let results = this.records.filter((r) => r.agentName === agentName);
    if (opts?.from) {
      const from = new Date(opts.from).getTime();
      results = results.filter((r) => new Date(r.timestamp).getTime() >= from);
    }
    if (opts?.to) {
      const to = new Date(opts.to).getTime();
      results = results.filter((r) => new Date(r.timestamp).getTime() <= to);
    }
    return results.map((r) => ({ ...r }));
  }

  /** Get usage records by operator (aggregates all agents for that operator) */
  getUsageByOperator(operator: string): UsageRecord[] {
    const agentNames = new Set<string>();
    for (const [name, op] of this.agentOperators) {
      if (op === operator) agentNames.add(name);
    }
    return this.records
      .filter((r) => agentNames.has(r.agentName))
      .map((r) => ({ ...r }));
  }

  /** Generate an invoice for an operator over a time period */
  generateInvoice(
    operator: string,
    period: { start: string; end: string },
  ): Invoice {
    const fromTime = new Date(period.start).getTime();
    const toTime = new Date(period.end).getTime();

    // Get all agent names for this operator
    const agentNames = new Set<string>();
    for (const [name, op] of this.agentOperators) {
      if (op === operator) agentNames.add(name);
    }

    // Filter records in period for this operator's agents
    const periodRecords = this.records.filter(
      (r) =>
        agentNames.has(r.agentName) &&
        new Date(r.timestamp).getTime() >= fromTime &&
        new Date(r.timestamp).getTime() <= toTime &&
        r.cost > 0,
    );

    // Group by agent + resourceType
    const groups = new Map<string, UsageRecord[]>();
    for (const record of periodRecords) {
      const key = `${record.agentName}:${record.resourceType}`;
      const group = groups.get(key) ?? [];
      group.push(record);
      groups.set(key, group);
    }

    // Build line items
    const lineItems: InvoiceLineItem[] = [];
    for (const [, records] of groups) {
      const first = records[0]!;
      const totalQuantity = records.reduce((sum, r) => sum + r.quantity, 0);
      const totalCost = records.reduce((sum, r) => sum + r.cost, 0);

      lineItems.push({
        description: `${first.resourceType} usage`,
        agentName: first.agentName,
        resourceType: first.resourceType,
        quantity: totalQuantity,
        unitPrice: totalQuantity > 0 ? totalCost / totalQuantity : 0,
        total: totalCost,
      });
    }

    const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0);
    const fee = this.calculatePlatformFee(subtotal);

    const invoice: Invoice = {
      id: uuid(),
      operator,
      period,
      lineItems,
      total: subtotal + fee,
      currency: this.config.defaultCurrency,
      status: "draft",
      createdAt: new Date().toISOString(),
    };

    this.invoices.set(invoice.id, invoice);
    return { ...invoice, lineItems: [...lineItems] };
  }

  /** Calculate platform fee */
  calculatePlatformFee(amount: number): number {
    return (amount * this.config.transactionFeePercent) / 100;
  }

  /** Get an invoice by ID */
  getInvoice(id: string): Invoice | undefined {
    const inv = this.invoices.get(id);
    return inv ? { ...inv, lineItems: [...inv.lineItems] } : undefined;
  }

  /** List all invoices */
  listInvoices(): Invoice[] {
    return Array.from(this.invoices.values()).map((inv) => ({
      ...inv,
      lineItems: [...inv.lineItems],
    }));
  }

  /** List all usage records */
  listRecords(): UsageRecord[] {
    return this.records.map((r) => ({ ...r }));
  }

  /** Get aggregate stats */
  stats(): {
    totalRecords: number;
    totalRevenue: number;
    totalFees: number;
    invoiceCount: number;
  } {
    const totalRevenue = this.records.reduce((sum, r) => sum + r.cost, 0);
    const totalFees = this.calculatePlatformFee(totalRevenue);
    return {
      totalRecords: this.records.length,
      totalRevenue,
      totalFees,
      invoiceCount: this.invoices.size,
    };
  }

  private async onSettlementComplete(msg: ClawMessage): Promise<void> {
    const payload = msg.payload as {
      contractId?: string;
      action?: string;
      amount?: number;
      currency?: string;
      contract?: TaskContract;
    };

    if (payload.action === "release" && payload.contract) {
      const contract = payload.contract;
      // Meter the settlement as a billing record
      this.recordUsage({
        agentName: contract.provider?.name ?? contract.requester.name,
        resourceType: "settlement",
        quantity: 1,
        unit: "transaction",
        cost: payload.amount ?? contract.payment.amount,
        currency: payload.currency ?? contract.payment.currency,
        contractId: contract.id,
      });
    }
  }
}
