// utils/q402.ts
import {
    getEthereumProvider,
    isProviderRpcError,
    type EthereumProvider,
} from "../lib/ethereum";

/** The 402 challenge body returned by the API when a paid action is called without payment. */
export interface PaymentDetails {
    scheme: string;
    networkId: string;
    amount: string;
    witness: {
        domain: {
            name: string;
            version: string;
            chainId: number;
            verifyingContract: string;
        };
        types: Record<string, { name: string; type: string }[]>;
        primaryType: string;
        message: Record<string, string | number>;
    };
}

const MONAD_TESTNET_CHAIN_ID = 10143;

/** MetaMask's "chain not added to wallet" error code. */
const CHAIN_NOT_ADDED = 4902;

async function ensureCorrectChain(
    ethereum: EthereumProvider,
    chainId: number
): Promise<void> {
    const targetChainIdHex = `0x${chainId.toString(16)}`;
    const currentChainId = await ethereum.request<string>({ method: "eth_chainId" });

    if (currentChainId === targetChainIdHex) return;

    console.log(`⚠️ Wrong Chain (${currentChainId}). Switching to ${targetChainIdHex}...`);

    try {
        await ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: targetChainIdHex }],
        });
        return;
    } catch (switchError) {
        if (!isProviderRpcError(switchError) || switchError.code !== CHAIN_NOT_ADDED) {
            throw switchError;
        }
    }

    // Chain is unknown to the wallet - offer to add it.
    const isTestnet = chainId === MONAD_TESTNET_CHAIN_ID;
    try {
        await ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
                chainId: targetChainIdHex,
                chainName: isTestnet ? "Monad Testnet" : "Monad Mainnet",
                nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
                rpcUrls: [isTestnet ? "https://testnet-rpc.monad.xyz" : "https://mainnet-rpc.monad.xyz"],
                blockExplorerUrls: [isTestnet ? "https://testnet.monadexplorer.com" : "https://monadexplorer.com"],
            }],
        });
    } catch (addError) {
        console.error("Failed to add Monad network:", addError);
        throw new Error(
            "Could not add the Monad network to your wallet. Please add it manually and retry."
        );
    }
}

/**
 * Signs the q402 EIP-712 witness with the connected wallet and returns the
 * base64 `x-payment` header value.
 */
export async function createPaymentHeader(
    signerAddress: string,
    paymentDetails: PaymentDetails
): Promise<string> {
    const ethereum = getEthereumProvider();
    if (!ethereum) {
        throw new Error("No wallet detected. Install MetaMask to pay for this action.");
    }

    const { witness } = paymentDetails;

    await ensureCorrectChain(ethereum, witness.domain.chainId);

    const signature = await ethereum.request<string>({
        method: "eth_signTypedData_v4",
        params: [signerAddress, JSON.stringify({
            domain: witness.domain,
            types: {
                EIP712Domain: [
                    { name: "name", type: "string" },
                    { name: "version", type: "string" },
                    { name: "chainId", type: "uint256" },
                    { name: "verifyingContract", type: "address" },
                ],
                ...witness.types,
            },
            primaryType: witness.primaryType,
            message: witness.message,
        })],
    });

    const payload = { witnessSignature: signature, paymentDetails };
    return btoa(JSON.stringify(payload));
}
