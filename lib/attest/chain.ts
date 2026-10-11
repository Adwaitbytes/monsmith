import 'server-only';

import { BaseError, ContractFunctionRevertedError, createPublicClient, parseAbi, type Address, type Hex } from 'viem';
import { monad } from 'viem/chains';

import { transportFor } from './rpc';
import { attesterWallet } from './signer';

/**
 * Reading and writing Monsmith's audit attestations on Monad mainnet.
 *
 * Configuration comes from three settings: the attestations contract, the
 * agent id it was deployed under, and the key of the wallet that owns that
 * ERC-8004 identity. Reading needs only the first two; without them the
 * feature reports itself as not set up rather than failing.
 */

/** The ERC-8004 Identity Registry on Monad mainnet, at its shared CREATE2 address. */
export const IDENTITY_REGISTRY: Address = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
export const AGENT_REGISTRY_ID = `eip155:${monad.id}:${IDENTITY_REGISTRY}`;
export const EXPLORER = monad.blockExplorers.default.url;

export const ATTESTATIONS_ABI = parseAbi([
    'struct Attestation { uint8 score; uint16 critical; uint16 high; uint16 medium; uint16 low; uint64 timestamp; bytes32 reportHash; string reportURI; }',
    'function attest(bytes32 sourceHash, uint256 chainId, address target, uint8 score, uint16 critical, uint16 high, uint16 medium, uint16 low, bytes32 reportHash, string reportURI)',
    'function isAttested(bytes32 sourceHash) view returns (bool)',
    'function ofSource(bytes32 sourceHash) view returns (Attestation)',
    'function ofDeployment(uint256 chainId, address target) view returns (bytes32, Attestation)',
    'function attestationCount() view returns (uint256)',
    'function agentId() view returns (uint256)',
    'event Attested(bytes32 indexed sourceHash, uint256 indexed chainId, address indexed target, uint8 score, uint16 critical, uint16 high, bytes32 reportHash, string reportURI)',
    'error NotAttested()',
    'error NotAgentOwner(address caller, address owner)',
    'error ScoreOutOfRange(uint8 score)',
    'error EmptySource()',
]);

export interface AttestConfig {
    address: Address;
    agentId: bigint;
}

function isAddress(value: string | undefined): value is Address {
    return value !== undefined && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function attestConfig(): AttestConfig | null {
    const address = process.env.MONSMITH_ATTESTATIONS_ADDRESS;
    const agent = process.env.MONSMITH_AGENT_ID;
    if (!isAddress(address) || agent === undefined || !/^\d+$/.test(agent)) return null;
    return { address, agentId: BigInt(agent) };
}

export function readClient() {
    return createPublicClient({ chain: monad, transport: transportFor(monad.id) });
}

export interface OnchainAttestation {
    sourceHash: Hex;
    score: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    timestamp: number;
    reportHash: Hex;
    reportURI: string;
}

function shape(sourceHash: Hex, raw: { score: number; critical: number; high: number; medium: number; low: number; timestamp: bigint; reportHash: Hex; reportURI: string }): OnchainAttestation {
    return {
        sourceHash,
        score: raw.score,
        critical: raw.critical,
        high: raw.high,
        medium: raw.medium,
        low: raw.low,
        timestamp: Number(raw.timestamp),
        reportHash: raw.reportHash,
        reportURI: raw.reportURI,
    };
}

/** The attestation for a source hash, or null when there is none. */
export async function attestationOfSource(config: AttestConfig, hash: Hex): Promise<OnchainAttestation | null> {
    const client = readClient();
    const exists = await client.readContract({ address: config.address, abi: ATTESTATIONS_ABI, functionName: 'isAttested', args: [hash] });
    if (!exists) return null;
    const raw = await client.readContract({ address: config.address, abi: ATTESTATIONS_ABI, functionName: 'ofSource', args: [hash] });
    return shape(hash, raw);
}

/** The attestation for a deployed contract, or null when there is none. */
export async function attestationOfDeployment(config: AttestConfig, chainId: number, target: Address): Promise<OnchainAttestation | null> {
    try {
        const [hash, raw] = await readClient().readContract({
            address: config.address,
            abi: ATTESTATIONS_ABI,
            functionName: 'ofDeployment',
            args: [BigInt(chainId), target],
        });
        return shape(hash, raw);
    } catch (error) {
        // The contract reverts NotAttested for an unknown deployment; anything
        // else is a real failure the caller should hear about.
        if (error instanceof BaseError) {
            const revert = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
            if (revert instanceof ContractFunctionRevertedError && revert.data?.errorName === 'NotAttested') return null;
        }
        throw error;
    }
}

export interface AttestInput {
    sourceHash: Hex;
    chainId: number;
    target: Address;
    score: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    reportHash: Hex;
    reportURI: string;
}

/**
 * Writes one attestation and waits for it to land. Monad charges for the gas
 * limit rather than the gas used, so the limit is the estimate plus a margin,
 * not a round number.
 */
export async function writeAttestation(config: AttestConfig, input: AttestInput): Promise<Hex> {
    const wallet = await attesterWallet();
    const account = wallet.account;
    const client = readClient();
    const clamp = (value: number) => Math.min(65_535, Math.max(0, Math.round(value)));
    const args = [
        input.sourceHash,
        BigInt(input.chainId),
        input.target,
        Math.min(100, Math.max(0, Math.round(input.score))),
        clamp(input.critical),
        clamp(input.high),
        clamp(input.medium),
        clamp(input.low),
        input.reportHash,
        input.reportURI,
    ] as const;
    const estimate = await client.estimateContractGas({ address: config.address, abi: ATTESTATIONS_ABI, functionName: 'attest', args, account });
    const hash = await wallet.writeContract({ address: config.address, abi: ATTESTATIONS_ABI, functionName: 'attest', args, gas: (estimate * 12n) / 10n });
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== 'success') throw new Error(`The attestation transaction reverted: ${hash}`);
    return hash;
}
