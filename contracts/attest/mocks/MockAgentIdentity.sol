// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev A stand-in for the ERC-8004 Identity Registry, for tests only: agents
///      are numbered tokens with an owner, and ownership can move.
contract MockAgentIdentity {
    mapping(uint256 => address) private owners;
    uint256 private next = 1;

    function register() external returns (uint256 agentId) {
        agentId = next++;
        owners[agentId] = msg.sender;
    }

    function transfer(uint256 agentId, address to) external {
        require(owners[agentId] == msg.sender, "not owner");
        owners[agentId] = to;
    }

    function ownerOf(uint256 agentId) external view returns (address) {
        address owner = owners[agentId];
        require(owner != address(0), "no such agent");
        return owner;
    }
}
