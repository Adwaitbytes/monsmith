import "server-only";

import { cookies } from "next/headers";

import { emailOf, privyConfigured, userFromIdentityToken } from "./privy";
import {
    ANONYMOUS,
    buildViewer,
    parseRole,
    parseTier,
    type Role,
    type Tier,
    type Viewer,
} from "./roles";
import { SESSION_COOKIE } from "./session";

/**
 * Resolving who is asking, on the server.
 *
 * The session cookie holds Privy's identity token, verified here against
 * Privy's keys, so who someone is and their role and tier come from a token
 * Privy signed, not from anything the browser can edit.
 *
 * Two sources for the role, and the order matters. Custom metadata on the
 * Privy user is convenient, and it is exactly what an attacker would go after
 * if they ever found a write path to it. So an allowlist of admin emails in
 * the server environment wins: it cannot be granted by editing a profile, it
 * needs no dashboard step to bootstrap the first admin, and it is the only way
 * to become an admin without a deploy. Metadata is still honoured for tiers,
 * because that is what billing writes to.
 */

function adminEmails(): Set<string> {
    const raw = process.env.ADMIN_EMAILS ?? "";
    return new Set(
        raw
            .split(",")
            .map((entry) => entry.trim().toLowerCase())
            .filter((entry) => entry.length > 0),
    );
}

/** True when sign-in is configured at all. The app runs fine without it. */
export function authConfigured(): boolean {
    return privyConfigured();
}

/**
 * The current viewer.
 *
 * Never throws and never redirects. A signed-out visitor, an unconfigured
 * deployment, an expired token and a Privy outage all resolve to the
 * anonymous free-tier viewer, because every public surface has to keep
 * working in all of those cases.
 */
export async function getViewer(): Promise<Viewer> {
    if (!authConfigured()) return ANONYMOUS;

    try {
        const token = (await cookies()).get(SESSION_COOKIE)?.value;
        if (token === undefined || token.length === 0) return ANONYMOUS;

        const user = await userFromIdentityToken(token);
        if (user === null) return ANONYMOUS;

        const email = emailOf(user);
        const metadata = (user.custom_metadata ?? {}) as { role?: unknown; tier?: unknown };

        const isAllowlisted = email !== null && adminEmails().has(email);
        const role: Role = isAllowlisted ? "admin" : parseRole(metadata.role);
        // An admin is not billed, so showing them a free-tier cap would be noise.
        const tier: Tier = role === "admin" ? "enterprise" : parseTier(metadata.tier);

        return buildViewer({ signedIn: true, userId: user.id, email, role, tier });
    } catch {
        // A failure to identify someone must not take down a public page.
        return ANONYMOUS;
    }
}

/**
 * Viewer for a route handler. The identity token already carries everything
 * a route needs, so this is the same resolution; it is kept as its own name so
 * call sites read the way they did.
 */
export async function getApiViewer(): Promise<Viewer> {
    return getViewer();
}
