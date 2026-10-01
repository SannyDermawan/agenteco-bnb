// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * Test-only hostile ERC-20: on its next transfer or transferFrom it calls back
 * into a target (AgentEco) with prepared calldata and records how that call
 * reverted, then lets the original transfer finish. Used to prove AgentEco's
 * reentrancy guard blocks the re-entry while the legitimate call succeeds.
 */
contract ReentrantToken is ERC20 {
    address private target;
    bytes private payload;

    /// Revert data of the last re-entry attempt (empty if it succeeded).
    bytes public lastRevert;

    constructor() ERC20("Hostile USD", "hUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// Arm a single callback for the next token movement.
    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        _reenter();
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        _reenter();
        return super.transferFrom(from, to, amount);
    }

    function _reenter() private {
        address t = target;
        if (t == address(0)) return;
        target = address(0);
        (bool ok, bytes memory ret) = t.call(payload);
        lastRevert = ok ? bytes("") : ret;
    }
}
