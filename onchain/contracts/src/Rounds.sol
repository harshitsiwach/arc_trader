// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Vault} from "./Vault.sol";

/// @title Rounds — onchain binary up/down rounds on Arc.
/// @notice Prices are 1e8 fixed-point (Hyperliquid convention).
/// Stakes in USDC base units (1e6).
/// Lock/settle/void are permissionless relays carrying an ECDSA signature
/// from the authorized settler (the P1 feed key); the contract derives the
/// result itself from refPrice vs settlePrice — the relayer cannot invent it.
///
/// Economics (P0 caps enforced onchain):
///   payoutBps HARD-CAPPED < 20000 (sub-fair house edge)
///   payoutBps MUST > 10000 (meaningful payout)
///   feeBps:   1.5% = 150 bps  (recommended, not enforced)
///   maxLiability: worst-case winning-side payout <= maxLiability, fees ignored
///   Per-bet whale cap: stake <= maxBet
///   Skew guard: block deepening dominant side past maxSkewBps once sizable
contract Rounds is Ownable, Pausable, ReentrancyGuard {
    Vault public immutable vault;
    address public operator; // creates rounds, pauses
    address public settler;  // signs lock/settle/void payloads

    uint256 public roundCount;
    uint256 public betCount;

    uint8 public constant OPEN     = 0;
    uint8 public constant LOCKED   = 1;
    uint8 public constant SETTLED  = 2;
    uint8 public constant VOID     = 3;

    uint8 public constant NONE = 0;
    uint8 public constant UP   = 1;
    uint8 public constant DOWN = 2;
    uint8 public constant PUSH = 3;

    struct Round {
        bytes32 coin;
        uint64  lockAt;
        uint64  expiresAt;
        uint32  payoutBps;    // MUST be < 20000 (sub-fair, P0)
        uint32  feeBps;
        uint128 maxLiability;
        uint128 maxBet;
        uint16  maxSkewBps;   // e.g. 8000 = 80%
        uint8   status;
        uint8   result;
        uint256 refPrice;
        uint256 settlePrice;
        uint128 upStakes;
        uint128 downStakes;
    }

    struct Bet {
        address user;
        uint256 roundId;
        bool    up;
        uint128 stake;
        uint128 fee;
        bool    claimed;
    }

    mapping(uint256 => Round) public rounds;
    mapping(uint256 => Bet)   public bets;

    event RoundCreated(uint256 indexed id, bytes32 coin);
    event BetPlaced(uint256 indexed betId, uint256 indexed roundId, address indexed user, bool up, uint256 stake);
    event RoundLocked(uint256 indexed id, uint256 refPrice);
    event RoundSettled(uint256 indexed id, uint8 result, uint256 settlePrice);
    event RoundVoided(uint256 indexed id);
    event Claimed(uint256 indexed betId, address indexed user, uint256 payout);
    event OperatorSet(address indexed oldOperator, address indexed newOperator);
    event SettlerSet(address indexed oldSettler, address indexed newSettler);

    error NotOperator();
    error BadRound();
    error Late();
    error Cap();
    error BadSig();
    error ZeroAddress();
    error AlreadyClaimed();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(address vault_, address owner_, address operator_, address settler_) Ownable(owner_) {
        if (vault_ == address(0) || owner_ == address(0) || operator_ == address(0) || settler_ == address(0))
            revert ZeroAddress();
        vault    = Vault(vault_);
        operator = operator_;
        settler  = settler_;
    }

    function setOperator(address o) external onlyOwner {
        if (o == address(0)) revert ZeroAddress();
        address oldOperator = operator;
        operator = o;
        emit OperatorSet(oldOperator, o);
    }

    function setSettler(address s) external onlyOwner {
        if (s == address(0)) revert ZeroAddress();
        address oldSettler = settler;
        settler = s;
        emit SettlerSet(oldSettler, s);
    }

    function pause() external {
        require(msg.sender == owner() || msg.sender == operator, "not pauser");
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @dev Prevent accidental renunciation which would permanently lock unpause().
    function renounceOwnership() public pure override {
        revert("renounce disabled");
    }

    // ---- rounds ----

    function createRound(
        bytes32 coin,
        uint64  lockAt,
        uint64  expiresAt,
        uint32  payoutBps,
        uint32  feeBps,
        uint128 maxLiability,
        uint128 maxBet,
        uint16  maxSkewBps
    ) external onlyOperator whenNotPaused returns (uint256 id) {
        if (payoutBps >= 20000) revert Cap(); // P0: payout must be sub-fair
        if (payoutBps <= 10000) revert Cap();
        if (!(expiresAt > lockAt && lockAt > block.timestamp)) revert BadRound();
        if (maxLiability == 0 || maxBet == 0) revert Cap();
        if (maxSkewBps == 0 || maxSkewBps > 10000) revert Cap();

        id = ++roundCount;
        rounds[id] = Round({
            coin:         coin,
            lockAt:       lockAt,
            expiresAt:    expiresAt,
            payoutBps:    payoutBps,
            feeBps:       feeBps,
            maxLiability: maxLiability,
            maxBet:       maxBet,
            maxSkewBps:   maxSkewBps,
            status:       OPEN,
            result:       NONE,
            refPrice:     0,
            settlePrice:  0,
            upStakes:     0,
            downStakes:   0
        });
        emit RoundCreated(id, coin);
    }

    function placeBet(uint256 roundId, bool up, uint128 stake)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 betId)
    {
        Round storage r = rounds[roundId];
        if (r.status != OPEN) revert BadRound();
        if (block.timestamp >= r.lockAt) revert Late();
        if (stake == 0 || stake > r.maxBet) revert Cap();

        uint256 upNew   = r.upStakes   + (up ? stake : 0);
        uint256 downNew = r.downStakes + (up ? 0 : stake);

        // Liability simulation (P0 checkRoundLiability, fees ignored = conservative).
        uint256 worst = (upNew > downNew ? upNew : downNew) * r.payoutBps / 10000;
        if (worst > r.maxLiability) revert Cap();

        // Skew guard with size gate (mirrors P1): only once dominant side is sizable.
        uint256 total      = upNew + downNew;
        uint256 dom        = upNew > downNew ? upNew : downNew;
        bool    isDomSide  = up ? (upNew >= downNew) : (downNew > upNew);
        if (
            total > 0 &&
            isDomSide &&
            (dom * 10000) / total > r.maxSkewBps &&
            (dom * (r.payoutBps - 10000)) / 10000 > r.maxLiability / 2
        ) {
            revert Cap();
        }

        uint256 fee = (uint256(stake) * r.feeBps) / 10000;

        // CEI: write stake accumulator before external call.
        if (up) r.upStakes   = uint128(upNew);
        else    r.downStakes = uint128(downNew);

        vault.lockStake(msg.sender, stake, fee);

        betId = ++betCount;
        bets[betId] = Bet({
            user:    msg.sender,
            roundId: roundId,
            up:      up,
            stake:   stake,
            fee:     uint128(fee),
            claimed: false
        });
        emit BetPlaced(betId, roundId, msg.sender, up, stake);
    }

    // ---- lock / settle / void (settler-signed, permissionless relay) ----

    function lockHash(uint256 roundId, uint256 refPrice) public view returns (bytes32) {
        return keccak256(abi.encode("ARC-ROUND-LOCK", block.chainid, address(this), roundId, refPrice));
    }

    function settleHash(uint256 roundId, uint256 settlePrice) public view returns (bytes32) {
        return keccak256(abi.encode("ARC-ROUND-SETTLE", block.chainid, address(this), roundId, settlePrice));
    }

    function voidHash(uint256 roundId) public view returns (bytes32) {
        return keccak256(abi.encode("ARC-ROUND-VOID", block.chainid, address(this), roundId));
    }

    /// @dev Accepts the settler calling directly (no sig needed), or anyone carrying a valid EIP-191 sig.
    function _auth(bytes32 h, uint8 v, bytes32 sigR, bytes32 sigS) internal view {
        if (msg.sender == settler) return;
        bytes32 eth = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h));
        address signer = ecrecover(eth, v, sigR, sigS);
        if (signer == address(0) || signer != settler) revert BadSig();
    }

    function lockRound(uint256 roundId, uint256 refPrice, uint8 v, bytes32 sigR, bytes32 sigS) external {
        Round storage r = rounds[roundId];
        if (r.status != OPEN) revert BadRound();
        if (block.timestamp < r.lockAt) revert BadRound();
        if (refPrice == 0) revert BadRound();
        _auth(lockHash(roundId, refPrice), v, sigR, sigS);
        r.refPrice = refPrice;
        r.status   = LOCKED;
        emit RoundLocked(roundId, refPrice);
    }

    function settleRound(uint256 roundId, uint256 settlePrice, uint8 v, bytes32 sigR, bytes32 sigS)
        external
        nonReentrant
    {
        Round storage r = rounds[roundId];
        if (r.status != LOCKED) revert BadRound();
        if (block.timestamp < r.expiresAt) revert BadRound();
        if (settlePrice == 0) revert BadRound();
        _auth(settleHash(roundId, settlePrice), v, sigR, sigS);

        r.settlePrice = settlePrice;
        r.result = settlePrice > r.refPrice ? UP
                 : settlePrice < r.refPrice ? DOWN
                 : PUSH;
        r.status = SETTLED;

        // Transfer losers' stakes to house atomically at settle time.
        uint256 loserSum = r.result == UP   ? r.downStakes
                         : r.result == DOWN ? r.upStakes
                         : 0;
        if (loserSum > 0) vault.settleLoss(loserSum);
        emit RoundSettled(roundId, r.result, settlePrice);
    }

    function voidRound(uint256 roundId, uint8 v, bytes32 sigR, bytes32 sigS) external {
        Round storage r = rounds[roundId];
        if (r.status != OPEN && r.status != LOCKED) revert BadRound();
        _auth(voidHash(roundId), v, sigR, sigS);
        r.status = VOID;
        emit RoundVoided(roundId);
    }

    function forceVoidExpired(uint256 roundId) external {
        Round storage r = rounds[roundId];
        if (r.status != OPEN && r.status != LOCKED) revert BadRound();
        if (block.timestamp <= r.expiresAt) revert BadRound();
        r.status = VOID;
        emit RoundVoided(roundId);
    }

    // ---- claims ----

    /// @notice Claim the outcome of a settled or voided bet.
    ///         Winners: stake + profit returned.
    ///         Push:    stake returned, fee kept.
    ///         Losers:  no payout (stake already moved to house at settle).
    ///         Void:    full refund including fee.
    function claim(uint256 betId) external nonReentrant {
        Bet storage b = bets[betId];
        if (b.claimed) revert AlreadyClaimed();
        Round storage r = rounds[b.roundId];
        if (r.status != SETTLED && r.status != VOID) revert BadRound();
        b.claimed = true;

        if (r.status == VOID) {
            vault.voidRefund(b.user, b.stake, b.fee);
            emit Claimed(betId, b.user, uint256(b.stake) + b.fee);
            return;
        }

        bool won = (r.result == UP && b.up) || (r.result == DOWN && !b.up);
        if (won) {
            uint256 profit = (uint256(b.stake) * (r.payoutBps - 10000)) / 10000;
            vault.settleWin(b.user, b.stake, profit);
            emit Claimed(betId, b.user, uint256(b.stake) + profit);
        } else if (r.result == PUSH) {
            vault.settlePush(b.user, b.stake);
            emit Claimed(betId, b.user, b.stake);
        } else {
            // Loser — stake already moved to house at settleRound; nothing to transfer.
            emit Claimed(betId, b.user, 0);
        }
    }
}
