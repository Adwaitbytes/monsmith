// Creates Monsmith's agent wallet in Dynamic, the wallet that will hold its
// ERC-8004 identity and sign its attestations instead of a raw private key.
//
// It is an MPC wallet: TWO_OF_TWO means one key share lives with this server
// and one with Dynamic, and both are needed to sign, so no single machine ever
// holds the whole key. The server share is backed up to Dynamic under a random
// password generated here.
//
// Reads DYNAMIC_ENVIRONMENT_ID and DYNAMIC_AUTH_TOKEN from .env.local and
// writes back DYNAMIC_AGENT_ADDRESS, DYNAMIC_WALLET_METADATA,
// DYNAMIC_SERVER_KEY_SHARES and DYNAMIC_WALLET_PASSWORD. Refuses to run when a
// wallet already exists, so a rerun never orphans the one holding the identity.
// Secrets are never printed.
//
// usage: node scripts/dynamic-agent-wallet.mjs

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import dotenv from "dotenv";
import { DynamicEvmWalletClient } from "@dynamic-labs-wallet/node-evm";
import { ThresholdSignatureScheme } from "@dynamic-labs-wallet/node";

dotenv.config({ path: ".env.local", quiet: true });

const { DYNAMIC_ENVIRONMENT_ID: environmentId, DYNAMIC_AUTH_TOKEN: token } = process.env;
if (!environmentId || !token) {
    console.error("Set DYNAMIC_ENVIRONMENT_ID and DYNAMIC_AUTH_TOKEN in .env.local.");
    process.exit(1);
}
if (process.env.DYNAMIC_AGENT_ADDRESS) {
    console.error(`An agent wallet already exists: ${process.env.DYNAMIC_AGENT_ADDRESS}. Nothing was created.`);
    process.exit(1);
}

const client = new DynamicEvmWalletClient({ environmentId });
await client.authenticateApiToken(token);

const password = randomBytes(32).toString("base64url");
const { walletMetadata, externalServerKeyShares } = await client.createWalletAccount({
    thresholdSignatureScheme: ThresholdSignatureScheme.TWO_OF_TWO,
    password,
    backUpToDynamic: true,
});

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64");
const values = {
    DYNAMIC_AGENT_ADDRESS: walletMetadata.accountAddress,
    DYNAMIC_WALLET_METADATA: encode(walletMetadata),
    DYNAMIC_SERVER_KEY_SHARES: encode(externalServerKeyShares),
    DYNAMIC_WALLET_PASSWORD: password,
};
const lines = readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((line) => line !== "" && !Object.keys(values).some((name) => line.startsWith(`${name}=`)));
for (const [name, value] of Object.entries(values)) lines.push(`${name}=${value}`);
writeFileSync(".env.local", `${lines.join("\n")}\n`);

console.log(`created Dynamic agent wallet ${walletMetadata.accountAddress} (${walletMetadata.thresholdSignatureScheme}, server share backed up to Dynamic)`);
