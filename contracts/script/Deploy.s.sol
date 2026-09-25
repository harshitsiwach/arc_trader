// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Vault} from "../src/Vault.sol";
import {Rounds} from "../src/Rounds.sol";
import {MockUSDC} from "../test/MockUSDC.sol";

/// @notice Deploy the house contracts.
/// Env: USDC_ADDR (unset = deploy MockUSDC for local rehearsal),
/// OWNER_, OPERATOR_, SETTLER_, DEPLOYER_ (all required for testnet).
/// The deployer is initial owner so one key can wire everything, then
/// ownership moves to OWNER_. The deployer keeps no powers afterwards.
/// Usage: forge script script/Deploy.s.sol --rpc-url $ARC_TESTNET_RPC_URL --broadcast
contract Deploy is Script {
    function run() external {
        address usdc = vm.envOr("USDC_ADDR", address(0));
        address owner = vm.envAddress("OWNER_");
        address operator = vm.envAddress("OPERATOR_");
        address settler = vm.envAddress("SETTLER_");
        address deployer = vm.envAddress("DEPLOYER_");

        vm.startBroadcast();
        if (usdc == address(0)) {
            usdc = address(new MockUSDC());
            console.log("MockUSDC:", usdc);
        }
        Vault vault = new Vault(usdc, deployer, operator);
        Rounds rounds = new Rounds(address(vault), deployer, operator, settler);
        vault.setRounds(address(rounds));
        vault.transferOwnership(owner);
        rounds.transferOwnership(owner);
        vm.stopBroadcast();

        console.log("USDC:", usdc);
        console.log("Vault:", address(vault));
        console.log("Rounds:", address(rounds));
    }
}
