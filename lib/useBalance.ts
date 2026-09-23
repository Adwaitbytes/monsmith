'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatEther } from 'viem';

import { getEthereumProvider } from './ethereum';

/**
 * The connected wallet's MON balance on the selected network.
 *
 * Deploying costs gas, and a wallet with none fails at the point of signing
 * with whatever message the wallet decides to show. Knowing the balance before
 * pressing deploy is the difference between choosing to top up and being told
 * afterwards that you should have, which is the whole reason this is worth a
 * line of chrome.
 *
 * Read straight from the injected provider rather than an RPC of our own. The
 * wallet is already connected to a node and already knows the answer, and a
 * second source would mean showing a number that disagrees with the one the
 * wallet shows at signing time.
 */

const CHAIN_IDS = {
    testnet: 10143,
    mainnet: 143,
} as const;

export interface WalletBalance {
    /** Formatted MON, to four places. Null while unknown. */
    formatted: string | null;
    /** True when the wallet is on a different chain than the studio is set to. */
    wrongNetwork: boolean;
    loading: boolean;
    refresh: () => void;
}

export function useBalance(
    address: string | null,
    network: 'testnet' | 'mainnet',
): WalletBalance {
    const [formatted, setFormatted] = useState<string | null>(null);
    const [wrongNetwork, setWrongNetwork] = useState(false);
    const [loading, setLoading] = useState(false);
    const [nonce, setNonce] = useState(0);

    const refresh = useCallback(() => setNonce((current) => current + 1), []);

    useEffect(() => {
        if (address === null) {
            setFormatted(null);
            setWrongNetwork(false);
            return;
        }

        const provider = getEthereumProvider();
        if (provider === null) {
            setFormatted(null);
            return;
        }

        let live = true;
        setLoading(true);

        void (async () => {
            try {
                const chainId = (await provider.request({ method: 'eth_chainId' })) as string;
                const onChain = Number.parseInt(chainId, 16);
                const expected = CHAIN_IDS[network];

                if (!live) return;

                // A balance from the wrong chain is worse than no balance: it
                // reads as money that is available to spend where it is not.
                if (Number.isFinite(onChain) && onChain !== expected) {
                    setWrongNetwork(true);
                    setFormatted(null);
                    return;
                }
                setWrongNetwork(false);

                const raw = (await provider.request({
                    method: 'eth_getBalance',
                    params: [address, 'latest'],
                })) as string;

                if (!live) return;
                const value = formatEther(BigInt(raw));
                const asNumber = Number(value);
                setFormatted(
                    Number.isFinite(asNumber)
                        ? asNumber.toLocaleString('en-US', {
                              minimumFractionDigits: 0,
                              maximumFractionDigits: 4,
                          })
                        : value,
                );
            } catch {
                // A wallet that will not answer is not an error worth showing.
                // The balance simply stays unknown.
                if (live) setFormatted(null);
            } finally {
                if (live) setLoading(false);
            }
        })();

        return () => {
            live = false;
        };
    }, [address, network, nonce]);

    // The balance changes when they deploy, and a stale number after a deploy
    // is the one moment someone actually looks at it.
    useEffect(() => {
        const provider = getEthereumProvider();
        if (provider === null || address === null) return;

        const onChange = () => refresh();
        provider.on?.('chainChanged', onChange);
        provider.on?.('accountsChanged', onChange);
        return () => {
            provider.removeListener?.('chainChanged', onChange);
            provider.removeListener?.('accountsChanged', onChange);
        };
    }, [address, refresh]);

    return { formatted, wrongNetwork, loading, refresh };
}
