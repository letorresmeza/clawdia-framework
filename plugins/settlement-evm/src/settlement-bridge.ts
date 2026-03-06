/**
 * SettlementBridge
 *
 * Subscribes to the ClawBus and drives on-chain escrow for every task contract:
 *
 *   ContractEngine FUND event (→ in_progress)
 *     → createEscrow() + fundEscrow()
 *
 *   ContractEngine SETTLE event (→ settled)
 *     → releaseEscrow()
 *
 *   ContractEngine FAIL / TIMEOUT event (→ disputed)
 *     → disputeEscrow()
 *
 * The bridge is intentionally stateless with respect to the contract engine —
 * it reacts to published bus events only, making it safe to restart.
 */

import type { IClawBus } from "@clawdia/core";
import type { ContractEngine } from "@clawdia/core";
import type { EscrowHandle } from "@clawdia/types";
import type { EvmSettlementRail } from "./evm-settlement.js";

export interface BridgeConfig {
  /** ClawBus instance to subscribe on */
  bus: IClawBus;
  /** ContractEngine to read contract details from */
  contracts: ContractEngine;
  /** EvmSettlementRail for on-chain operations */
  rail: EvmSettlementRail;
  /** Optional error handler — defaults to console.error */
  onError?: (err: Error, context: string) => void;
}

export class SettlementBridge {
  private readonly bus: IClawBus;
  private readonly contracts: ContractEngine;
  private readonly rail: EvmSettlementRail;
  private readonly onError: (err: Error, context: string) => void;

  /** In-flight EscrowHandle keyed by Clawdia contractId */
  private readonly handles = new Map<string, EscrowHandle>();

  private subscriptionIds: string[] = [];
  private running = false;

  constructor(config: BridgeConfig) {
    this.bus       = config.bus;
    this.contracts = config.contracts;
    this.rail      = config.rail;
    this.onError   = config.onError ?? ((err, ctx) => {
      console.error(`[SettlementBridge] ${ctx}:`, err.message);
    });
  }

  /** Start listening on the bus. Idempotent. */
  start(): void {
    if (this.running) return;
    this.running = true;

    const subId = this.bus.subscribe("task.request", async (msg) => {
      const payload = msg.payload as {
        contractId?: string;
        event?: string;
        newState?: string;
      };

      if (!payload.contractId || !payload.event) return;

      const { contractId, event, newState } = payload;

      try {
        if (event === "FUND" && newState === "in_progress") {
          await this._onFund(contractId);
        } else if (event === "SETTLE" && newState === "settled") {
          await this._onSettle(contractId);
        } else if ((event === "FAIL" || event === "TIMEOUT") && newState === "disputed") {
          await this._onDispute(contractId, event);
        }
      } catch (err) {
        this.onError(
          err instanceof Error ? err : new Error(String(err)),
          `handling ${event} for contract ${contractId}`,
        );
      }
    });

    this.subscriptionIds.push(subId);
  }

  /** Stop listening. */
  stop(): void {
    for (const id of this.subscriptionIds) {
      this.bus.unsubscribe(id);
    }
    this.subscriptionIds = [];
    this.running = false;
  }

  // ─── Event handlers ───────────────────────────────────────────────────────

  private async _onFund(contractId: string): Promise<void> {
    const contract = this.contracts.get(contractId);
    if (!contract) {
      throw new Error(`Contract ${contractId} not found in ContractEngine`);
    }
    if (!contract.provider) {
      throw new Error(`Contract ${contractId} has no provider set`);
    }

    // 1. Deploy escrow on-chain
    const handle = await this.rail.createEscrow(contract);

    // 2. Fund it (approve + fund())
    await this.rail.fundEscrow(handle, handle.amount);

    // Persist handle for later settlement
    this.handles.set(contractId, { ...handle, status: "funded" });

    console.log(
      `[SettlementBridge] Escrow funded on-chain: ${handle.id} ` +
      `(${Number(handle.amount) / 1e6} ${handle.currency})`,
    );
  }

  private async _onSettle(contractId: string): Promise<void> {
    const handle = this._requireHandle(contractId);
    const contract = this.contracts.get(contractId);
    const recipient = contract?.provider?.name ?? "unknown";

    const txHash = await this.rail.releaseEscrow(handle, recipient);
    this.handles.set(contractId, { ...handle, status: "released" });

    console.log(`[SettlementBridge] Escrow released: ${handle.id} (tx: ${txHash})`);
  }

  private async _onDispute(contractId: string, event: string): Promise<void> {
    const handle = this._requireHandle(contractId);

    await this.rail.disputeEscrow(handle, `Contract ${event.toLowerCase()} event`);
    this.handles.set(contractId, { ...handle, status: "disputed" });

    console.log(`[SettlementBridge] Escrow disputed: ${handle.id}`);
  }

  private _requireHandle(contractId: string): EscrowHandle {
    const handle = this.handles.get(contractId);
    if (!handle) {
      throw new Error(
        `No escrow handle for contract "${contractId}". ` +
        `Was the FUND event handled before SETTLE/FAIL?`,
      );
    }
    return handle;
  }

  /** Expose handles for testing / introspection */
  getHandle(contractId: string): EscrowHandle | undefined {
    return this.handles.get(contractId);
  }

  get isRunning(): boolean {
    return this.running;
  }
}
