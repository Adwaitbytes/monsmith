// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ReceiverTemplate} from "./ReceiverTemplate.sol";

interface IMonsmithAttestations {
    struct Attestation {
        uint8 score;
        uint16 critical;
        uint16 high;
        uint16 medium;
        uint16 low;
        uint64 timestamp;
        bytes32 reportHash;
        string reportURI;
    }

    function isAttested(bytes32 sourceHash) external view returns (bool);
    function ofSource(bytes32 sourceHash) external view returns (Attestation memory);
}

/// @title MonsmithVerdicts
/// @notice A second opinion on every Monsmith attestation, from a Chainlink DON.
/// @dev Monsmith attests an audit under its ERC-8004 identity; that is one
///      party's word. A Chainlink CRE workflow reacts to each Attested event,
///      has every node check independently that the published report still
///      hashes to what was attested, and delivers the agreed verdict here
///      through the Keystone forwarder. A contract that wants more than
///      Monsmith's word asks `isConfirmed`, which only answers yes for the
///      attestation that is current on chain, so a re-audit is never vouched
///      for by the verdict on the one before it.
contract MonsmithVerdicts is ReceiverTemplate {
    struct Verdict {
        uint8 score;
        bool reportMatches;
        uint64 verifiedAt;
        bytes32 reportHash;
    }

    /// @notice The attestations this contract gives second opinions on.
    IMonsmithAttestations public immutable attestations;

    mapping(bytes32 sourceHash => Verdict) private verdicts;
    /// @notice How many verdicts the DON has delivered.
    uint256 public verdictCount;

    event Verified(bytes32 indexed sourceHash, uint8 score, bool reportMatches, bytes32 reportHash);

    error NoVerdict();

    constructor(address forwarder, IMonsmithAttestations attestations_) ReceiverTemplate(forwarder) {
        attestations = attestations_;
    }

    /// @inheritdoc ReceiverTemplate
    function _processReport(bytes calldata report) internal override {
        (bytes32 sourceHash, uint8 score, bytes32 reportHash, bool reportMatches) =
            abi.decode(report, (bytes32, uint8, bytes32, bool));
        verdicts[sourceHash] = Verdict({
            score: score,
            reportMatches: reportMatches,
            verifiedAt: uint64(block.timestamp),
            reportHash: reportHash
        });
        unchecked {
            ++verdictCount;
        }
        emit Verified(sourceHash, score, reportMatches, reportHash);
    }

    /// @notice The DON's verdict on a source, whether or not it is still current.
    function verdictOf(bytes32 sourceHash) external view returns (Verdict memory verdict) {
        verdict = verdicts[sourceHash];
        if (verdict.verifiedAt == 0) revert NoVerdict();
    }

    /// @notice True when the source is attested, the DON confirmed that very
    ///         attestation's report, and the score is at least `minScore`.
    function isConfirmed(bytes32 sourceHash, uint8 minScore) external view returns (bool) {
        Verdict memory verdict = verdicts[sourceHash];
        if (verdict.verifiedAt == 0 || !verdict.reportMatches) return false;
        if (!attestations.isAttested(sourceHash)) return false;
        IMonsmithAttestations.Attestation memory current = attestations.ofSource(sourceHash);
        return current.reportHash == verdict.reportHash && current.score == verdict.score && current.score >= minScore;
    }
}
