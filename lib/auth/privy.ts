import "server-only";

import { PrivyClient, type User } from "@privy-io/node";

/**
 * Privy on the server: verifying identity tokens and, for admins, reading and
 * changing user metadata. One client per process, since it caches Privy's
 * signing keys after the first verification.
 */

let client: PrivyClient | null = null;

export function privyAppId(): string | null {
    const id = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    return id !== undefined && id.length > 0 ? id : null;
}

export function privyConfigured(): boolean {
    return privyAppId() !== null && (process.env.PRIVY_APP_SECRET ?? "").length > 0;
}

export function privy(): PrivyClient {
    const appID = privyAppId();
    const appSecret = process.env.PRIVY_APP_SECRET;
    if (appID === null || appSecret === undefined || appSecret.length === 0) throw new Error("Privy is not configured.");
    client ??= new PrivyClient({ appId: appID, appSecret });
    return client;
}

/** The user an identity token speaks for, or null when it does not verify. */
export async function userFromIdentityToken(token: string): Promise<User | null> {
    try {
        return await privy().users().get({ id_token: token });
    } catch {
        return null;
    }
}

/** The address a person signs in with: their email, or the email of the Google or GitHub account they used. */
export function emailOf(user: User): string | null {
    for (const account of user.linked_accounts) {
        const candidate =
            account.type === "email" ? account.address : "email" in account && typeof account.email === "string" ? account.email : null;
        if (candidate !== null && candidate.length > 0) return candidate.toLowerCase();
    }
    return null;
}

/** The address of the user's Privy embedded wallet, when they have one. */
export function embeddedWalletOf(user: User): string | null {
    for (const account of user.linked_accounts) {
        if (account.type === "wallet" && "wallet_client_type" in account && account.wallet_client_type === "privy" && "address" in account) {
            return String(account.address);
        }
    }
    return null;
}
