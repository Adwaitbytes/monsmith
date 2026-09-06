/**
 * Roles, tiers and permissions.
 *
 * Two axes, kept apart on purpose, because conflating them is what makes a
 * permission system painful to change later:
 *
 *   role  is who you are to the product. Today: admin or member. It decides
 *         whether you can see other people's data and change their tier.
 *   tier  is what you have paid for. It decides how much of the product you
 *         get. Pricing is not settled, so the tiers exist and the limits are
 *         declared in one table rather than scattered through call sites.
 *
 * Nothing in here reads Clerk directly. Resolution lives in `server.ts` so this
 * file stays importable from client components that only need the shape of a
 * permission, and so the rules can be unit-tested without a request.
 */

export type Role = "admin" | "member";
export type Tier = "free" | "pro" | "enterprise";

/**
 * Capabilities the app checks for. Deliberately verbs about the product rather
 * than names of pages, so moving a feature does not invalidate a permission.
 */
export type Permission =
    /** Run the compile-and-trace analyses at all. */
    | "analysis.run"
    /** Run them without the daily cap. */
    | "analysis.unlimited"
    /** Produce a link that reproduces an analysis. */
    | "share.create"
    /** Read aggregate product analytics. */
    | "admin.stats"
    /** List accounts and see their tier. */
    | "admin.users"
    /** Change someone else's tier. */
    | "admin.billing";

export interface TierLimits {
    /** Analyses per rolling day. Null means no cap. */
    analysesPerDay: number | null;
    /** Largest contract accepted, in bytes of source. */
    maxSourceBytes: number;
    /** Chains a single Chain Fit report may compare. */
    maxChains: number;
}

/**
 * The entitlement table. One place to change when pricing is decided, and the
 * reason no call site hard-codes a number.
 *
 * The free limits are set where an anonymous visitor evaluating the tool never
 * hits them and an automated scraper does.
 */
export const TIER_LIMITS: Readonly<Record<Tier, TierLimits>> = {
    free: { analysesPerDay: 50, maxSourceBytes: 250_000, maxChains: 6 },
    pro: { analysesPerDay: 1_000, maxSourceBytes: 1_000_000, maxChains: 12 },
    enterprise: { analysesPerDay: null, maxSourceBytes: 5_000_000, maxChains: 32 },
};

export const TIER_LABELS: Readonly<Record<Tier, string>> = {
    free: "Free",
    pro: "Pro",
    enterprise: "Enterprise",
};

const TIER_PERMISSIONS: Readonly<Record<Tier, readonly Permission[]>> = {
    free: ["analysis.run", "share.create"],
    pro: ["analysis.run", "analysis.unlimited", "share.create"],
    enterprise: ["analysis.run", "analysis.unlimited", "share.create"],
};

const ADMIN_PERMISSIONS: readonly Permission[] = [
    "admin.stats",
    "admin.users",
    "admin.billing",
];

/** Everything a viewer of the product can do, whether or not they signed in. */
export interface Viewer {
    signedIn: boolean;
    userId: string | null;
    email: string | null;
    role: Role;
    tier: Tier;
    permissions: readonly Permission[];
    limits: TierLimits;
}

/**
 * The permission set for a role and tier.
 *
 * Admin adds capabilities rather than replacing them, so an admin is also a
 * user of the product and hits the same code paths everyone else does.
 */
export function permissionsFor(role: Role, tier: Tier): Permission[] {
    const base = [...TIER_PERMISSIONS[tier]];
    if (role === "admin") base.push(...ADMIN_PERMISSIONS);
    return base;
}

export function buildViewer(input: {
    signedIn: boolean;
    userId: string | null;
    email: string | null;
    role: Role;
    tier: Tier;
}): Viewer {
    return {
        ...input,
        permissions: permissionsFor(input.role, input.tier),
        limits: TIER_LIMITS[input.tier],
    };
}

/**
 * A signed-out visitor.
 *
 * Anonymous use is a deliberate product decision, not an oversight: the compare
 * page, the embed and shared links all have to work for someone who has never
 * heard of us, so the signed-out viewer is a real free-tier user rather than a
 * locked door.
 */
export const ANONYMOUS: Viewer = buildViewer({
    signedIn: false,
    userId: null,
    email: null,
    role: "member",
    tier: "free",
});

export function can(viewer: Viewer, permission: Permission): boolean {
    return viewer.permissions.includes(permission);
}

/** Narrows an untrusted string from Clerk metadata to a known role. */
export function parseRole(value: unknown): Role {
    return value === "admin" ? "admin" : "member";
}

/** Narrows an untrusted string from Clerk metadata to a known tier. */
export function parseTier(value: unknown): Tier {
    return value === "pro" || value === "enterprise" ? value : "free";
}
