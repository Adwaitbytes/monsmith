// One-time setup of Monsmith's onchain identity on Monad mainnet.
//
// 1. Registers Monsmith as an agent in the ERC-8004 Identity Registry, with
//    its registration file at <site>/agent.json. Skipped when MONSMITH_AGENT_ID
//    is already set, so a rerun never registers a second identity.
// 2. Deploys MonsmithAttestations under that agent id. The contract checks
//    that the deployer owns the identity, so this must run from the same key.
//
// Reads MONSMITH_ATTESTER_KEY from .env.local and writes MONSMITH_AGENT_ID and
// MONSMITH_ATTESTATIONS_ADDRESS back to it. The key is never printed.
//
// usage: npx hardhat compile && node scripts/erc8004-setup.mjs

import { readFileSync, writeFileSync } from "node:fs";
import dotenv from "dotenv";
import { createPublicClient, createWalletClient, decodeEventLog, formatEther, http, parseAbi, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";

dotenv.config({ path: ".env.local", quiet: true });

const IDENTITY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.monsmith.com";
const MIN_BALANCE = parseEther("0.15");

const key = process.env.MONSMITH_ATTESTER_KEY;
if (key === undefined || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    console.error("Set MONSMITH_ATTESTER_KEY in .env.local to the private key of a dedicated, funded wallet.");
    process.exit(1);
}

const account = privateKeyToAccount(key);
const transport = http(process.env.MONAD_MAINNET_RPC ?? "https://rpc.monad.xyz");
const client = createPublicClient({ chain: monad, transport });
const wallet = createWalletClient({ account, chain: monad, transport });

const balance = await client.getBalance({ address: account.address });
console.log(`attester ${account.address} holds ${formatEther(balance)} MON`);
if (balance < MIN_BALANCE) {
    console.error(`Needs at least ${formatEther(MIN_BALANCE)} MON for registration and deployment. Nothing was sent.`);
    process.exit(1);
}

function saveEnv(name, value) {
    const lines = readFileSync(".env.local", "utf8").split("\n").filter((line) => !line.startsWith(`${name}=`) && line !== "");
    lines.push(`${name}=${value}`);
    writeFileSync(".env.local", `${lines.join("\n")}\n`);
}

const identityAbi = parseAbi([
    "function register(string agentURI) returns (uint256 agentId)",
    "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
    "function ownerOf(uint256 agentId) view returns (address)",
]);

let agentId = process.env.MONSMITH_AGENT_ID;
if (agentId === undefined || agentId === "") {
    const agentURI = `${SITE}/agent.json`;
    const { request } = await client.simulateContract({ address: IDENTITY, abi: identityAbi, functionName: "register", args: [agentURI], account });
    const hash = await wallet.writeContract(request);
    const receipt = await client.waitForTransactionReceipt({ hash });
    const registered = receipt.logs
        .filter((log) => log.address.toLowerCase() === IDENTITY.toLowerCase())
        .map((log) => {
            try {
                return decodeEventLog({ abi: identityAbi, data: log.data, topics: log.topics });
            } catch {
                return null;
            }
        })
        .find((event) => event?.eventName === "Registered");
    if (registered === undefined) throw new Error(`Registered event not found in ${hash}`);
    agentId = registered.args.agentId.toString();
    saveEnv("MONSMITH_AGENT_ID", agentId);
    console.log(`registered agent #${agentId} (${agentURI}) in ${monad.blockExplorers.default.url}/tx/${hash}`);
} else {
    const owner = await client.readContract({ address: IDENTITY, abi: identityAbi, functionName: "ownerOf", args: [BigInt(agentId)] });
    if (owner.toLowerCase() !== account.address.toLowerCase()) throw new Error(`Agent #${agentId} is owned by ${owner}, not this key.`);
    console.log(`agent #${agentId} already registered to this key`);
}

const artifact = JSON.parse(readFileSync("artifacts/contracts/attest/MonsmithAttestations.sol/MonsmithAttestations.json", "utf8"));
const deployHash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args: [IDENTITY, BigInt(agentId)] });
const deployed = await client.waitForTransactionReceipt({ hash: deployHash });
if (deployed.contractAddress === null || deployed.contractAddress === undefined) throw new Error(`No contract address in ${deployHash}`);
saveEnv("MONSMITH_ATTESTATIONS_ADDRESS", deployed.contractAddress);
console.log(`deployed MonsmithAttestations at ${deployed.contractAddress} in ${monad.blockExplorers.default.url}/tx/${deployHash}`);
console.log(`left: ${formatEther(await client.getBalance({ address: account.address }))} MON`);
