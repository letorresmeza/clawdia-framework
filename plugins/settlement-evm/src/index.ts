/**
 * @clawdia/plugin-settlement-evm
 *
 * EVM settlement rail — funds and releases on-chain USDC escrow
 * for every Clawdia task contract.
 *
 * Usage:
 *
 * ```ts
 * import settlementEvm, { SettlementBridge, EvmSettlementRail } from "@clawdia/plugin-settlement-evm";
 * import { ethers } from "ethers";
 *
 * const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");
 * const signer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
 *
 * const rail = settlementEvm.create({
 *   signer,
 *   factoryAddress: "0x...",
 *   usdcAddress:    "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
 *   addressBook: { "data-analyst": "0xProviderWallet..." },
 * });
 *
 * // Wire to ClawBus
 * const bridge = new SettlementBridge({ bus, contracts, rail });
 * bridge.start();
 * ```
 */

import { definePlugin } from "@clawdia/sdk";
import type { ISettlementRail } from "@clawdia/types";
import { EvmSettlementRail, type EvmSettlementConfig } from "./evm-settlement.js";

export { EvmSettlementRail, type EvmSettlementConfig } from "./evm-settlement.js";
export { SettlementBridge, type BridgeConfig } from "./settlement-bridge.js";
export { ESCROW_FACTORY_ABI, CLAWDIA_ESCROW_ABI, ERC20_ABI, EscrowOnChainState } from "./abis.js";

export default definePlugin<ISettlementRail>({
  name: "evm-settlement",
  type: "settlement",
  version: "0.1.0",
  create: (config?: Record<string, unknown>) => {
    if (!config) {
      throw new Error(
        "evm-settlement plugin requires config: { signer, factoryAddress, usdcAddress }",
      );
    }
    return new EvmSettlementRail(config as unknown as EvmSettlementConfig);
  },
});
