import React from "react";

import { PrivyAuthProvider } from "@/lib/auth/client";
import { privyAppId } from "@/lib/auth/privy";

/**
 * Wraps the app in Privy, but only when Privy is configured.
 *
 * A checkout without keys, a fork, or a preview built before the environment
 * was set should still render the whole product. Auth is additive here, so an
 * unconfigured deployment degrades to the anonymous viewer rather than to an
 * error page.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
    const appId = privyAppId();
    if (appId === null) return <>{children}</>;
    return <PrivyAuthProvider appId={appId}>{children}</PrivyAuthProvider>;
}
