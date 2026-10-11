import 'server-only';

import { createPublicClient, fallback, getAddress, http, type Address, type Transport } from 'viem';

/**
 * Where Monsmith reads and writes chain state.
 *
 * Alchemy first, when a key is configured: it serves every chain Monsmith
 * audits from (Monad mainnet and testnet, Ethereum, Sepolia) behind one key,
 * and an agent that signs onchain needs an endpoint that answers under load.
 * The public endpoints stand behind it, so a missing key or an Alchemy outage
 * degrades to slower reads rather than a broken feature.
 */

const ALCHEMY_NETWORKS: Readonly<Record<number, string>> = {
    143: 'monad-mainnet',
    10143: 'monad-testnet',
    1: 'eth-mainnet',
    11155111: 'eth-sepolia',
};

const PUBLIC_RPC: Readonly<Record<number, string>> = {
    143: 'https://rpc.monad.xyz',
    10143: 'https://testnet-rpc.monad.xyz',
    1: 'https://ethereum-rpc.publicnode.com',
    11155111: 'https://ethereum-sepolia-rpc.publicnode.com',
};

export function supportsChain(chainId: number): boolean {
    return PUBLIC_RPC[chainId] !== undefined;
}

/** The Alchemy URL for a chain, or null without a key or for a chain Alchemy does not serve. */
export function alchemyUrl(chainId: number, key = process.env.ALCHEMY_API_KEY): string | null {
    const network = ALCHEMY_NETWORKS[chainId];
    if (network === undefined || key === undefined || !/^[\w-]{16,}$/.test(key)) return null;
    return `https://${network}.g.alchemy.com/v2/${key}`;
}

/** Alchemy, then the public endpoint. MONAD_MAINNET_RPC still overrides Monad mainnet's public fallback. */
export function transportFor(chainId: number, timeout = 15_000): Transport {
    const publicUrl = chainId === 143 ? (process.env.MONAD_MAINNET_RPC ?? PUBLIC_RPC[143]) : PUBLIC_RPC[chainId];
    if (publicUrl === undefined) throw new Error(`No RPC for chain ${chainId}.`);
    const alchemy = alchemyUrl(chainId);
    return alchemy === null ? http(publicUrl, { timeout }) : fallback([http(alchemy, { timeout }), http(publicUrl, { timeout })]);
}

/** The EIP-1967 implementation slot: bytes32(uint256(keccak256('eip1967.proxy.implementation')) - 1). */
const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

export interface DeployedCode {
    hasCode: boolean;
    /** Set when the address is an EIP-1967 proxy: the contract whose code actually runs. */
    implementation: Address | null;
}

/** Decodes an implementation slot value. Exported for tests. */
export function implementationFromSlot(slot: string | undefined): Address | null {
    if (slot === undefined || !/^0x[0-9a-fA-F]{64}$/.test(slot)) return null;
    const address = `0x${slot.slice(-40)}`;
    return /^0x0{40}$/.test(address) ? null : getAddress(address);
}

/**
 * What is actually deployed at an address.
 *
 * An attestation tied to an address says "the code here scored this", so the
 * code has to be there, and it has to be code that cannot be swapped. A proxy
 * is the case that breaks the second: its owner can point it at different code
 * the next block, and the score would still sit on the address.
 */
export async function deployedCode(chainId: number, address: Address): Promise<DeployedCode> {
    const client = createPublicClient({ transport: transportFor(chainId) });
    const [code, slot] = await Promise.all([
        client.getCode({ address }),
        client.getStorageAt({ address, slot: IMPLEMENTATION_SLOT }),
    ]);
    return { hasCode: code !== undefined && code !== '0x', implementation: implementationFromSlot(slot) };
}
