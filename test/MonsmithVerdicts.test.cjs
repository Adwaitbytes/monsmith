const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * The Chainlink DON's second opinion on Monsmith's attestations.
 *
 * What matters: only the Keystone forwarder can deliver a verdict, and
 * `isConfirmed` vouches only for the attestation that is current on chain, so
 * a re-audit is never covered by the verdict on the audit before it.
 */
describe("MonsmithVerdicts", function () {
    const SOURCE = ethers.keccak256(ethers.toUtf8Bytes("contract Vault {}"));
    const REPORT = ethers.keccak256(ethers.toUtf8Bytes("{\"score\":79}"));
    const NEWER = ethers.keccak256(ethers.toUtf8Bytes("{\"score\":91}"));
    const URI = "https://www.monsmith.com/report/abc";
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const verdict = (score, reportHash, matches) =>
        coder.encode(["bytes32", "uint8", "bytes32", "bool"], [SOURCE, score, reportHash, matches]);

    async function deploy() {
        const [agent, forwarder, stranger] = await ethers.getSigners();
        const Identity = await ethers.getContractFactory("MockAgentIdentity");
        const identity = await Identity.connect(agent).deploy();
        await identity.connect(agent).register();
        const attestations = await (await ethers.getContractFactory("MonsmithAttestations")).connect(agent).deploy(await identity.getAddress(), 1);
        const verdicts = await (await ethers.getContractFactory("MonsmithVerdicts")).connect(agent).deploy(forwarder.address, await attestations.getAddress());
        return { attestations, verdicts, forwarder, stranger };
    }

    it("accepts verdicts only from the forwarder", async function () {
        const { verdicts, stranger } = await deploy();
        await expect(verdicts.connect(stranger).onReport("0x", verdict(79, REPORT, true))).to.be.revertedWithCustomError(verdicts, "InvalidSender");
    });

    it("confirms the current attestation when the DON found its report intact", async function () {
        const { attestations, verdicts, forwarder } = await deploy();
        await attestations.attest(SOURCE, 0, ethers.ZeroAddress, 79, 0, 0, 3, 2, REPORT, URI);
        await expect(verdicts.connect(forwarder).onReport("0x", verdict(79, REPORT, true)))
            .to.emit(verdicts, "Verified")
            .withArgs(SOURCE, 79, true, REPORT);
        expect(await verdicts.isConfirmed(SOURCE, 70)).to.equal(true);
        expect(await verdicts.isConfirmed(SOURCE, 80)).to.equal(false);
        expect(await verdicts.verdictCount()).to.equal(1);
    });

    it("does not confirm a report the DON found altered", async function () {
        const { attestations, verdicts, forwarder } = await deploy();
        await attestations.attest(SOURCE, 0, ethers.ZeroAddress, 79, 0, 0, 3, 2, REPORT, URI);
        await verdicts.connect(forwarder).onReport("0x", verdict(79, REPORT, false));
        expect(await verdicts.isConfirmed(SOURCE, 0)).to.equal(false);
    });

    it("stops vouching once the source is re-attested, until the DON checks the new one", async function () {
        const { attestations, verdicts, forwarder } = await deploy();
        await attestations.attest(SOURCE, 0, ethers.ZeroAddress, 79, 0, 0, 3, 2, REPORT, URI);
        await verdicts.connect(forwarder).onReport("0x", verdict(79, REPORT, true));
        await attestations.attest(SOURCE, 0, ethers.ZeroAddress, 91, 0, 0, 1, 0, NEWER, URI);
        expect(await verdicts.isConfirmed(SOURCE, 0)).to.equal(false);
        await verdicts.connect(forwarder).onReport("0x", verdict(91, NEWER, true));
        expect(await verdicts.isConfirmed(SOURCE, 90)).to.equal(true);
    });

    it("has nothing to say about a source it never saw", async function () {
        const { verdicts } = await deploy();
        expect(await verdicts.isConfirmed(SOURCE, 0)).to.equal(false);
        await expect(verdicts.verdictOf(SOURCE)).to.be.revertedWithCustomError(verdicts, "NoVerdict");
    });
});
