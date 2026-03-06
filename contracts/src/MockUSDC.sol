// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice Test-only ERC-20 that mimics USDC (6 decimals, permissionless mint).
 *         Never deploy to mainnet.
 */
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint tokens freely — for tests only.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
