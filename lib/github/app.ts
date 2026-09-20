import 'server-only';

import { createHmac, createPrivateKey, timingSafeEqual } from 'node:crypto';

import { importPKCS8, SignJWT } from 'jose';

import { githubFetch, isRecord } from './client';
import { GitHubError } from './source';

/**
 * The GitHub App half of repository access.
 *
 * A GitHub App rather than an OAuth App, because an OAuth App asks for every
 * repository a person can see and this product only needs the ones they choose
 * to point it at. The install is per-repository and read-only, which is both the
 * honest ask and the one a security-conscious team will say yes to.
 *
 * Authentication is two-step by design. The app proves it is itself with a short
 * RS256 JWT signed by its private key, then exchanges that for an installation
 * token scoped to one account's selected repositories. Installation tokens last
 * an hour, so they are cached in memory and re-minted just before expiry: the
 * alternative is an extra round trip on every single blob read.
 *
 * Nothing here is required. With none of the three environment variables set,
 * every function returns null or false and the unauthenticated public path keeps
 * working, matching how `authConfigured()` already degrades.
 */

interface AppConfig {
    appId: string;
    slug: string;
    privateKey: string;
}

function env(name: string): string | null {
    const value = process.env[name];
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function appConfig(): AppConfig | null {
    const appId = env('GITHUB_APP_ID');
    const slug = env('GITHUB_APP_SLUG');
    const privateKey = env('GITHUB_APP_PRIVATE_KEY');
    if (appId === null || slug === null || privateKey === null) return null;
    return { appId, slug, privateKey };
}

export function githubAppConfigured(): boolean {
    return appConfig() !== null;
}

/** Where to send someone to install the app. Null when the app is unconfigured,
 * so a caller cannot offer a connect button that leads nowhere. */
export function installUrl(state: string): string | null {
    const config = appConfig();
    if (config === null) return null;
    return `https://github.com/apps/${config.slug}/installations/new?state=${encodeURIComponent(state)}`;
}

// ============= APP AUTHENTICATION =============

type SigningKey = Awaited<ReturnType<typeof importPKCS8>>;

let signingKey: SigningKey | null = null;

/**
 * Imports the app's private key, once per process.
 *
 * Two shapes have to survive this. Dashboards that store secrets on one line
 * hand back a PEM with literal backslash-n instead of newlines, and the key
 * GitHub gives you on registration is PKCS#1 ("BEGIN RSA PRIVATE KEY") which
 * WebCrypto cannot import at all. Re-exporting through node:crypto normalises
 * both, so the key works whether it was pasted raw or converted by hand.
 */
async function loadSigningKey(pem: string): Promise<SigningKey> {
    if (signingKey !== null) return signingKey;

    const unescaped = pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;

    let pkcs8: string;
    try {
        pkcs8 = createPrivateKey(unescaped.trim()).export({ type: 'pkcs8', format: 'pem' }).toString();
    } catch {
        throw new GitHubError(
            'GITHUB_APP_PRIVATE_KEY is not a readable PEM private key.',
            'needs-auth',
        );
    }

    signingKey = await importPKCS8(pkcs8, 'RS256');
    return signingKey;
}

/** A short-lived token proving this deployment is the app. Null when unconfigured. */
export async function appJwt(): Promise<string | null> {
    const config = appConfig();
    if (config === null) return null;

    const key = await loadSigningKey(config.privateKey);
    const now = Math.floor(Date.now() / 1000);

    return new SignJWT({})
        .setProtectedHeader({ alg: 'RS256' })
        // GitHub rejects a token issued in its own future, and a server clock a
        // few seconds fast is common enough that back-dating is cheaper than
        // debugging the 401 it produces.
        .setIssuedAt(now - 60)
        .setExpirationTime(now + 9 * 60)
        .setIssuer(config.appId)
        .sign(key);
}

// ============= INSTALLATION TOKENS =============

interface CachedToken {
    token: string;
    /** Epoch millis after which the cached token must not be reused. */
    expiresAt: number;
}

const tokenCache = new Map<number, CachedToken>();

/** Retire a cached token a minute early, so a token never expires mid-import. */
const EXPIRY_MARGIN_MS = 60_000;

/** Used when GitHub's `expires_at` is unreadable. Their tokens last an hour. */
const FALLBACK_LIFETIME_MS = 30 * 60_000;

/**
 * A token scoped to one installation's repositories.
 *
 * Returns null only when the app is unconfigured. Anything else throws a
 * `GitHubError` so the caller can map it onto a status code the same way a
 * repository read would be mapped.
 */
export async function installationToken(installationId: number): Promise<string | null> {
    const cached = tokenCache.get(installationId);
    if (cached !== undefined && cached.expiresAt > Date.now()) return cached.token;

    const jwt = await appJwt();
    if (jwt === null) return null;

    const data = await githubFetch(`/app/installations/${installationId}/access_tokens`, {
        token: jwt,
        method: 'POST',
    });

    if (!isRecord(data) || typeof data.token !== 'string' || data.token.length === 0) {
        throw new GitHubError('GitHub issued no installation token.', 'unavailable');
    }

    const expiresAt =
        typeof data.expires_at === 'string' ? Date.parse(data.expires_at) : Number.NaN;

    tokenCache.set(installationId, {
        token: data.token,
        expiresAt: Number.isFinite(expiresAt)
            ? expiresAt - EXPIRY_MARGIN_MS
            : Date.now() + FALLBACK_LIFETIME_MS,
    });

    return data.token;
}

/** Drops a cached token, for when an installation is revoked or uninstalled. */
export function forgetInstallationToken(installationId: number): void {
    tokenCache.delete(installationId);
}

/** The account an installation belongs to, for labelling the repo picker. */
export async function installationAccount(installationId: number): Promise<string | null> {
    const jwt = await appJwt();
    if (jwt === null) return null;

    const data = await githubFetch(`/app/installations/${installationId}`, { token: jwt });
    if (!isRecord(data) || !isRecord(data.account)) return null;

    return typeof data.account.login === 'string' ? data.account.login : null;
}

// ============= INSTALL FLOW CSRF =============

/**
 * The install redirect leaves our origin and comes back with an installation id
 * attached, which is exactly the shape an attacker would use to bind their own
 * installation to someone else's account. So the state carries the user id it
 * was issued for, an expiry, and an HMAC over both, and the callback refuses
 * anything that does not match the signed-in viewer.
 */

const STATE_TTL_MS = 15 * 60_000;

/** Any server-only secret will do; these two are the ones this app already has. */
function stateSecret(): string | null {
    return env('CLERK_SECRET_KEY') ?? env('DATABASE_URL');
}

export function issueInstallState(userId: string): string {
    const payload = Buffer.from(`${userId}:${Date.now() + STATE_TTL_MS}`, 'utf8').toString('base64url');
    const secret = stateSecret();
    if (secret === null) return payload;
    return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

export function verifyInstallState(state: string | null, userId: string): boolean {
    if (state === null || state.length === 0) return false;

    const [payload, mac] = state.split('.');
    if (payload === undefined || payload.length === 0) return false;

    const decoded = Buffer.from(payload, 'base64url').toString('utf8');
    const separator = decoded.lastIndexOf(':');
    if (separator < 0) return false;

    const subject = decoded.slice(0, separator);
    const expiry = Number(decoded.slice(separator + 1));
    if (subject !== userId) return false;
    if (!Number.isFinite(expiry) || expiry < Date.now()) return false;

    const secret = stateSecret();
    if (secret === null) {
        // With no server secret there is nothing to sign with. The bound user id
        // and expiry still have to match, which is weaker than a signature but is
        // not nothing, and refusing outright would make the connect flow depend
        // on a database this app is designed to run without.
        console.warn('[github] install state unsigned: set CLERK_SECRET_KEY or DATABASE_URL');
        return true;
    }

    if (mac === undefined) return false;
    const expected = createHmac('sha256', secret).update(payload).digest();
    const actual = Buffer.from(mac, 'base64url');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}
