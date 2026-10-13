// The Dynamic identity flip, on Monad mainnet.
//
// Two wallets, two jobs. The developer's wallet (a plain key) deploys, pays and
// approves. The agent's wallet is a Dynamic TWO_OF_TWO server wallet: one key
// share on this server, one with Dynamic, both needed to sign. Whoever owns the
// ERC-8004 identity NFT is the agent.
//
// This registers a fresh demo agent, so Monsmith's own identity (#10332) is
// never touched, then shows the flip:
//   1. the developer registers the agent and deploys AgentGate for it
//   2. the developer can act; the server wallet is refused (NotTheAgent)
//   3. the identity moves to the server wallet
//   4. the server wallet can act; the developer is refused
// A refused call is shown with a simulated call, so no gas is spent on a revert.
//
// Reads MONSMITH_ATTESTER_KEY (the developer wallet) and the DYNAMIC_* settings
// from .env.local. Spends a little MON from both wallets. Secrets are never printed.
//
// usage: node scripts/dynamic-identity-flip.mjs

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import dotenv from "dotenv";
import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, decodeEventLog, formatEther, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import { DynamicEvmWalletClient } from "@dynamic-labs-wallet/node-evm";

dotenv.config({ path: ".env.local", quiet: true });

const IDENTITY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const EXPLORER = monad.blockExplorers.default.url;
const AGENT_URI = "https://github.com/Adwaitbytes/monsmith/tree/main/examples/dynamic-agent-identity";

const env = process.env;
for (const name of ["MONSMITH_ATTESTER_KEY", "DYNAMIC_ENVIRONMENT_ID", "DYNAMIC_AUTH_TOKEN", "DYNAMIC_WALLET_METADATA", "DYNAMIC_SERVER_KEY_SHARES", "DYNAMIC_WALLET_PASSWORD"]) {
    if (!env[name]) {
        console.error(`Needs ${name} in .env.local.`);
        process.exit(1);
    }
}

const rpc = env.MONAD_MAINNET_RPC ?? "https://rpc.monad.xyz";
const client = createPublicClient({ chain: monad, transport: http(rpc) });
const developer = createWalletClient({ account: privateKeyToAccount(env.MONSMITH_ATTESTER_KEY), chain: monad, transport: http(rpc) });

const decode = (value) => JSON.parse(Buffer.from(value, "base64").toString("utf8"));
const dynamic = new DynamicEvmWalletClient({ environmentId: env.DYNAMIC_ENVIRONMENT_ID });
await dynamic.authenticateApiToken(env.DYNAMIC_AUTH_TOKEN);
const server = await dynamic.getWalletClient({
    walletMetadata: decode(env.DYNAMIC_WALLET_METADATA),
    externalServerKeyShares: decode(env.DYNAMIC_SERVER_KEY_SHARES),
    password: env.DYNAMIC_WALLET_PASSWORD,
    chain: monad,
    rpcUrl: rpc,
});

const dev = developer.account.address;
const agentWallet = server.account.address;
console.log(`developer wallet ${dev} (${formatEther(await client.getBalance({ address: dev }))} MON)`);
console.log(`Dynamic server wallet ${agentWallet} (${formatEther(await client.getBalance({ address: agentWallet }))} MON)\n`);

const identityAbi = parseAbi([
    "function register(string agentURI) returns (uint256 agentId)",
    "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
    "function ownerOf(uint256 agentId) view returns (address)",
    "function transferFrom(address from, address to, uint256 tokenId)",
]);

const solc = createRequire(import.meta.url)("solc");
const compiled = JSON.parse(
    solc.compile(
        JSON.stringify({
            language: "Solidity",
            sources: { "AgentGate.sol": { content: readFileSync("contracts/examples/AgentGate.sol", "utf8") } },
            settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
        }),
    ),
);
const { abi: gateAbi, evm } = compiled.contracts["AgentGate.sol"].AgentGate;
const bytecode = `0x${evm.bytecode.object}`;

async function send(wallet, label, request) {
    const hash = await wallet.writeContract(request);
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
    console.log(`  ${label}: ${EXPLORER}/tx/${hash}`);
    return receipt;
}

async function refused(account, label, gate) {
    try {
        await client.simulateContract({ address: gate, abi: gateAbi, functionName: "act", account });
        throw new Error(`${label} was expected to be refused and was not`);
    } catch (error) {
        const revert = error instanceof BaseError ? error.walk((cause) => cause instanceof ContractFunctionRevertedError) : null;
        if (!(revert instanceof ContractFunctionRevertedError) || revert.data?.errorName !== "NotTheAgent") throw error;
        const [caller, agent] = revert.data.args;
        console.log(`  ${label}: refused, NotTheAgent(caller ${caller}, agent ${agent})`);
    }
}

console.log("1. The developer registers the agent and deploys the gate");
const registered = await send(developer, "register agent", {
    address: IDENTITY,
    abi: identityAbi,
    functionName: "register",
    args: [AGENT_URI],
});
const agentId = registered.logs
    .map((log) => {
        try {
            return decodeEventLog({ abi: identityAbi, data: log.data, topics: log.topics });
        } catch {
            return null;
        }
    })
    .find((event) => event?.eventName === "Registered")?.args.agentId;
if (agentId === undefined) throw new Error("No Registered event in the registration receipt.");
console.log(`  agent #${agentId}, owned by the developer`);

const deployHash = await developer.deployContract({ abi: gateAbi, bytecode, args: [IDENTITY, agentId] });
const deployed = await client.waitForTransactionReceipt({ hash: deployHash });
const gate = deployed.contractAddress;
console.log(`  AgentGate ${gate}: ${EXPLORER}/tx/${deployHash}\n`);

console.log("2. While the developer holds the identity");
await send(developer, "developer acts", { address: gate, abi: gateAbi, functionName: "act" });
await refused(server.account, "server wallet acts", gate);

console.log("\n3. The identity moves to the Dynamic server wallet");
await send(developer, "transfer identity", { address: IDENTITY, abi: identityAbi, functionName: "transferFrom", args: [dev, agentWallet, agentId] });
console.log(`  ownerOf(${agentId}) is now ${await client.readContract({ address: IDENTITY, abi: identityAbi, functionName: "ownerOf", args: [agentId] })}`);

console.log("\n4. Now the server wallet is the agent");
await send(server, "server wallet acts", { address: gate, abi: gateAbi, functionName: "act" });
await refused(developer.account, "developer acts", gate);

console.log(`\nDone. AgentGate ${gate} for agent #${agentId}: ${EXPLORER}/address/${gate}`);
