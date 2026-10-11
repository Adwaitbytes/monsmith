// Hands Monsmith's ERC-8004 identity to its Dynamic agent wallet.
//
// MonsmithAttestations checks ownerOf(agentId) on every write, so whoever holds
// the identity is the attester. This moves it from the bootstrap key to the
// Dynamic MPC wallet created by scripts/dynamic-agent-wallet.mjs, after first
// sending that wallet enough MON for gas. Before anything is sent it checks
// that the bootstrap key really owns the identity and that the Dynamic wallet
// is the one configured, and afterwards it proves the Dynamic wallet can
// attest by estimating an attestation from it (nothing is written).
//
// usage: node scripts/move-identity-to-dynamic.mjs [MON to send, default 0.5]

import dotenv from "dotenv";
import { createPublicClient, createWalletClient, formatEther, getAddress, http, parseAbi, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";

dotenv.config({ path: ".env.local", quiet: true });

const IDENTITY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const amount = parseEther(process.argv[2] ?? "0.5");
const { MONSMITH_ATTESTER_KEY: key, MONSMITH_AGENT_ID: agent, DYNAMIC_AGENT_ADDRESS: target, MONSMITH_ATTESTATIONS_ADDRESS: attestations } = process.env;
if (!key || !agent || !target || !attestations) {
    console.error("Needs MONSMITH_ATTESTER_KEY, MONSMITH_AGENT_ID, MONSMITH_ATTESTATIONS_ADDRESS and DYNAMIC_AGENT_ADDRESS in .env.local.");
    process.exit(1);
}

const account = privateKeyToAccount(key);
const transport = http(process.env.MONAD_MAINNET_RPC ?? "https://rpc.monad.xyz");
const client = createPublicClient({ chain: monad, transport });
const wallet = createWalletClient({ account, chain: monad, transport });
const identityAbi = parseAbi([
    "function ownerOf(uint256 agentId) view returns (address)",
    "function transferFrom(address from, address to, uint256 tokenId)",
]);
const agentId = BigInt(agent);
const to = getAddress(target);

const owner = await client.readContract({ address: IDENTITY, abi: identityAbi, functionName: "ownerOf", args: [agentId] });
if (owner.toLowerCase() === to.toLowerCase()) {
    console.log(`agent #${agentId} is already held by the Dynamic wallet ${to}`);
    process.exit(0);
}
if (owner.toLowerCase() !== account.address.toLowerCase()) {
    console.error(`agent #${agentId} is owned by ${owner}, not this key. Nothing was sent.`);
    process.exit(1);
}

if ((await client.getBalance({ address: to })) < amount) {
    const fund = await wallet.sendTransaction({ to, value: amount });
    await client.waitForTransactionReceipt({ hash: fund });
    console.log(`sent ${formatEther(amount)} MON to ${to}: ${monad.blockExplorers.default.url}/tx/${fund}`);
}

const { request } = await client.simulateContract({ address: IDENTITY, abi: identityAbi, functionName: "transferFrom", args: [account.address, to, agentId], account });
const move = await wallet.writeContract(request);
const receipt = await client.waitForTransactionReceipt({ hash: move });
if (receipt.status !== "success") throw new Error(`The transfer reverted: ${move}`);
console.log(`moved agent #${agentId} to the Dynamic wallet ${to}: ${monad.blockExplorers.default.url}/tx/${move}`);

// The proof: an attestation from the Dynamic wallet now passes the ownerOf check.
const gas = await client.estimateContractGas({
    address: attestations,
    abi: parseAbi(["function attest(bytes32 sourceHash, uint256 chainId, address target, uint8 score, uint16 critical, uint16 high, uint16 medium, uint16 low, bytes32 reportHash, string reportURI)"]),
    functionName: "attest",
    args: [`0x${"ab".repeat(32)}`, 0n, "0x0000000000000000000000000000000000000000", 50, 0, 0, 0, 0, `0x${"cd".repeat(32)}`, "https://www.monsmith.com"],
    account: to,
});
console.log(`the Dynamic wallet can attest (estimated ${gas} gas, nothing written)`);
