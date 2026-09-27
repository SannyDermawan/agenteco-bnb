// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MockUSDT} from "../contracts/MockUSDT.sol";

contract MockUSDTTest is Test {
    MockUSDT internal token;
    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    event FaucetClaimed(address indexed user, uint256 amount);

    function setUp() public {
        vm.warp(1_700_000_000);
        vm.prank(owner);
        token = new MockUSDT();
    }

    function test_metadata() public view {
        assertEq(token.decimals(), 18);
        assertEq(token.name(), "Mock USDT");
        assertEq(token.symbol(), "mUSDT");
        assertEq(token.FAUCET_AMOUNT(), 100e18);
        assertEq(token.FAUCET_COOLDOWN(), 24 hours);
        assertEq(token.owner(), owner);
    }

    function test_faucet_firstClaimMints100AndRecordsTime() public {
        vm.expectEmit(true, false, false, true);
        emit FaucetClaimed(alice, 100e18);
        vm.prank(alice);
        token.faucet();

        assertEq(token.balanceOf(alice), 100e18);
        assertEq(token.lastClaim(alice), block.timestamp);
    }

    function test_faucet_secondClaimWithin24hReverts() public {
        vm.prank(alice);
        token.faucet();

        vm.warp(block.timestamp + 24 hours - 1);
        vm.prank(alice);
        vm.expectRevert("Faucet cooldown active");
        token.faucet();
    }

    function test_faucet_claimAgainAfter24h() public {
        vm.prank(alice);
        token.faucet();

        vm.warp(block.timestamp + 24 hours);
        vm.prank(alice);
        token.faucet();

        assertEq(token.balanceOf(alice), 200e18);
    }

    function test_faucet_cooldownIsPerWallet() public {
        vm.prank(alice);
        token.faucet();

        vm.prank(bob);
        token.faucet();

        assertEq(token.balanceOf(bob), 100e18);
    }

    function test_nextClaimAt_beforeAndAfterClaim() public {
        assertEq(token.nextClaimAt(alice), 0);

        vm.prank(alice);
        token.faucet();

        assertEq(token.nextClaimAt(alice), block.timestamp + 24 hours);
        assertEq(token.nextClaimAt(bob), 0);
    }

    function test_mint_byOwner() public {
        vm.prank(owner);
        token.mint(bob, 5_000e18);
        assertEq(token.balanceOf(bob), 5_000e18);
    }

    function test_mint_revertsForNonOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        token.mint(alice, 1e18);
    }
}
