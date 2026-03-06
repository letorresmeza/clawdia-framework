// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ClawdiaEscrow
 * @notice Per-contract escrow instance created by EscrowFactory.
 *
 * Lifecycle:
 *   Created → Funded → Released     (happy path: requester verifies & settles)
 *   Created → Funded → Disputed     (either party raises dispute)
 *   Disputed → Released             (provider claims after dispute timeout)
 *   Funded   → Refunded             (requester reclaims after delivery timeout)
 *
 * Resolver (factory owner) can settle a dispute with an arbitrary split.
 */
contract ClawdiaEscrow {
    using SafeERC20 for IERC20;

    // ─── State machine ────────────────────────────────────────────────────────

    enum State {
        Created,
        Funded,
        Released,
        Disputed,
        Refunded
    }

    // ─── Immutables ───────────────────────────────────────────────────────────

    IERC20  public immutable usdc;
    address public immutable requester;
    address public immutable provider;
    address public immutable resolver;      // Authorised dispute resolver (factory owner)
    bytes32 public immutable contractId;    // Off-chain Clawdia contract UUID (as bytes32)
    uint256 public immutable amount;        // USDC amount in 6-decimal units
    uint256 public immutable timeoutSeconds; // Seconds after funding before unilateral claims

    // ─── Mutable state ────────────────────────────────────────────────────────

    State   public state;
    uint256 public fundedAt;

    // ─── Events ───────────────────────────────────────────────────────────────

    event Funded(address indexed requester, uint256 amount, uint256 timestamp);
    event Released(address indexed provider, uint256 amount);
    event Disputed(address indexed initiator, string reason);
    event Resolved(
        address indexed provider,
        uint256 providerShare,
        address indexed requester,
        uint256 requesterShare
    );
    event Refunded(address indexed requester, uint256 amount);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error WrongState(State current);
    error Unauthorized();
    error TimeoutNotReached();
    error ZeroAmount();
    error InvalidSplit();

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(
        address _usdc,
        address _requester,
        address _provider,
        address _resolver,
        bytes32 _contractId,
        uint256 _amount,
        uint256 _timeoutSeconds
    ) {
        if (_amount == 0) revert ZeroAmount();
        usdc            = IERC20(_usdc);
        requester       = _requester;
        provider        = _provider;
        resolver        = _resolver;
        contractId      = _contractId;
        amount          = _amount;
        timeoutSeconds  = _timeoutSeconds;
        state           = State.Created;
    }

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyRequester() {
        if (msg.sender != requester) revert Unauthorized();
        _;
    }

    modifier inState(State expected) {
        if (state != expected) revert WrongState(state);
        _;
    }

    modifier afterTimeout() {
        if (block.timestamp < fundedAt + timeoutSeconds) revert TimeoutNotReached();
        _;
    }

    // ─── Lifecycle functions ──────────────────────────────────────────────────

    /**
     * @notice Requester deposits USDC to fund the escrow.
     * @dev    Caller must approve this contract for `amount` USDC first.
     */
    function fund() external onlyRequester inState(State.Created) {
        state    = State.Funded;
        fundedAt = block.timestamp;
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount, block.timestamp);
    }

    /**
     * @notice Requester releases funds to the provider after successful verification.
     */
    function release() external onlyRequester inState(State.Funded) {
        state = State.Released;
        usdc.safeTransfer(provider, amount);
        emit Released(provider, amount);
    }

    /**
     * @notice Either party raises a dispute. Funds are locked until resolved or timed out.
     * @param  reason  Human-readable dispute reason (stored in event log only).
     */
    function dispute(string calldata reason) external inState(State.Funded) {
        if (msg.sender != requester && msg.sender != provider) revert Unauthorized();
        state = State.Disputed;
        emit Disputed(msg.sender, reason);
    }

    /**
     * @notice Provider claims full amount after dispute timeout has passed.
     * @dev    Represents the case where the requester raised a dispute but never
     *         responded — provider is presumed correct after the timeout window.
     */
    function claimAfterTimeout()
        external
        inState(State.Disputed)
        afterTimeout
    {
        if (msg.sender != provider) revert Unauthorized();
        state = State.Released;
        usdc.safeTransfer(provider, amount);
        emit Released(provider, amount);
    }

    /**
     * @notice Requester reclaims funds if the escrow was funded but never moved
     *         to dispute and the timeout has elapsed (provider abandoned the task).
     */
    function refund()
        external
        onlyRequester
        inState(State.Funded)
        afterTimeout
    {
        state = State.Refunded;
        usdc.safeTransfer(requester, amount);
        emit Refunded(requester, amount);
    }

    /**
     * @notice Resolver (factory owner) splits disputed funds between the parties.
     * @param  providerShare  USDC units sent to the provider; remainder goes to requester.
     */
    function resolve(uint256 providerShare)
        external
        inState(State.Disputed)
    {
        if (msg.sender != resolver) revert Unauthorized();
        if (providerShare > amount) revert InvalidSplit();

        uint256 requesterShare = amount - providerShare;
        state = State.Released; // terminal: funds fully disbursed

        if (providerShare > 0) {
            usdc.safeTransfer(provider, providerShare);
        }
        if (requesterShare > 0) {
            usdc.safeTransfer(requester, requesterShare);
        }

        emit Resolved(provider, providerShare, requester, requesterShare);
    }

    // ─── View helpers ─────────────────────────────────────────────────────────

    function getState() external view returns (State) {
        return state;
    }

    function timeoutAt() external view returns (uint256) {
        return fundedAt == 0 ? 0 : fundedAt + timeoutSeconds;
    }
}
