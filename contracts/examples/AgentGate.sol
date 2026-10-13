// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAgentIdentity {
    function ownerOf(uint256 agentId) external view returns (address);
}

/// @title AgentGate
/// @notice The smallest contract that tells an agent's signing identity apart
///         from the developer's own wallet. Only whoever holds the agent's
///         ERC-8004 identity right now can call act(). Move the identity and
///         the power to act moves with it, read fresh on every call.
contract AgentGate {
    IAgentIdentity public immutable registry;
    uint256 public immutable agentId;
    uint256 public actions;

    event Acted(address indexed by, uint256 count);

    error NotTheAgent(address caller, address agent);

    constructor(IAgentIdentity registry_, uint256 agentId_) {
        registry = registry_;
        agentId = agentId_;
    }

    function act() external {
        address agent = registry.ownerOf(agentId);
        if (msg.sender != agent) revert NotTheAgent(msg.sender, agent);
        actions += 1;
        emit Acted(msg.sender, actions);
    }
}
