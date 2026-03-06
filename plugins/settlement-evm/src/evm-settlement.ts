import { ethers } from "ethers";
import type { TaskContract, EscrowHandle, ISettlementRail, TxHash } from "@clawdia/types";
import {
  ESCROW_FACTORY_ABI,
  CLAWDIA_ESCROW_ABI,
  ERC20_ABI,
  EscrowOnChainState,
} from "./abis.js";

// ─────────────────────────────────────────────────────────
// Typed contract interfaces (narrows ethers.Contract generics)
// ─────────────────────────────────────────────────────────

interface IEscrowFactory {
  readonly interface: ethers.Interface;
  getEscrow(contractId: string): Promise<string>;
  createEscrow(
    contractId: string,
    requester: string,
    provider: string,
    amount: bigint,
  ): Promise<ethers.ContractTransactionResponse>;
}

interface IClawdiaEscrow {
  fund(): Promise<ethers.ContractTransactionResponse>;
  release(): Promise<ethers.ContractTransactionResponse>;
  dispute(reason: string): Promise<ethers.ContractTransactionResponse>;
}

interface IERC20 {
  approve(spender: string, amount: bigint): Promise<ethers.ContractTransactionResponse>;
  balanceOf(account: string): Promise<bigint>;
}

// ─────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────

export interface EvmSettlementConfig {
  /** ethers.js Signer (requester wallet — funds all escrows) */
  signer: ethers.Signer;
  /** EscrowFactory contract address on the target chain */
  factoryAddress: string;
  /** USDC contract address on the target chain */
  usdcAddress: string;
  /**
   * Map agent name → EVM wallet address for payment routing.
   * If an agent is not in the map, the signer's address is used.
   */
  addressBook?: Record<string, string>;
  /**
   * USDC decimals — default 6 (matches USDC on all EVM chains)
   */
  usdcDecimals?: number;
}

// ─────────────────────────────────────────────────────────
// EvmSettlementRail
// ─────────────────────────────────────────────────────────

export class EvmSettlementRail implements ISettlementRail {
  readonly name = "evm-settlement";

  private readonly signer: ethers.Signer;
  private readonly factory: IEscrowFactory;
  private readonly usdc: IERC20;
  private readonly addressBook: Record<string, string>;
  private readonly usdcDecimals: number;

  /** In-memory map: Clawdia contractId → on-chain escrow address */
  private readonly escrowAddresses = new Map<string, string>();

  constructor(config: EvmSettlementConfig) {
    this.signer       = config.signer;
    this.addressBook  = config.addressBook ?? {};
    this.usdcDecimals = config.usdcDecimals ?? 6;

    this.factory = new ethers.Contract(config.factoryAddress, ESCROW_FACTORY_ABI, this.signer) as unknown as IEscrowFactory;
    this.usdc    = new ethers.Contract(config.usdcAddress,    ERC20_ABI,           this.signer) as unknown as IERC20;
  }

  // ─── ISettlementRail ─────────────────────────────────────────────────────

  /**
   * Deploy an on-chain ClawdiaEscrow for the given task contract.
   * Called when the contract transitions to `offered` or at `in_progress`.
   */
  async createEscrow(contract: TaskContract): Promise<EscrowHandle> {
    const contractId32 = this._toBytes32(contract.id);
    const requesterAddr = await this.signer.getAddress();
    const providerAddr  = this._resolveAddress(contract.provider?.name ?? "unknown");
    const amount        = this._toUsdcUnits(contract.payment.amount);

    // Idempotent — return existing if already created
    const existing = await this.factory.getEscrow(contractId32) as string;
    if (existing !== ethers.ZeroAddress) {
      this.escrowAddresses.set(contract.id, existing);
      return {
        id: existing,
        contractId: contract.id,
        amount,
        currency: contract.payment.currency,
        status: "created",
      };
    }

    const tx = await this.factory.createEscrow(
      contractId32,
      requesterAddr,
      providerAddr,
      amount,
    );
    const receipt = await tx.wait();
    if (!receipt) {
      throw new Error("createEscrow: transaction receipt not available");
    }

    // Parse EscrowCreated event to get deployed address
    let escrowAddress = "";
    for (const log of receipt.logs) {
      try {
        const parsed = this.factory.interface.parseLog(log);
        if (parsed?.name === "EscrowCreated") {
          escrowAddress = parsed.args[1] as string;
          break;
        }
      } catch { /* skip non-matching logs */ }
    }

    if (!escrowAddress) {
      throw new Error(`createEscrow: EscrowCreated event not found in tx ${receipt.hash}`);
    }

    this.escrowAddresses.set(contract.id, escrowAddress);

    return {
      id: escrowAddress,
      contractId: contract.id,
      amount,
      currency: contract.payment.currency,
      status: "created",
    };
  }

