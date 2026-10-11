// Deploys MonsmithVerdicts on Monad mainnet: the receiver a Chainlink CRE
// workflow writes its second opinion on each Monsmith attestation to.
//
// The forwarder is the address allowed to deliver verdicts. CRE's simulator
// delivers through a mock forwarder; a deployed workflow through the Keystone
// forwarder. Both are listed by `cre workflow supported-chains`; the owner can
// switch with setForwarderAddress.
//
// Reads MONSMITH_ATTESTER_KEY and MONSMITH_ATTESTATIONS_ADDRESS from
// .env.local and writes MONSMITH_VERDICTS_ADDRESS back. The key is never printed.
//
// usage: npx hardhat compile && node scripts/deploy-verdicts.mjs [simulation|production]

import { readFileSync, writeFileSync } from "node:fs";
import dotenv from "dotenv";
import { createPublicClient, createWalletClient, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";

dotenv.config({ path: ".env.local", quiet: true });

const FORWARDERS = {
    simulation: "0x9eF6468C5f37b976E57d52054c693269479A784d",
    production: "0x76c9cf548b4179F8901cda1f8623568b58215E62",
};
const mode = process.argv[2] ?? "simulation";
const forwarder = FORWARDERS[mode];
if (forwarder === undefined) {
    console.error(`Unknown forwarder "${mode}". Use simulation or production.`);
    process.exit(1);
}

const key = process.env.MONSMITH_ATTESTER_KEY;
const attestations = process.env.MONSMITH_ATTESTATIONS_ADDRESS;
if (key === undefined || !/^0x[0-9a-fA-F]{64}$/.test(key) || attestations === undefined) {
    console.error("Set MONSMITH_ATTESTER_KEY and MONSMITH_ATTESTATIONS_ADDRESS in .env.local.");
    process.exit(1);
}

const account = privateKeyToAccount(key);
const transport = http(process.env.MONAD_MAINNET_RPC ?? "https://rpc.monad.xyz");
const client = createPublicClient({ chain: monad, transport });
const wallet = createWalletClient({ account, chain: monad, transport });

console.log(`deployer ${account.address} holds ${formatEther(await client.getBalance({ address: account.address }))} MON`);

const artifact = JSON.parse(readFileSync("artifacts/contracts/cre/MonsmithVerdicts.sol/MonsmithVerdicts.json", "utf8"));
const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args: [forwarder, attestations] });
const receipt = await client.waitForTransactionReceipt({ hash });
if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`Deployment failed in ${hash}`);

const lines = readFileSync(".env.local", "utf8").split("\n").filter((line) => !line.startsWith("MONSMITH_VERDICTS_ADDRESS=") && line !== "");
lines.push(`MONSMITH_VERDICTS_ADDRESS=${receipt.contractAddress}`);
writeFileSync(".env.local", `${lines.join("\n")}\n`);

console.log(`deployed MonsmithVerdicts at ${receipt.contractAddress} (forwarder: ${mode} ${forwarder})`);
console.log(`${monad.blockExplorers.default.url}/tx/${hash}`);
console.log(`left: ${formatEther(await client.getBalance({ address: account.address }))} MON`);
