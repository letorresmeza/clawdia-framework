// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ClawdiaEscrow.sol";

/**
 * @title EscrowFactory
 * @notice Deploys a ClawdiaEscrow per off-chain task contract and acts as the
 *         authorised dispute resolver for all escrows it creates.
 *
 *         One factory per deployment. The owner can transfer ownership and
 *         resolve disputes.
 */
contract EscrowFactory {
    // ─── State ────────────────────────────────────────────────────────────────

    address public immutable usdc;
    uint256 public immutable defaultTimeoutSeconds;

    address public owner;

    /// contractId (bytes32) → escrow address
    mapping(bytes32 => address) public escrows;

    // ─── Events ───────────────────────────────────────────────────────────────

    event EscrowCreated(
        bytes32 indexed contractId,
        address indexed escrow,
        address indexed requester,
        address provider,
        uint256 amount
    );

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error EscrowAlreadyExists(bytes32 contractId);
    error EscrowNotFound(bytes32 contractId);
    error Unauthorized();
    error ZeroAddress();

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address _usdc, uint256 _defaultTimeoutSeconds) {
        if (_usdc == address(0)) revert ZeroAddress();
        usdc                   = _usdc;
        defaultTimeoutSeconds  = _defaultTimeoutSeconds;
        owner                  = msg.sender;
    }

    // ─── Factory ─────────────────────────────────────────────────────────────

    /**
     * @notice Deploy a new ClawdiaEscrow for the given off-chain contract.
     * @param  contractId  Keccak256 hash of the Clawdia contract UUID string.
     * @param  requester   Address that will fund the escrow.
     * @param  provider    Address that will receive payment on success.
     * @param  amount      USDC amount in 6-decimal units (e.g. 1e6 = 1 USDC).
     * @return escrow      Address of the newly deployed escrow contract.
     */
    function createEscrow(
        bytes32 contractId,
        address requester,
        address provider,
        uint256 amount
    ) external returns (address escrow) {
        return createEscrowWithTimeout(contractId, requester, provider, amount, defaultTimeoutSeconds);
    }

    /**
     * @notice Same as createEscrow but with a custom timeout.
     */
    function createEscrowWithTimeout(
        bytes32 contractId,
        address requester,
        address provider,
        uint256 amount,
        uint256 timeoutSeconds
    ) public returns (address escrow) {
        if (escrows[contractId] != address(0)) {
            revert EscrowAlreadyExists(contractId);
        }
        if (requester == address(0) || provider == address(0)) revert ZeroAddress();

        ClawdiaEscrow newEscrow = new ClawdiaEscrow(
            usdc,
            requester,
            provider,
            address(this),  // resolver = factory contract (owner calls resolveDispute)
            contractId,
            amount,
            timeoutSeconds
        );

        escrows[contractId] = address(newEscrow);

        emit EscrowCreated(contractId, address(newEscrow), requester, provider, amount);

        return address(newEscrow);
    }

    // ─── Dispute resolution ───────────────────────────────────────────────────

    /**
     * @notice Owner resolves a dispute by specifying how much goes to the provider.
     * @param  contractId     Off-chain contract ID.
     * @param  providerShare  USDC units to send the provider; remainder → requester.
     */
    function resolveDispute(bytes32 contractId, uint256 providerShare) external {
        if (msg.sender != owner) revert Unauthorized();
        address escrowAddr = escrows[contractId];
        if (escrowAddr == address(0)) revert EscrowNotFound(contractId);
        ClawdiaEscrow(escrowAddr).resolve(providerShare);
    }

    // ─── Ownership ────────────────────────────────────────────────────────────

    function transferOwnership(address newOwner) external {
        if (msg.sender != owner) revert Unauthorized();
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ─── View ─────────────────────────────────────────────────────────────────

    function getEscrow(bytes32 contractId) external view returns (address) {
        return escrows[contractId];
    }

    function escrowExists(bytes32 contractId) external view returns (bool) {
        return escrows[contractId] != address(0);
    }
}
