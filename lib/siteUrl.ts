/**
 * The public origin this deployment is reachable at.
 *
 * Needed by anything that has to emit an absolute URL: the embed snippet a
 * third party pastes into their page, and the OG image tags a crawler reads.
 * Hard-coding a domain would silently produce broken embeds on every preview
 * deployment, so the value is read from the platform and only falls back to a
 * literal when nothing else is available.
 */

const FALLBACK_ORIGIN = "https://www.monsmith.com";

export function siteUrl(): string {
    const explicit = process.env.NEXT_PUBLIC_SITE_URL;
    if (explicit !== undefined && explicit.length > 0) {
        return explicit.replace(/\/$/, "");
    }

    // Set by Vercel to the project's stable production domain.
    const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    if (production !== undefined && production.length > 0) {
        return `https://${production}`;
    }

    // Present on preview deployments, where it is the only correct answer.
    const deployment = process.env.VERCEL_URL;
    if (deployment !== undefined && deployment.length > 0) {
        return `https://${deployment}`;
    }

    return FALLBACK_ORIGIN;
}

/** Absolute URL for a path on this deployment. */
export function absoluteUrl(path: string): string {
    return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
