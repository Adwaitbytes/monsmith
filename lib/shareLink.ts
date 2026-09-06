/**
 * Share links that carry the contract instead of pointing at a copy of it.
 *
 * The obvious design is to store the source, hand back a short id, and serve it
 * later. That means a database, a retention policy, moderation, and telling
 * people their unpublished contracts now live on someone else's server. For a
 * tool whose whole pitch is that it measures rather than collects, that is a
 * bad trade, so the contract is compressed into the link itself and nothing is
 * stored anywhere.
 *
 * It goes in the URL fragment rather than the query string on purpose. A
 * fragment is never sent to the server, so a shared contract does not pass
 * through our logs, our CDN, or any proxy in between. The cost is that the page
 * cannot render a preview of someone else's contract server-side, which is the
 * right thing to give up for this.
 *
 * Compression is deflate-raw through the platform's own CompressionStream, so
 * there is no dependency. Solidity compresses well, usually to about a fifth,
 * which puts a typical contract comfortably inside a URL.
 */

export type ShareView = "parallel" | "gas" | "chainfit";

export const SHARE_VIEWS: readonly ShareView[] = ["parallel", "gas", "chainfit"];

export const SHARE_VIEW_LABELS: Record<ShareView, string> = {
    parallel: "Parallel execution",
    gas: "Gas profile",
    chainfit: "Chain Fit",
};

/**
 * Longest token we will produce. Browsers and CDNs vary in what they accept and
 * a link that silently breaks in someone's chat client is worse than being told
 * up front that a contract is too big to inline.
 */
export const MAX_SHARE_TOKEN_LENGTH = 6_000;

const DEFLATE_PREFIX = "1z.";
const RAW_PREFIX = "1r.";

function toBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
    }

    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

function hasCompression(): boolean {
    return typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";
}

/** Compresses a contract into a URL-safe token. */
export async function encodeShare(source: string): Promise<string> {
    const bytes = new TextEncoder().encode(source);

    if (!hasCompression()) return RAW_PREFIX + toBase64Url(bytes);

    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return DEFLATE_PREFIX + toBase64Url(await collect(stream));
}

/** Reverses `encodeShare`. Returns null for anything malformed. */
export async function decodeShare(token: string): Promise<string | null> {
    try {
        if (token.startsWith(RAW_PREFIX)) {
            return new TextDecoder().decode(fromBase64Url(token.slice(RAW_PREFIX.length)));
        }

        if (token.startsWith(DEFLATE_PREFIX)) {
            if (!hasCompression()) return null;
            const bytes = fromBase64Url(token.slice(DEFLATE_PREFIX.length));
            const stream = new Blob([bytes as BlobPart])
                .stream()
                .pipeThrough(new DecompressionStream("deflate-raw"));
            return new TextDecoder().decode(await collect(stream));
        }

        return null;
    } catch {
        return null;
    }
}

export interface ShareTarget {
    view: ShareView;
    source: string;
}

/**
 * Builds the shareable URL for one analysis, or reports why it cannot.
 *
 * `origin` is passed in rather than read from `window` so this stays usable
 * from a server component and testable without a DOM.
 */
export async function buildShareUrl(
    origin: string,
    target: ShareTarget,
): Promise<{ url: string } | { error: string }> {
    if (target.source.trim().length === 0) {
        return { error: "There is nothing to share yet." };
    }

    const token = await encodeShare(target.source);
    if (token.length > MAX_SHARE_TOKEN_LENGTH) {
        return {
            error:
                "This contract is too large to fit in a link. Nothing is stored server-side, so the source has to travel in the URL itself.",
        };
    }

    return { url: `${origin}/share#v=${target.view}&c=${token}` };
}

/** Reads a share fragment, e.g. `#v=gas&c=1z.abc`. */
export function parseShareFragment(fragment: string): ShareTarget | null {
    const params = new URLSearchParams(fragment.replace(/^#/, ""));
    const view = params.get("v");
    const token = params.get("c");

    if (view === null || token === null) return null;
    if (!SHARE_VIEWS.includes(view as ShareView)) return null;

    return { view: view as ShareView, source: token };
}
