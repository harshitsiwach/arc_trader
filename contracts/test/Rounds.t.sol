// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vault} from "../src/Vault.sol";
import {Rounds} from "../src/Rounds.sol";
import {MockUSDC} from "./MockUSDC.sol";

/// @notice P2 tests: P0 caps onchain, settle/claim/void accounting, sig auth.
/// Money in USDC base units (1e6). Prices 1e8 fixed-point.
contract RoundsTest is Test {
    MockUSDC usdc;
    Vault vault;
    Rounds rounds;

    address owner = address(0xA11CE);
    address operator = address(0xBEEF);
    uint256 settlerKey = 0x5E77;
    address settler;
    address alice = address(0xA11);
    address bob = address(0xB0B);

    uint32 constant PAYOUT = 18000; // 1.8x flash
    uint32 constant FEE = 150; // 1.5%
    uint128 constant LIAB = 20_000000; // $20
    uint128 constant MAXBET = 5_000000; // $5 whale-capped @ $10k BR

    function setUp() public {
        settler = vm.addr(settlerKey);
        usdc = new MockUSDC();
        vault = new Vault(address(usdc), owner, operator);
        rounds = new Rounds(address(vault), owner, operator, settler);
        vm.prank(owner);
        vault.setRounds(address(rounds));
        // fund players + house
        usdc.faucet(alice, 1_000_000000);
        usdc.faucet(bob, 1_000_000000);
        usdc.faucet(owner, 100_000_000000);
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(1_000_000000);
        vm.stopPrank();
        vm.startPrank(bob);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(1_000_000000);
        vm.stopPrank();
        vm.startPrank(owner);
        usdc.approve(address(vault), type(uint256).max);
        vault.fundHouse(10_000_000000);
        vm.stopPrank();
    }

    function _round() internal returns (uint256 id) {
        vm.prank(operator);
        id = rounds.createRound(bytes32("BTC"), uint64(block.timestamp + 5), uint64(block.timestamp + 10), PAYOUT, FEE, LIAB, MAXBET, 8000);
    }

    function _sig(bytes32 h) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        (v, r, s) = vm.sign(settlerKey, keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h)));
    }

    // ---- caps ----

    function test_rejectFairOrBetterPayout() public {
        vm.prank(operator);
        vm.expectRevert(Rounds.Cap.selector);
        rounds.createRound(bytes32("BTC"), uint64(block.timestamp + 5), uint64(block.timestamp + 10), 20000, FEE, LIAB, MAXBET, 8000);
    }

    function test_rejectWhaleBet() public {
        uint256 id = _round();
        vm.prank(alice);
        vm.expectRevert(Rounds.Cap.selector);
        rounds.placeBet(id, true, 6_000000);
    }

    function test_rejectLateBet() public {
        uint256 id = _round();
        vm.warp(block.timestamp + 6);
        vm.prank(alice);
        vm.expectRevert(Rounds.Late.selector);
        rounds.placeBet(id, true, 1_000000);
    }

    function test_flowGuardBlocksPiling() public {
        uint256 id = _round();
        vm.prank(alice);
        rounds.placeBet(id, true, 5_000000); // up=5, worst 4 <= 10 ok
        vm.prank(bob);
        rounds.placeBet(id, true, 5_000000); // up=10, worst 8 <= 10 ok
        usdc.faucet(alice, 10_000000);
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(10_000000);
        vm.expectRevert(Rounds.Cap.selector);
        rounds.placeBet(id, true, 5_000000); // up=15, worst 12 > 10 + 100% skew
        vm.stopPrank();
    }

    // ---- lifecycle: up wins ----

    function test_upWinPaysOut() public {
        uint256 id = _round();
        vm.prank(alice);
        uint256 betId = rounds.placeBet(id, true, 5_000000); // fee 75000
        vm.prank(bob);
        rounds.placeBet(id, false, 5_000000);

        vm.warp(block.timestamp + 6);
        (uint8 v, bytes32 r, bytes32 s) = _sig(rounds.lockHash(id, 100_00000000));
        rounds.lockRound(id, 100_00000000, v, r, s);

        vm.warp(block.timestamp + 5);
        (v, r, s) = _sig(rounds.settleHash(id, 101_00000000));
        rounds.settleRound(id, 101_00000000, v, r, s);

        uint256 before = vault.balances(alice);
        rounds.claim(betId);
        // stake 5 + profit 5*0.8=4 => +9
        assertEq(vault.balances(alice) - before, 9_000000);
        // house: fees 0.15 - profit 4 + loser stake 5 = +1.15
        assertEq(vault.houseBalance(), 10_000_000000 + 1_150000);
        // loser claim pays 0
        rounds.claim(betId + 1);
        assertEq(vault.balances(bob), 1_000_000000 - 5_075000);
    }

    function test_pushRefunds() public {
        uint256 id = _round();
        vm.prank(alice);
        uint256 betId = rounds.placeBet(id, true, 5_000000);
        vm.warp(block.timestamp + 6);
        (uint8 v, bytes32 r, bytes32 s) = _sig(rounds.lockHash(id, 100_00000000));
        rounds.lockRound(id, 100_00000000, v, r, s);
        vm.warp(block.timestamp + 5);
        (v, r, s) = _sig(rounds.settleHash(id, 100_00000000));
        rounds.settleRound(id, 100_00000000, v, r, s);
        rounds.claim(betId);
        assertEq(vault.balances(alice), 1_000_000000 - 75000); // stake back, fee kept
    }

    function test_voidRefundsFeeToo() public {
        uint256 id = _round();
        vm.prank(alice);
        uint256 betId = rounds.placeBet(id, true, 5_000000);
        (uint8 v, bytes32 r, bytes32 s) = _sig(rounds.voidHash(id));
        rounds.voidRound(id, v, r, s);
        rounds.claim(betId);
        assertEq(vault.balances(alice), 1_000_000000); // full refund
        assertEq(vault.houseBalance(), 10_000_000000);
    }

    function test_rejectBadSigAndDoubleClaim() public {
        uint256 id = _round();
        vm.prank(alice);
        uint256 betId = rounds.placeBet(id, true, 5_000000);
        vm.warp(block.timestamp + 6);
        (uint8 v, bytes32 r, bytes32 s) = _sig(rounds.lockHash(id, 100_00000000));
        rounds.lockRound(id, 100_00000000, v, r, s);
        vm.warp(block.timestamp + 5);
        // wrong price signed vs submitted
        (v, r, s) = _sig(rounds.settleHash(id, 999_00000000));
        vm.expectRevert(Rounds.BadSig.selector);
        rounds.settleRound(id, 101_00000000, v, r, s);
        // correct
        (v, r, s) = _sig(rounds.settleHash(id, 101_00000000));
        rounds.settleRound(id, 101_00000000, v, r, s);
        rounds.claim(betId);
        vm.expectRevert(Rounds.AlreadyClaimed.selector);
        rounds.claim(betId);
    }

    function test_forceVoidExpiredRescuesStuckFunds() public {
        uint256 id = _round();
        vm.prank(alice);
        uint256 betId = rounds.placeBet(id, true, 5_000000);
        // No settler action at all — anyone force-voids after expiry.
        vm.warp(block.timestamp + 11);
        rounds.forceVoidExpired(id);
        rounds.claim(betId);
        assertEq(vault.balances(alice), 1_000_000000); // full refund incl. fee
    }

    function test_forceVoidTooEarlyReverts() public {
        uint256 id = _round();
        vm.expectRevert(Rounds.BadRound.selector);
        rounds.forceVoidExpired(id);
    }

    function test_renounceOwnershipDisabled() public {
        vm.prank(owner);
        vm.expectRevert("renounce disabled");
        vault.renounceOwnership();
        vm.prank(owner);
        vm.expectRevert("renounce disabled");
        rounds.renounceOwnership();
    }

    function test_withdrawalsAndSweep() public {
        vm.prank(alice);
        vault.withdraw(100_000000);
        assertEq(usdc.balanceOf(alice), 100_000000);
        vm.prank(owner);
        vault.sweep(owner, 1_000_000000);
        assertEq(usdc.balanceOf(owner), 100_000_000000 - 10_000_000000 + 1_000_000000);
    }
}
