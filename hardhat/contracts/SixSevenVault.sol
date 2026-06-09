// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMaster {
    function mint(address to) external returns (uint256);
}

/// @title Six Seven Vault
/// @notice Escrow for "What's 67?" matches. Two players stake MON into a match
///         (keyed by the room code). The trusted resolver (game server) declares
///         the winner, who takes the whole pot and receives a Six Seven Master NFT.
contract SixSevenVault {
    address public owner; // trusted resolver / game server
    IMaster public immutable nft;

    enum Status {
        None,
        Open, // host funded, waiting for guest
        Funded, // both funded, ready to play
        Resolved,
        Cancelled
    }

    struct Match {
        address host;
        address guest;
        uint128 hostStake;
        uint128 guestStake;
        Status status;
    }

    mapping(bytes32 => Match) public matches;

    event MatchCreated(bytes32 indexed id, address indexed host, uint256 stake);
    event MatchJoined(bytes32 indexed id, address indexed guest, uint256 stake);
    event MatchResolved(bytes32 indexed id, address indexed winner, uint256 pot, uint256 tokenId);
    event MatchCancelled(bytes32 indexed id);
    event OwnerUpdated(address indexed owner);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address nft_) {
        owner = msg.sender;
        nft = IMaster(nft_);
    }

    function setOwner(address o) external onlyOwner {
        owner = o;
        emit OwnerUpdated(o);
    }

    /// @notice Host opens a match for `id` (= keccak256 of the room code) and stakes.
    function createMatch(bytes32 id) external payable {
        Match storage m = matches[id];
        require(m.status == Status.None, "match exists");
        require(msg.value > 0, "stake required");
        m.host = msg.sender;
        m.hostStake = uint128(msg.value);
        m.status = Status.Open;
        emit MatchCreated(id, msg.sender, msg.value);
    }

    /// @notice Guest joins an open match and stakes.
    function joinMatch(bytes32 id) external payable {
        Match storage m = matches[id];
        require(m.status == Status.Open, "not joinable");
        require(msg.sender != m.host, "host cannot join");
        require(msg.value > 0, "stake required");
        m.guest = msg.sender;
        m.guestStake = uint128(msg.value);
        m.status = Status.Funded;
        emit MatchJoined(id, msg.sender, msg.value);
    }

    /// @notice Resolver declares the result.
    /// @param winnerRole 0 = host wins, 1 = guest wins, 2 = tie (refund both).
    function resolve(bytes32 id, uint8 winnerRole) external onlyOwner {
        Match storage m = matches[id];
        require(m.status == Status.Funded, "not funded");
        m.status = Status.Resolved;

        if (winnerRole == 2) {
            _send(m.host, m.hostStake);
            _send(m.guest, m.guestStake);
            emit MatchResolved(id, address(0), 0, 0);
            return;
        }

        address winner = winnerRole == 0 ? m.host : m.guest;
        uint256 pot = uint256(m.hostStake) + uint256(m.guestStake);
        _send(winner, pot);

        uint256 tokenId = 0;
        try nft.mint(winner) returns (uint256 t) {
            tokenId = t;
        } catch {}

        emit MatchResolved(id, winner, pot, tokenId);
    }

    /// @notice Refund path. Host can reclaim an un-joined stake; owner can void a funded match.
    function cancel(bytes32 id) external {
        Match storage m = matches[id];
        if (m.status == Status.Open) {
            require(msg.sender == m.host || msg.sender == owner, "not allowed");
            uint256 amt = m.hostStake;
            m.status = Status.Cancelled;
            _send(m.host, amt);
        } else if (m.status == Status.Funded) {
            require(msg.sender == owner, "owner only");
            uint256 h = m.hostStake;
            uint256 g = m.guestStake;
            m.status = Status.Cancelled;
            _send(m.host, h);
            _send(m.guest, g);
        } else {
            revert("bad status");
        }
        emit MatchCancelled(id);
    }

    function getMatch(bytes32 id)
        external
        view
        returns (
            address host,
            address guest,
            uint256 hostStake,
            uint256 guestStake,
            uint8 status
        )
    {
        Match storage m = matches[id];
        return (m.host, m.guest, m.hostStake, m.guestStake, uint8(m.status));
    }

    function _send(address to, uint256 amt) internal {
        if (amt == 0 || to == address(0)) return;
        (bool ok, ) = payable(to).call{value: amt}("");
        require(ok, "transfer failed");
    }
}
