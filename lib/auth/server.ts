import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";

import {
    ANONYMOUS,
    buildViewer,
    parseRole,
    parseTier,
    type Role,
    type Tier,
    type Viewer,
} from "./roles";

/**
 * Resolving who is asking, on the server.
 *
 * Two sources, and the order matters. A role stored in Clerk's public metadata
 * is convenient but public metadata is readable and, more to the point, is the
 * thing an attacker would go after if they ever found a write path to it. So an
 * allowlist of admin emails in the server environment wins: it cannot be
 * granted by editing a profile, it needs no dashboard step to bootstrap the
 * first admin, and it is the only way to become an admin without a deploy.
 *
 * Metadata is still honoured for tiers, and for admins beyond the allowlist,
 * because that is what a billing webhook will write to.
 */

function adminEmails(): Set<string> {
    const raw = process.env.CLERK_ADMIN_EMAILS ?? "";
    return new Set(
        raw
            .split(",")
            .map((entry) => entry.trim().toLowerCase())
            .filter((entry) => entry.length > 0),
    );
}

/** True when Clerk is configured at all. The app runs fine without it. */
export function authConfigured(): boolean {
    return (
        typeof process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY === "string" &&
        process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.length > 0
    );
}

/**
 * The current viewer.
 *
 * Never throws and never redirects. A signed-out visitor, an unconfigured
 * deployment and a Clerk outage all resolve to the anonymous free-tier viewer,
 * because every public surface has to keep working in all three cases.
 */
export async function getViewer(): Promise<Viewer> {
    if (!authConfigured()) return ANONYMOUS;

    try {
        const { userId } = await auth();
        if (userId === null) return ANONYMOUS;

        const user = await currentUser();
        if (user === null) return ANONYMOUS;

        const email = user.primaryEmailAddress?.emailAddress?.toLowerCase() ?? null;
        const metadata = user.publicMetadata as { role?: unknown; tier?: unknown };

        const isAllowlisted = email !== null && adminEmails().has(email);
        const role: Role = isAllowlisted ? "admin" : parseRole(metadata.role);
        // An admin is not billed, so showing them a free-tier cap would be noise.
        const tier: Tier = role === "admin" ? "enterprise" : parseTier(metadata.tier);

        return buildViewer({ signedIn: true, userId, email, role, tier });
    } catch {
        // A failure to identify someone must not take down a public page.
        return ANONYMOUS;
    }
}

/**
 * Viewer for a route handler, which cannot call `currentUser()` as cheaply.
 * Falls back to the session claims so an API route does not pay for a user
 * fetch on every request.
 */
export async function getApiViewer(): Promise<Viewer> {
    if (!authConfigured()) return ANONYMOUS;

    try {
        const { userId, sessionClaims } = await auth();
        if (userId === null) return ANONYMOUS;

        const claims = sessionClaims as
            | { email?: unknown; publicMetadata?: { role?: unknown; tier?: unknown } }
            | null;

        const email = typeof claims?.email === "string" ? claims.email.toLowerCase() : null;
        const metadata = claims?.publicMetadata ?? {};

        const isAllowlisted = email !== null && adminEmails().has(email);
        const role: Role = isAllowlisted ? "admin" : parseRole(metadata.role);
        const tier: Tier = role === "admin" ? "enterprise" : parseTier(metadata.tier);

        return buildViewer({ signedIn: true, userId, email, role, tier });
    } catch {
        return ANONYMOUS;
    }
}
