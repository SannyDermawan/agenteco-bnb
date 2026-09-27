// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockUSDT
 * @notice Test token for the AgentEco BSC Testnet deployment, so judges and
 * testers never depend on a third-party faucet. It is NOT real USDT — the
 * name and symbol say so on purpose.
 *
 * - 18 decimals, the same as USDT on BNB Chain mainnet.
 * - faucet(): anyone can mint 100 mUSDT to themselves, once per 24 hours.
 * - mint(): the owner (deployer) mints freely for load tests and demo prep.
 */
contract MockUSDT is ERC20, Ownable {
    uint256 public constant FAUCET_AMOUNT = 100e18;
    uint256 public constant FAUCET_COOLDOWN = 24 hours;

    /// Timestamp of each wallet's last faucet claim (0 = never claimed).
    mapping(address => uint256) public lastClaim;

    event FaucetClaimed(address indexed user, uint256 amount);

    constructor() ERC20("Mock USDT", "mUSDT") Ownable(msg.sender) {}

    /**
     * @notice Mint FAUCET_AMOUNT to the caller. Reverts during the caller's
     * 24-hour cooldown; the cooldown is per wallet.
     */
    function faucet() external {
        uint256 last = lastClaim[msg.sender];
        require(last == 0 || block.timestamp >= last + FAUCET_COOLDOWN, "Faucet cooldown active");

        lastClaim[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);

        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }

    /**
     * @notice When `user` can claim again: 0 if they never claimed,
     * otherwise lastClaim + FAUCET_COOLDOWN.
     */
    function nextClaimAt(address user) external view returns (uint256) {
        uint256 last = lastClaim[user];
        return last == 0 ? 0 : last + FAUCET_COOLDOWN;
    }

    /// @notice Owner-only mint, for load-test wallets and demo preparation.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