  /**
   * Approve USDC and call fund() on the escrow — moves funds on-chain.
   */
  async fundEscrow(handle: EscrowHandle, amount: bigint): Promise<TxHash> {
    const escrowAddr = this._getEscrowAddress(handle);
    const escrow     = this._buildEscrowContract(escrowAddr);

    // Approve factory to pull USDC from this signer
    const approveTx = await this.usdc.approve(escrowAddr, amount);
    await approveTx.wait();

    const fundTx = await escrow.fund();
    const receipt = await fundTx.wait();
    if (!receipt) throw new Error("fundEscrow: transaction receipt not available");
    return receipt.hash as TxHash;
  }

  /**
   * Call release() on the escrow — sends USDC to the provider.
   */
  async releaseEscrow(handle: EscrowHandle, _recipient: string): Promise<TxHash> {
    const escrowAddr = this._getEscrowAddress(handle);
    const escrow     = this._buildEscrowContract(escrowAddr);

    const tx = await escrow.release();
    const receipt = await tx.wait();
    if (!receipt) throw new Error("releaseEscrow: transaction receipt not available");
    return receipt.hash as TxHash;
  }

  /**
   * Call dispute() on the escrow — locks funds pending resolution.
   */
  async disputeEscrow(handle: EscrowHandle, reason: string): Promise<void> {
    const escrowAddr = this._getEscrowAddress(handle);
    const escrow     = this._buildEscrowContract(escrowAddr);

    const tx = await escrow.dispute(reason);
    await tx.wait();
  }

  /**
   * Returns the USDC balance (in raw 6-decimal units) of the given address.
   */
  async getBalance(address: string): Promise<bigint> {
    return this.usdc.balanceOf(address) as Promise<bigint>;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Build an ethers Contract instance for a ClawdiaEscrow at the given address.
   * Extracted as a method so tests can stub it without mocking the ethers constructor.
   */
  protected _buildEscrowContract(address: string): IClawdiaEscrow {
    return new ethers.Contract(address, CLAWDIA_ESCROW_ABI, this.signer) as unknown as IClawdiaEscrow;
  }

  /**
   * Convert a Clawdia contract UUID string to bytes32.
   * We take the first 31 chars after stripping hyphens to fit bytes32.
   */
  private _toBytes32(contractId: string): string {
    const clean = contractId.replace(/-/g, "").slice(0, 31);
    return ethers.encodeBytes32String(clean);
  }

  /** Convert a USDC float amount to on-chain integer units (6 decimals). */
  private _toUsdcUnits(amount: number): bigint {
    return BigInt(Math.round(amount * 10 ** this.usdcDecimals));
  }

  /** Look up an agent's EVM address from the address book, falling back to signer. */
  private _resolveAddress(agentName: string): string {
    return this.addressBook[agentName] ?? "";
  }

  /** Get on-chain escrow address from handle or internal map. */
  private _getEscrowAddress(handle: EscrowHandle): string {
    // handle.id is the escrow contract address when created via createEscrow()
    if (handle.id && handle.id !== "" && handle.id.startsWith("0x")) {
      return handle.id;
    }
    const addr = this.escrowAddresses.get(handle.contractId);
    if (!addr) {
      throw new Error(
        `No on-chain escrow address for Clawdia contract "${handle.contractId}". ` +
        `Call createEscrow() first.`,
      );
    }
    return addr;
  }

  /** Register an already-known escrow address (e.g. loaded from a deployment file). */
  registerEscrow(contractId: string, escrowAddress: string): void {
    this.escrowAddresses.set(contractId, escrowAddress);
  }

  /** Return the on-chain address for a given Clawdia contract ID. */
  getEscrowAddress(contractId: string): string | undefined {
    return this.escrowAddresses.get(contractId);
  }
}
