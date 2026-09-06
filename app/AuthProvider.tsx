import React from "react";
import { ClerkProvider } from "@clerk/nextjs";

import { authConfigured } from "@/lib/auth/server";

/**
 * Wraps the app in Clerk, but only when Clerk is configured.
 *
 * A checkout without keys, a fork, or a preview built before the environment
 * was set should still render the whole product. Auth is additive here, so an
 * unconfigured deployment degrades to the anonymous viewer rather than to an
 * error page.
 *
 * `ClerkProvider` sits inside `<body>` in the root layout, which is where the
 * current SDK requires it.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
    if (!authConfigured()) return <>{children}</>;
    return <ClerkProvider dynamic>{children}</ClerkProvider>;
}
