/**
 * Minimal ABIs for on-chain interaction.
 * Generated from contracts/src/ — regenerate with: pnpm --filter @clawdia/contracts compile
 */

export const ESCROW_FACTORY_ABI = [
  // Write
  "function createEscrow(bytes32 contractId, address requester, address provider, uint256 amount) returns (address)",
  "function createEscrowWithTimeout(bytes32 contractId, address requester, address provider, uint256 amount, uint256 timeoutSeconds) returns (address)",
  "function resolveDispute(bytes32 contractId, uint256 providerShare)",
  "function transferOwnership(address newOwner)",
  // Read
  "function getEscrow(bytes32 contractId) view returns (address)",
  "function escrowExists(bytes32 contractId) view returns (bool)",
  "function usdc() view returns (address)",
  "function defaultTimeoutSeconds() view returns (uint256)",
  "function owner() view returns (address)",
  // Events
  "event EscrowCreated(bytes32 indexed contractId, address indexed escrow, address indexed requester, address provider, uint256 amount)",
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
] as const;

export const CLAWDIA_ESCROW_ABI = [
  // Write
  "function fund()",
  "function release()",
  "function dispute(string reason)",
  "function claimAfterTimeout()",
  "function refund()",
  "function resolve(uint256 providerShare)",
  // Read
  "function getState() view returns (uint8)",
  "function state() view returns (uint8)",
  "function requester() view returns (address)",
  "function provider() view returns (address)",
  "function resolver() view returns (address)",
  "function contractId() view returns (bytes32)",
  "function amount() view returns (uint256)",
  "function timeoutSeconds() view returns (uint256)",
  "function fundedAt() view returns (uint256)",
  "function timeoutAt() view returns (uint256)",
  "function usdc() view returns (address)",
  // Events
  "event Funded(address indexed requester, uint256 amount, uint256 timestamp)",
  "event Released(address indexed provider, uint256 amount)",
  "event Disputed(address indexed initiator, string reason)",
  "event Resolved(address indexed provider, uint256 providerShare, address indexed requester, uint256 requesterShare)",
  "event Refunded(address indexed requester, uint256 amount)",
] as const;

export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function transfer(address to, uint256 amount) returns (bool)",
] as const;

/** On-chain escrow state enum (matches Solidity State enum) */
export enum EscrowOnChainState {
  Created   = 0,
  Funded    = 1,
  Released  = 2,
  Disputed  = 3,
  Refunded  = 4,
}
