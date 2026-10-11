import 'server-only';

import { createWalletClient, type Account, type Chain, type Hex, type Transport, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monad } from 'viem/chains';

import { alchemyUrl, transportFor } from './rpc';

/**
 * The wallet that signs Monsmith's attestations.
 *
 * Preferably a Dynamic server wallet: an MPC wallet whose key is split between
 * this server and Dynamic, both needed to sign, so a leaked deployment setting
 * is not a leaked key. It holds Monsmith's ERC-8004 identity, and the
 * attestations contract checks ownerOf on every write, so signing power goes
 * wherever the identity goes. A raw private key stays supported for local
 * setups without Dynamic.
 */

export type AttesterWallet = WalletClient<Transport, Chain, Account>;

export interface DynamicSettings {
    environmentId: string;
    authToken: string;
    walletMetadata: string;
    serverKeyShares: string;
    password: string;
}

export type SignerKind = 'dynamic' | 'private-key' | 'none';

export function dynamicSettings(env: Readonly<Record<string, string | undefined>> = process.env): DynamicSettings | null {
    const settings = {
        environmentId: env.DYNAMIC_ENVIRONMENT_ID,
        authToken: env.DYNAMIC_AUTH_TOKEN,
        walletMetadata: env.DYNAMIC_WALLET_METADATA,
        serverKeyShares: env.DYNAMIC_SERVER_KEY_SHARES,
        password: env.DYNAMIC_WALLET_PASSWORD,
    };
    return Object.values(settings).every((value) => typeof value === 'string' && value.length > 0) ? (settings as DynamicSettings) : null;
}

export function signerKind(env: Readonly<Record<string, string | undefined>> = process.env): SignerKind {
    if (dynamicSettings(env) !== null) return 'dynamic';
    return env.MONSMITH_ATTESTER_KEY !== undefined && /^0x[0-9a-fA-F]{64}$/.test(env.MONSMITH_ATTESTER_KEY) ? 'private-key' : 'none';
}

function decoded<T>(base64: string, what: string): T {
    try {
        return JSON.parse(Buffer.from(base64, 'base64').toString('utf8')) as T;
    } catch {
        throw new Error(`The Dynamic ${what} setting is not valid base64 JSON.`);
    }
}

async function dynamicWallet(settings: DynamicSettings): Promise<AttesterWallet> {
    // Loaded on demand: the SDK is large and only the publishing route needs it.
    const { DynamicEvmWalletClient } = await import('@dynamic-labs-wallet/node-evm');
    const client = new DynamicEvmWalletClient({ environmentId: settings.environmentId });
    await client.authenticateApiToken(settings.authToken);
    return client.getWalletClient({
        walletMetadata: decoded(settings.walletMetadata, 'wallet metadata'),
        externalServerKeyShares: decoded(settings.serverKeyShares, 'server key shares'),
        password: settings.password,
        chain: monad,
        rpcUrl: alchemyUrl(monad.id) ?? process.env.MONAD_MAINNET_RPC ?? 'https://rpc.monad.xyz',
    });
}

export async function attesterWallet(): Promise<AttesterWallet> {
    const settings = dynamicSettings();
    if (settings !== null) return dynamicWallet(settings);
    const key = process.env.MONSMITH_ATTESTER_KEY;
    if (key === undefined || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('No attester is configured: set up the Dynamic agent wallet or MONSMITH_ATTESTER_KEY.');
    return createWalletClient({ account: privateKeyToAccount(key as Hex), chain: monad, transport: transportFor(monad.id, 30_000) });
}
