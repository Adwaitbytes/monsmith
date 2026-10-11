// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev The part of the ERC-8004 Identity Registry this contract relies on.
///      Agents are ERC-721 tokens, so the agent's owner is `ownerOf(agentId)`.
interface IAgentIdentity {
    function ownerOf(uint256 agentId) external view returns (address);
}

/// @title Monsmith audit attestations
/// @notice An onchain record of smart contract audits produced by Monsmith,
///         written under Monsmith's ERC-8004 agent identity.
/// @dev Anyone can read an attestation; only the current owner of the Monsmith
///      agent in the ERC-8004 Identity Registry can write one. The check is made
///      against the registry on every write rather than against an address
///      stored here, so the attester is whoever controls the agent identity and
///      there is no second admin key to trust or lose.
///
///      An audit is about source code, so the primary key is the keccak256 of
///      the audited source file. When the audited code is a deployed contract,
///      the attestation is also indexed by (chainId, address), which is what a
///      wallet or an agent about to call that contract will look it up by.
contract MonsmithAttestations {
    struct Attestation {
        /// Health score, 0 to 100.
        uint8 score;
        uint16 critical;
        uint16 high;
        uint16 medium;
        uint16 low;
        uint64 timestamp;
        /// keccak256 of the full report as published, so a reader can check
        /// the report they are shown is the one that was attested.
        bytes32 reportHash;
        /// Where the full report can be read.
        string reportURI;
    }

    /// @notice The ERC-8004 Identity Registry the agent is registered in.
    IAgentIdentity public immutable identityRegistry;
    /// @notice Monsmith's agent id in that registry.
    uint256 public immutable agentId;

    mapping(bytes32 sourceHash => Attestation) private bySource;
    mapping(uint256 chainId => mapping(address target => bytes32 sourceHash)) private sourceOfDeployment;
    /// @notice How many attestations have been written, for indexers and dashboards.
    uint256 public attestationCount;

    event Attested(
        bytes32 indexed sourceHash,
        uint256 indexed chainId,
        address indexed target,
        uint8 score,
        uint16 critical,
        uint16 high,
        bytes32 reportHash,
        string reportURI
    );

    error NotAgentOwner(address caller, address owner);
    error ScoreOutOfRange(uint8 score);
    error EmptySource();
    error NotAttested();

    constructor(IAgentIdentity registry, uint256 agent) {
        identityRegistry = registry;
        agentId = agent;
        // Deploying under an identity you do not control would publish records
        // nobody could ever write to.
        address owner = registry.ownerOf(agent);
        if (owner != msg.sender) revert NotAgentOwner(msg.sender, owner);
    }

    modifier onlyAgent() {
        address owner = identityRegistry.ownerOf(agentId);
        if (msg.sender != owner) revert NotAgentOwner(msg.sender, owner);
        _;
    }

    /// @notice Records an audit. A later audit of the same source replaces the
    ///         earlier one; the event log keeps the full history.
    /// @param sourceHash keccak256 of the audited source file.
    /// @param chainId Chain the audited contract is deployed on, or 0 if it was audited as source only.
    /// @param target Deployed address, or the zero address if audited as source only.
    function attest(
        bytes32 sourceHash,
        uint256 chainId,
        address target,
        uint8 score,
        uint16 critical,
        uint16 high,
        uint16 medium,
        uint16 low,
        bytes32 reportHash,
        string calldata reportURI
    ) external onlyAgent {
        if (sourceHash == bytes32(0)) revert EmptySource();
        if (score > 100) revert ScoreOutOfRange(score);

        bySource[sourceHash] = Attestation({
            score: score,
            critical: critical,
            high: high,
            medium: medium,
            low: low,
            timestamp: uint64(block.timestamp),
            reportHash: reportHash,
            reportURI: reportURI
        });
        if (target != address(0)) sourceOfDeployment[chainId][target] = sourceHash;
        unchecked {
            attestationCount += 1;
        }

        emit Attested(sourceHash, chainId, target, score, critical, high, reportHash, reportURI);
    }

    /// @notice The latest attestation for a source file.
    function ofSource(bytes32 sourceHash) public view returns (Attestation memory attestation) {
        attestation = bySource[sourceHash];
        if (attestation.timestamp == 0) revert NotAttested();
    }

    /// @notice The latest attestation for a deployed contract.
    function ofDeployment(uint256 chainId, address target) external view returns (bytes32 sourceHash, Attestation memory attestation) {
        sourceHash = sourceOfDeployment[chainId][target];
        if (sourceHash == bytes32(0)) revert NotAttested();
        attestation = ofSource(sourceHash);
    }

    /// @notice Whether a source file has been attested at all, without reverting.
    function isAttested(bytes32 sourceHash) external view returns (bool) {
        return bySource[sourceHash].timestamp != 0;
    }
}
