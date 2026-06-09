// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title GameToken
/// @notice A fixed-supply ERC-20 minted to a game's developer when they launch
///         it on the GameLaunchpad. The full supply is minted once at creation.
contract GameToken is ERC20 {
    address public immutable creator;
    address public immutable launchpad;

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 supply,
        address creator_
    ) ERC20(name_, symbol_) {
        creator = creator_;
        launchpad = msg.sender;
        _mint(creator_, supply);
    }
}
