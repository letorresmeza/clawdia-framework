// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title AgentRegistry
 * @notice Tracks operator-registered agent identities, stake balances, and
 *         slashing on the target EVM network.
 */
contract AgentRegistry {
    IERC20 public immutable usdc;
    address public owner;
    uint256 public minimumStake;
    uint256 public immutable unstakeCooldownSeconds;

    struct Agent {
        address payoutWallet;
        string metadataURI;
        uint256 stake;
        uint256 pendingWithdrawal;
        uint256 withdrawalReadyAt;
        bool active;
    }

    mapping(bytes32 => Agent) private agents;
    mapping(address => bytes32) public agentIdsByWallet;

    event AgentRegistered(bytes32 indexed agentId, address indexed payoutWallet, uint256 stake, string metadataURI);
    event StakeAdded(bytes32 indexed agentId, uint256 amount, uint256 totalStake);
    event UnstakeRequested(bytes32 indexed agentId, uint256 amount, uint256 readyAt);
    event StakeWithdrawn(bytes32 indexed agentId, uint256 amount);
    event StakeSlashed(bytes32 indexed agentId, uint256 amount, address indexed recipient);
    event WalletUpdated(bytes32 indexed agentId, address indexed oldWallet, address indexed newWallet);
    event MetadataUpdated(bytes32 indexed agentId, string metadataURI);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event MinimumStakeUpdated(uint256 previousMinimumStake, uint256 newMinimumStake);

    error AgentAlreadyRegistered(bytes32 agentId);
    error AgentNotFound(bytes32 agentId);
    error CooldownNotReached(uint256 readyAt);
    error InsufficientStake(uint256 requested, uint256 available);
    error Unauthorized();
    error ZeroAddress();
    error InvalidAmount();
    error MinimumStakeNotMet(uint256 minimumStake);

    constructor(address usdcAddress, uint256 minStake, uint256 cooldownSeconds) {
        if (usdcAddress == address(0)) revert ZeroAddress();
        usdc = IERC20(usdcAddress);
        owner = msg.sender;
        minimumStake = minStake;
        unstakeCooldownSeconds = cooldownSeconds;
    }

    function registerAgent(
        bytes32 agentId,
        address payoutWallet,
        string calldata metadataURI,
        uint256 initialStake
    ) external {
        if (agents[agentId].active) revert AgentAlreadyRegistered(agentId);
        if (payoutWallet == address(0)) revert ZeroAddress();
        if (initialStake < minimumStake) revert MinimumStakeNotMet(minimumStake);

        agents[agentId] = Agent({
            payoutWallet: payoutWallet,
            metadataURI: metadataURI,
            stake: initialStake,
            pendingWithdrawal: 0,
            withdrawalReadyAt: 0,
            active: true
        });
        agentIdsByWallet[payoutWallet] = agentId;

        require(usdc.transferFrom(msg.sender, address(this), initialStake), "stake transfer failed");
        emit AgentRegistered(agentId, payoutWallet, initialStake, metadataURI);
    }

    function addStake(bytes32 agentId, uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        Agent storage agent = _getAgent(agentId);
        agent.stake += amount;
        require(usdc.transferFrom(msg.sender, address(this), amount), "stake transfer failed");
        emit StakeAdded(agentId, amount, agent.stake);
    }

    function requestUnstake(bytes32 agentId, uint256 amount) external {
        Agent storage agent = _getAgent(agentId);
        if (msg.sender != agent.payoutWallet && msg.sender != owner) revert Unauthorized();
        if (amount == 0) revert InvalidAmount();
        if (agent.stake < amount) revert InsufficientStake(amount, agent.stake);
        if (agent.stake - amount < minimumStake && agent.stake != amount) {
            revert MinimumStakeNotMet(minimumStake);
        }

        agent.stake -= amount;
        agent.pendingWithdrawal += amount;
        agent.withdrawalReadyAt = block.timestamp + unstakeCooldownSeconds;

        emit UnstakeRequested(agentId, amount, agent.withdrawalReadyAt);
    }

    function withdrawStake(bytes32 agentId) external {
        Agent storage agent = _getAgent(agentId);
        if (msg.sender != agent.payoutWallet && msg.sender != owner) revert Unauthorized();
        if (agent.pendingWithdrawal == 0) revert InvalidAmount();
        if (block.timestamp < agent.withdrawalReadyAt) {
            revert CooldownNotReached(agent.withdrawalReadyAt);
        }

        uint256 amount = agent.pendingWithdrawal;
        agent.pendingWithdrawal = 0;
        agent.withdrawalReadyAt = 0;

        require(usdc.transfer(agent.payoutWallet, amount), "withdraw transfer failed");
        emit StakeWithdrawn(agentId, amount);
    }

    function slash(bytes32 agentId, uint256 amount, address recipient) external {
        if (msg.sender != owner) revert Unauthorized();
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();

        Agent storage agent = _getAgent(agentId);
        uint256 available = agent.stake + agent.pendingWithdrawal;
        if (available < amount) revert InsufficientStake(amount, available);

        if (agent.pendingWithdrawal >= amount) {
            agent.pendingWithdrawal -= amount;
        } else {
            uint256 remainder = amount - agent.pendingWithdrawal;
            agent.pendingWithdrawal = 0;
            agent.withdrawalReadyAt = 0;
            agent.stake -= remainder;
        }

        require(usdc.transfer(recipient, amount), "slash transfer failed");
        emit StakeSlashed(agentId, amount, recipient);
    }

    function updateWallet(bytes32 agentId, address newWallet) external {
        Agent storage agent = _getAgent(agentId);
        if (msg.sender != agent.payoutWallet && msg.sender != owner) revert Unauthorized();
        if (newWallet == address(0)) revert ZeroAddress();

        address oldWallet = agent.payoutWallet;
        delete agentIdsByWallet[oldWallet];
        agent.payoutWallet = newWallet;
        agentIdsByWallet[newWallet] = agentId;

        emit WalletUpdated(agentId, oldWallet, newWallet);
    }

    function updateMetadata(bytes32 agentId, string calldata metadataURI) external {
        Agent storage agent = _getAgent(agentId);
        if (msg.sender != agent.payoutWallet && msg.sender != owner) revert Unauthorized();
        agent.metadataURI = metadataURI;
        emit MetadataUpdated(agentId, metadataURI);
    }

    function setMinimumStake(uint256 newMinimumStake) external {
        if (msg.sender != owner) revert Unauthorized();
        emit MinimumStakeUpdated(minimumStake, newMinimumStake);
        minimumStake = newMinimumStake;
    }

    function transferOwnership(address newOwner) external {
        if (msg.sender != owner) revert Unauthorized();
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function getAgent(bytes32 agentId) external view returns (Agent memory) {
        return _getAgent(agentId);
    }

    function isEligible(bytes32 agentId) external view returns (bool) {
        Agent storage agent = agents[agentId];
        return agent.active && agent.stake >= minimumStake;
    }

    function _getAgent(bytes32 agentId) internal view returns (Agent storage agent) {
        agent = agents[agentId];
        if (!agent.active) revert AgentNotFound(agentId);
    }
}
