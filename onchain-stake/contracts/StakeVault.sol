// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract StakeVault is Ownable, Pausable {
    using SafeERC20 for IERC20;

    error NotOperator();
    error UseUnstake();
    error NotUnlocked();
    error UtilizationCapExceeded();
    error RenounceDisabled();
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientDeployed();

    event Staked(address indexed user, uint256 amount, uint256 unlockTime);
    event Unstaked(address indexed user, uint256 amount);
    event EarlyExit(address indexed user, uint256 returned, uint256 penalty);
    event RewardsClaimed(address indexed user, uint256 amount);
    event DeployedToHouse(uint256 amount, uint256 totalDeployed);
    event RecalledToReserve(uint256 amount, uint256 totalDeployed);
    event BuybackRecorded(uint256 usdcAmount, uint256 buybackReserve);
    event OperatorSet(address indexed newOperator);
    event PenaltyAccrued(address indexed user, uint256 amount);
    event PenaltyClaimed(address indexed recipient, uint256 amount);

    address public constant USDC = 0x3600000000000000000000000000000000000000;

    // ~12% APR: 0.12 HBLK per USDC per year;
    // REWARD_RATE = 0.12e18 / (365*24*3600*1e6) ≈ 3805 raw HBLK per raw USDC per second
    uint256 public constant REWARD_RATE = 3805;
    uint256 public constant LOCK_PERIOD = 30 days;
    uint256 public constant EARLY_EXIT_PENALTY_BPS = 1000;
    uint256 public constant utilizationCapBps = 3000;
    uint256 private constant BPS = 10_000;

    mapping(address => uint256) private _staked;
    mapping(address => uint256) private _unlockTime;
    mapping(address => uint256) private _lastUpdate;
    mapping(address => uint256) private _pending;

    uint256 public totalStaked;
    uint256 public totalDeployed;
    uint256 public buybackReserve;
    // Penalty accounting: earlyExit() accrues here instead of pushing to owner.
    // This prevents USDC-blocklist on owner() from bricking all early exits.
    uint256 public unclaimedPenalty;

    address public immutable operator;
    // rewardToken is set once by owner via initRewardToken() after HBLK is deployed
    // with this vault's address as the mint recipient. Immutable after initialization.
    address public rewardToken;
    bool public rewardTokenSet;

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    /// @dev rewardToken is NOT set here; call initRewardToken() after deploying HBLK
    ///      with this contract's address as the vault/mint-recipient.
    constructor(address _owner, address _operator) Ownable(_owner) {
        // Note: _owner == address(0) is already checked by OZ Ownable (reverts with
        // OwnableInvalidOwner). We guard the operator arg here.
        if (_operator == address(0)) {
            revert ZeroAddress();
        }

        operator = _operator;

        emit OperatorSet(_operator);
    }

    /// @notice One-time setter: wire in the HBLK reward token after it has been
    ///         deployed with this vault as the mint recipient.
    function initRewardToken(address _rewardToken) external onlyOwner {
        if (rewardTokenSet) revert ZeroAmount(); // reuse error: already initialized
        if (_rewardToken == address(0)) revert ZeroAddress();
        rewardToken = _rewardToken;
        rewardTokenSet = true;
    }

    function stake(uint256 amount) external whenNotPaused {
        if (amount == 0) revert ZeroAmount();

        IERC20(USDC).safeTransferFrom(msg.sender, address(this), amount);

        _updateRewards(msg.sender);

        _staked[msg.sender] += amount;
        totalStaked += amount;
        uint256 userUnlockTime = block.timestamp + LOCK_PERIOD;
        _unlockTime[msg.sender] = userUnlockTime;

        emit Staked(msg.sender, amount, userUnlockTime);
    }

    function claimRewards() external whenNotPaused {
        if (!rewardTokenSet) revert ZeroAddress(); // guard: must call initRewardToken first
        _updateRewards(msg.sender);

        uint256 pending = _pending[msg.sender];
        if (pending == 0) revert ZeroAmount();

        _pending[msg.sender] = 0;
        IERC20(rewardToken).safeTransfer(msg.sender, pending);

        emit RewardsClaimed(msg.sender, pending);
    }

    function earlyExit() external whenNotPaused {
        uint256 total = _staked[msg.sender];
        if (total == 0) revert ZeroAmount();
        if (block.timestamp >= _unlockTime[msg.sender]) revert UseUnstake();

        _updateRewards(msg.sender);

        uint256 penalty = (total * EARLY_EXIT_PENALTY_BPS) / BPS;
        uint256 userGets = total - penalty;

        _staked[msg.sender] = 0;
        _unlockTime[msg.sender] = 0;
        totalStaked -= total;

        // Penalty is accrued in-contract so a blocklisted owner cannot brick exits.
        // Treasury pulls via claimPenalty().
        unclaimedPenalty += penalty;

        IERC20(USDC).safeTransfer(msg.sender, userGets);

        emit EarlyExit(msg.sender, userGets, penalty);
        emit PenaltyAccrued(msg.sender, penalty);
    }

    /// @notice Owner (treasury) pulls accrued early-exit penalties.
    function claimPenalty() external onlyOwner {
        uint256 amount = unclaimedPenalty;
        if (amount == 0) revert ZeroAmount();
        unclaimedPenalty = 0;
        IERC20(USDC).safeTransfer(owner(), amount);
        emit PenaltyClaimed(owner(), amount);
    }

    function unstake() external whenNotPaused {
        uint256 total = _staked[msg.sender];
        if (total == 0) revert ZeroAmount();
        if (block.timestamp < _unlockTime[msg.sender]) revert NotUnlocked();

        _updateRewards(msg.sender);

        _staked[msg.sender] = 0;
        _unlockTime[msg.sender] = 0;
        totalStaked -= total;

        IERC20(USDC).safeTransfer(msg.sender, total);

        emit Unstaked(msg.sender, total);
    }

    /// @notice Moves USDC to the operator house bankroll.
    /// @dev TRUST MODEL: Up to 30% of totalStaked can be deployed offchain. Recovery
    ///      depends on the operator calling recallToReserve(). This is an intentional
    ///      design choice: the operator is a trusted party (house bankroll). Users
    ///      implicitly accept this counterparty risk when staking. The liquid-reserve
    ///      floor below guarantees the remaining 70% is always withdrawable on-chain.
    function deployToHouse(uint256 amount) external onlyOperator whenNotPaused {
        if (amount == 0) revert ZeroAmount();

        uint256 maxDeployable = (totalStaked * utilizationCapBps) / BPS;
        if (totalDeployed + amount > maxDeployable) revert UtilizationCapExceeded();

        // Liquid-reserve floor: after this transfer the vault must still hold at
        // least (totalStaked - (totalDeployed + amount)) USDC so that unstakes of
        // the non-deployed portion can never be undercollateralised.
        uint256 newDeployed = totalDeployed + amount;
        uint256 requiredReserve = totalStaked - newDeployed; // safe: cap ensures newDeployed <= 30% < totalStaked
        uint256 vaultBalance = IERC20(USDC).balanceOf(address(this));
        if (vaultBalance < amount + requiredReserve) revert UtilizationCapExceeded();

        totalDeployed = newDeployed;
        IERC20(USDC).safeTransfer(operator, amount);

        emit DeployedToHouse(amount, totalDeployed);
    }

    function recallToReserve(uint256 amount) external onlyOperator {
        if (amount == 0) revert ZeroAmount();
        if (totalDeployed < amount) revert InsufficientDeployed();

        totalDeployed -= amount;
        IERC20(USDC).safeTransferFrom(operator, address(this), amount);

        emit RecalledToReserve(amount, totalDeployed);
    }

    function buyback(uint256 usdcAmount) external onlyOperator {
        if (usdcAmount == 0) revert ZeroAmount();

        IERC20(USDC).safeTransferFrom(operator, address(this), usdcAmount);
        buybackReserve += usdcAmount;

        emit BuybackRecorded(usdcAmount, buybackReserve);
    }

    function pause() external onlyOperator {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    function stakedBalance(address user) external view returns (uint256) {
        return _staked[user];
    }

    function accruedRewards(address user) external view returns (uint256) {
        uint256 pending = _pending[user];
        uint256 lastUpdate = _lastUpdate[user];

        if (lastUpdate == 0 || _staked[user] == 0) {
            return pending;
        }

        uint256 elapsed = block.timestamp - lastUpdate;
        return pending + (_staked[user] * REWARD_RATE * elapsed);
    }

    function unlockTime(address user) external view returns (uint256) {
        return _unlockTime[user];
    }

    function treasury() external view returns (address) {
        return owner();
    }

    function _updateRewards(address user) internal {
        if (_staked[user] > 0 && _lastUpdate[user] > 0) {
            uint256 elapsed = block.timestamp - _lastUpdate[user];
            _pending[user] += _staked[user] * REWARD_RATE * elapsed;
        }
        _lastUpdate[user] = block.timestamp;
    }
}
