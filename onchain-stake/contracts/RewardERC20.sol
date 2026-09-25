// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";

contract RewardERC20 is ERC20, ERC20Capped {
    error ZeroAddress();

    uint256 private constant INITIAL_SUPPLY = 1_000_000_000 * 1e18;

    constructor(address vault)
        ERC20("Hyperblock", "HBLK")
        ERC20Capped(1_000_000_000 * 1e18)
    {
        if (vault == address(0)) revert ZeroAddress();
        _mint(vault, INITIAL_SUPPLY);
    }

    // Required override: ERC20Capped._update overrides ERC20._update;
    // this explicit override resolves the diamond ambiguity.
    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Capped)
    {
        super._update(from, to, value);
    }
}
