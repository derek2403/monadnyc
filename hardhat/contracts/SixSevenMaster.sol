// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title Six Seven Master
/// @notice A trophy NFT minted to the winner of a "What's 67?" match.
///         Every token shares the same on-chain metadata (the master badge).
contract SixSevenMaster is ERC721, Ownable {
    uint256 public nextId = 1;
    address public minter; // the vault, allowed to mint on resolve
    string private _uri;

    event Minted(address indexed to, uint256 indexed tokenId);
    event MinterUpdated(address indexed minter);

    constructor(string memory tokenURI_)
        ERC721("Six Seven Master", "SIX67")
        Ownable(msg.sender)
    {
        _uri = tokenURI_;
    }

    function setMinter(address m) external onlyOwner {
        minter = m;
        emit MinterUpdated(m);
    }

    function setTokenURI(string calldata u) external onlyOwner {
        _uri = u;
    }

    /// @notice Mint a trophy. Callable by the owner or the authorized minter (vault).
    function mint(address to) external returns (uint256) {
        require(msg.sender == owner() || msg.sender == minter, "not authorized");
        uint256 id = nextId++;
        _safeMint(to, id);
        emit Minted(to, id);
        return id;
    }

    /// @dev All trophies share the same metadata.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return _uri;
    }
}
