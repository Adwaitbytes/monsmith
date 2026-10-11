'use client';

import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { PrivyProvider, useIdentityToken, usePrivy, useWallets } from '@privy-io/react-auth';
import { monad, monadTestnet } from 'viem/chains';

import { setEmbeddedProvider, type EthereumProvider } from '@/lib/ethereum';

/**
 * Sign-in on the client, through Privy.
 *
 * Components read `useAuthState()` rather than Privy's hooks directly, so a
 * deployment without Privy configured still renders every page: the default
 * context is a signed-out visitor whose sign-in button does nothing.
 *
 * Signing in with Google, GitHub or email also gives the person a Privy
 * embedded wallet on Monad, registered with the studio's wallet lookup, so
 * they can deploy and sign without installing a browser wallet.
 */

export interface AuthState {
    /** False when sign-in is not configured on this deployment. */
    configured: boolean;
    /** True once Privy has worked out whether someone is signed in. */
    isLoaded: boolean;
    isSignedIn: boolean;
    userId: string | null;
    email: string | null;
    /** The person's Privy embedded wallet on Monad, once it exists. */
    walletAddress: string | null;
    openSignIn: () => void;
    signOut: () => Promise<void>;
}

const SIGNED_OUT: AuthState = {
    configured: false,
    isLoaded: true,
    isSignedIn: false,
    userId: null,
    email: null,
    walletAddress: null,
    openSignIn: () => undefined,
    signOut: async () => undefined,
};

const AuthContext = createContext<AuthState>(SIGNED_OUT);

export function useAuthState(): AuthState {
    return useContext(AuthContext);
}

/** Keeps the server's session cookie in step with Privy's identity token. */
async function syncSession(identityToken: string | null): Promise<void> {
    await fetch('/api/auth/session', {
        method: identityToken === null ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...(identityToken === null ? {} : { body: JSON.stringify({ identityToken }) }),
    });
}

function PrivyBridge({ children }: { children: React.ReactNode }) {
    const { ready, authenticated, user, login, logout } = usePrivy();
    const { identityToken } = useIdentityToken();
    const { wallets } = useWallets();
    const synced = useRef<string | null | undefined>(undefined);

    useEffect(() => {
        if (!ready) return;
        const token = authenticated ? identityToken : null;
        if (synced.current === token) return;
        synced.current = token;
        syncSession(token).catch(() => {
            // The next token refresh retries; the page keeps working signed out meanwhile.
            synced.current = undefined;
        });
    }, [ready, authenticated, identityToken]);

    const embedded = wallets.find((wallet) => wallet.walletClientType === 'privy') ?? null;

    useEffect(() => {
        if (embedded === null || !authenticated) {
            setEmbeddedProvider(null);
            return;
        }
        let cancelled = false;
        embedded
            .getEthereumProvider()
            .then((provider) => {
                if (!cancelled) setEmbeddedProvider(provider as unknown as EthereumProvider);
            })
            .catch(() => {
                if (!cancelled) setEmbeddedProvider(null);
            });
        return () => {
            cancelled = true;
        };
    }, [embedded, authenticated]);

    const state = useMemo<AuthState>(
        () => ({
            configured: true,
            isLoaded: ready,
            isSignedIn: ready && authenticated,
            userId: user?.id ?? null,
            email: user?.email?.address ?? user?.google?.email ?? user?.github?.email ?? null,
            walletAddress: embedded?.address ?? null,
            openSignIn: () => login(),
            signOut: async () => {
                await logout();
                await syncSession(null).catch(() => undefined);
            },
        }),
        [ready, authenticated, user, embedded, login, logout],
    );

    return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function PrivyAuthProvider({ appId, children }: { appId: string; children: React.ReactNode }) {
    return (
        <PrivyProvider
            appId={appId}
            config={{
                loginMethods: ['google', 'github', 'email'],
                appearance: { theme: 'light', accentColor: '#6d28d9', landingHeader: 'Sign in to Monsmith' },
                embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
                defaultChain: monad,
                supportedChains: [monad, monadTestnet],
            }}
        >
            <PrivyBridge>{children}</PrivyBridge>
        </PrivyProvider>
    );
}
