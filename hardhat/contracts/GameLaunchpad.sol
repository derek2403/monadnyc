// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GameToken} from "./GameToken.sol";

/// @title GameLaunchpad
/// @notice A permissionless launchpad: any developer can "host" a game, which
///         deploys a dedicated ERC-20 token (supply minted to them) and records
///         the game in an on-chain registry that the arcade reads back.
contract GameLaunchpad {
    struct Game {
        address token;
        address creator;
        string name;
        string symbol;
        string description;
        string genre;
        string coverImage;
        string thumbnail;
        string gameUrl;
        uint256 supply;
        uint64 createdAt;
    }

    Game[] private _games;
    mapping(address => uint256[]) private _byCreator;

    event GameLaunched(
        uint256 indexed id,
        address indexed token,
        address indexed creator,
        string name,
        string symbol,
        uint256 supply
    );

    error EmptyName();
    error EmptySymbol();
    error ZeroSupply();

    /// @notice Host a game: mint its ERC-20 and register it.
    /// @param supply Total token supply in base units (18 decimals).
    /// @return id Registry index of the new game.
    /// @return token Address of the freshly deployed ERC-20.
    function launchGame(
        string calldata name,
        string calldata symbol,
        string calldata description,
        string calldata genre,
        string calldata coverImage,
        string calldata thumbnail,
        string calldata gameUrl,
        uint256 supply
    ) external returns (uint256 id, address token) {
        if (bytes(name).length == 0) revert EmptyName();
        if (bytes(symbol).length == 0) revert EmptySymbol();
        if (supply == 0) revert ZeroSupply();

        GameToken t = new GameToken(name, symbol, supply, msg.sender);
        token = address(t);
        id = _games.length;

        _games.push(
            Game({
                token: token,
                creator: msg.sender,
                name: name,
                symbol: symbol,
                description: description,
                genre: genre,
                coverImage: coverImage,
                thumbnail: thumbnail,
                gameUrl: gameUrl,
                supply: supply,
                createdAt: uint64(block.timestamp)
            })
        );
        _byCreator[msg.sender].push(id);

        emit GameLaunched(id, token, msg.sender, name, symbol, supply);
    }

    function gameCount() external view returns (uint256) {
        return _games.length;
    }

    function getGame(uint256 id) external view returns (Game memory) {
        return _games[id];
    }

    /// @notice Read a slice of the registry (oldest-first). Pass a large limit
    ///         to fetch everything; the arcade sorts newest-first client-side.
    function getGames(uint256 offset, uint256 limit)
        external
        view
        returns (Game[] memory list)
    {
        uint256 n = _games.length;
        if (offset >= n) return new Game[](0);
        uint256 end = offset + limit;
        if (end > n) end = n;
        list = new Game[](end - offset);
        for (uint256 i = 0; i < list.length; i++) {
            list[i] = _games[offset + i];
        }
    }

    function gamesByCreator(address creator) external view returns (uint256[] memory) {
        return _byCreator[creator];
    }
}
