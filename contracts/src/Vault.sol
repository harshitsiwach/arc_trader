// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Vault — custodial USDC ledger for the up/down house.
/// @notice Users deposit Arc USDC (6-decimal ERC-20 view) once; the Rounds
/// contract locks/releases/pays from internal balances. The operator (hot
/// server key) can pause; only the owner (cold) can sweep house funds or
/// unpause. All money in USDC base units (1e6).
/// @dev Invariant: usdc.balanceOf(address(this)) == sum(balances) + escrow + houseBalance
contract Vault is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;

    address public rounds;
    address public operator;
    uint256 public dailyWithdrawCap; // base units per UTC day, 0 = uncapped
    mapping(uint256 => uint256) public withdrawnPerDay;
    mapping(address => uint256) public balances;
    uint256 public escrow;       // total user stakes locked in live rounds
    uint256 public houseBalance; // fees + lost stakes - profits paid (accounting)

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event HouseFunded(uint256 amount);
    event Swept(address indexed to, uint256 amount);
    event RoundsSet(address indexed oldRounds, address indexed newRounds);
    event OperatorSet(address indexed oldOperator, address indexed newOperator);
    event DailyWithdrawCapSet(uint256 oldCap, uint256 newCap);

    error NotRounds();
    error InsufficientBalance();
    error ZeroAddress();
    error ZeroAmount();

    modifier onlyRounds() {
        if (msg.sender != rounds) revert NotRounds();
        _;
    }

    constructor(address usdc_, address owner_, address operator_) Ownable(owner_) {
        if (usdc_ == address(0) || owner_ == address(0) || operator_ == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
        operator = operator_;
    }

    // ---- admin ----

    function setRounds(address rounds_) external onlyOwner {
        if (rounds_ == address(0)) revert ZeroAddress();
        address oldRounds = rounds;
        rounds = rounds_;
        emit RoundsSet(oldRounds, rounds_);
    }

    function setOperator(address operator_) external onlyOwner {
        if (operator_ == address(0)) revert ZeroAddress();
        address oldOperator = operator;
        operator = operator_;
        emit OperatorSet(oldOperator, operator_);
    }

    function setDailyWithdrawCap(uint256 cap) external onlyOwner {
        uint256 oldCap = dailyWithdrawCap;
        dailyWithdrawCap = cap;
        emit DailyWithdrawCapSet(oldCap, cap);
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

    /// @notice Owner seeds the house bankroll from cold.
    function fundHouse(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        houseBalance += amount;
        emit HouseFunded(amount);
    }

    /// @notice Owner sweeps house profits to cold. Never touches user funds:
    /// contract balance == user balances + escrow + houseBalance always.
    function sweep(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        houseBalance -= amount; // reverts on underflow if amount > houseBalance
        usdc.safeTransfer(to, amount);
        emit Swept(to, amount);
    }

    // ---- users ----

    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        balances[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (balances[msg.sender] < amount) revert InsufficientBalance();
        balances[msg.sender] -= amount;
        if (dailyWithdrawCap > 0) {
            uint256 day = block.timestamp / 1 days;
            withdrawnPerDay[day] += amount;
            require(withdrawnPerDay[day] <= dailyWithdrawCap, "daily cap");
        }
        usdc.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // ---- Rounds contract only ----

    /// @notice Lock a user's stake + fee for a bet. Fee moves to the house immediately.
    function lockStake(address user, uint256 stake, uint256 fee) external onlyRounds {
        uint256 total = stake + fee;
        if (balances[user] < total) revert InsufficientBalance();
        balances[user] -= total;
        escrow += stake;
        houseBalance += fee;
    }

    /// @notice Winner claims back stake; profit comes from the house.
    function settleWin(address user, uint256 stake, uint256 profit) external onlyRounds {
        escrow -= stake;       // reverts on underflow
        houseBalance -= profit; // reverts on underflow
        balances[user] += stake + profit;
    }

    /// @notice Losers' stakes move to the house in one call at settle time.
    function settleLoss(uint256 loserStakes) external onlyRounds {
        escrow -= loserStakes; // reverts on underflow
        houseBalance += loserStakes;
    }

    /// @notice Push: stakes back, fees kept (round resolved fairly).
    function settlePush(address user, uint256 stake) external onlyRounds {
        escrow -= stake; // reverts on underflow
        balances[user] += stake;
    }

    /// @notice Void (operator-side failure): full refund incl. fee.
    function voidRefund(address user, uint256 stake, uint256 fee) external onlyRounds {
        escrow -= stake;       // reverts on underflow
        houseBalance -= fee;   // reverts on underflow
        balances[user] += stake + fee;
    }
}
