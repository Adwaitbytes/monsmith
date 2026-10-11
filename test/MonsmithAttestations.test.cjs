const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * The onchain audit record.
 *
 * What matters: only whoever holds Monsmith's ERC-8004 identity can write, the
 * right holder is checked on every write (so moving the identity moves the
 * power), and a record can be found both by source and by deployed address.
 */
describe("MonsmithAttestations", function () {
    const SOURCE = ethers.keccak256(ethers.toUtf8Bytes("contract Vault {}"));
    const REPORT = ethers.keccak256(ethers.toUtf8Bytes("{\"score\":79}"));
    const URI = "https://www.monsmith.com/report/abc";

    async function deploy() {
        const [agent, stranger, newOwner] = await ethers.getSigners();
        const Identity = await ethers.getContractFactory("MockAgentIdentity");
        const identity = await Identity.connect(agent).deploy();
        await identity.connect(agent).register();
        const Attestations = await ethers.getContractFactory("MonsmithAttestations");
        const attestations = await Attestations.connect(agent).deploy(await identity.getAddress(), 1);
        return { identity, attestations, agent, stranger, newOwner };
    }

    it("refuses to deploy under an identity the deployer does not own", async function () {
        const { identity, stranger } = await deploy();
        const Attestations = await ethers.getContractFactory("MonsmithAttestations");
        await expect(Attestations.connect(stranger).deploy(await identity.getAddress(), 1)).to.be.revertedWithCustomError(
            Attestations,
            "NotAgentOwner",
        );
    });

    it("records an audit and finds it by source and by deployment", async function () {
        const { attestations, stranger } = await deploy();
        const target = stranger.address;
        await expect(attestations.attest(SOURCE, 143, target, 79, 0, 0, 3, 2, REPORT, URI))
            .to.emit(attestations, "Attested")
            .withArgs(SOURCE, 143, target, 79, 0, 0, REPORT, URI);

        const bySource = await attestations.ofSource(SOURCE);
        expect(bySource.score).to.equal(79);
        expect(bySource.medium).to.equal(3);
        expect(bySource.reportURI).to.equal(URI);

        const [sourceHash, byDeployment] = await attestations.ofDeployment(143, target);
        expect(sourceHash).to.equal(SOURCE);
        expect(byDeployment.reportHash).to.equal(REPORT);
        expect(await attestations.attestationCount()).to.equal(1);
    });

    it("lets only the agent's owner write", async function () {
        const { attestations, stranger } = await deploy();
        await expect(
            attestations.connect(stranger).attest(SOURCE, 0, ethers.ZeroAddress, 50, 0, 0, 0, 0, REPORT, URI),
        ).to.be.revertedWithCustomError(attestations, "NotAgentOwner");
    });

    it("follows the identity when it changes hands", async function () {
        const { identity, attestations, agent, newOwner } = await deploy();
        await identity.connect(agent).transfer(1, newOwner.address);
        await expect(attestations.connect(agent).attest(SOURCE, 0, ethers.ZeroAddress, 50, 0, 0, 0, 0, REPORT, URI)).to.be
            .reverted;
        await expect(attestations.connect(newOwner).attest(SOURCE, 0, ethers.ZeroAddress, 50, 0, 0, 0, 0, REPORT, URI)).to.emit(
            attestations,
            "Attested",
        );
    });

    it("rejects an impossible score and an empty source", async function () {
        const { attestations } = await deploy();
        await expect(attestations.attest(SOURCE, 0, ethers.ZeroAddress, 101, 0, 0, 0, 0, REPORT, URI)).to.be.revertedWithCustomError(
            attestations,
            "ScoreOutOfRange",
        );
        await expect(attestations.attest(ethers.ZeroHash, 0, ethers.ZeroAddress, 50, 0, 0, 0, 0, REPORT, URI)).to.be.revertedWithCustomError(
            attestations,
            "EmptySource",
        );
    });

    it("says plainly when there is no record, and a newer audit replaces the old one", async function () {
        const { attestations } = await deploy();
        expect(await attestations.isAttested(SOURCE)).to.equal(false);
        await expect(attestations.ofSource(SOURCE)).to.be.revertedWithCustomError(attestations, "NotAttested");
        await attestations.attest(SOURCE, 0, ethers.ZeroAddress, 39, 1, 1, 3, 3, REPORT, URI);
        await attestations.attest(SOURCE, 0, ethers.ZeroAddress, 79, 0, 0, 3, 2, REPORT, URI);
        expect((await attestations.ofSource(SOURCE)).score).to.equal(79);
        expect(await attestations.attestationCount()).to.equal(2);
    });
});
