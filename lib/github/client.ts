import 'server-only';

import {
    classifySolidityPath,
    GitHubError,
    MAX_FILE_BYTES,
    type ImportResult,
    type RepoFile,
    type RepoRef,
    type RepoSummary,
} from './source';

/**
 * The one place that talks to api.github.com.
 *
 * Both sources behind `RepoSource` need the same four things: a repository
 * description, a recursive tree, a blob, and a consistent way to turn an HTTP
 * status into a `GitHubFailure`. Keeping that here is what lets the public and
 * installation sources be twenty lines each, and it means the status mapping is
 * written once: a route that has to decide between 401, 429 and 502 should not
 * have to know that GitHub signals an exhausted quota with a 403.
 *
 * GitHub's JSON is treated as untrusted input throughout. Every field is checked
 * before it is read, because a shape change on their side should degrade to a
 * clear error rather than an undefined flowing into a workspace path.
 */

const API_ROOT = 'https://api.github.com';
const USER_AGENT = 'monsmith-studio';
const TIMEOUT_MS = 20_000;

/** Concurrent blob reads. Eight keeps a fifty file import under a few seconds
 * without tripping GitHub's secondary rate limits, which punish bursts. */
const MAX_IN_FLIGHT = 8;

/** Hard ceiling on files per import, so one generated monorepo cannot turn a
 * single request into thousands of blob fetches and a response nobody can hold. */
const MAX_FILES = 300;

export interface GitHubFetchOptions {
    /** App JWT or installation token. Absent means the unauthenticated path. */
    token?: string | null;
    accept?: string;
    method?: 'GET' | 'POST' | 'PATCH';
    /** Sent as JSON. Only the pull request review writes anything. */
    body?: unknown;
}

/**
 * A single GitHub request, returning parsed but unvalidated JSON.
 *
 * Returns `unknown` on purpose. Callers validate, so there is no point in this
 * layer pretending to know the shape.
 */
export async function githubFetch(
    path: string,
    options: GitHubFetchOptions = {},
): Promise<unknown> {
    const headers: Record<string, string> = {
        Accept: options.accept ?? 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': USER_AGENT,
    };

    const token = options.token;
    if (typeof token === 'string' && token.length > 0) {
        headers.Authorization = `Bearer ${token}`;
    }

    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
        response = await fetch(`${API_ROOT}${path}`, {
            method: options.method ?? 'GET',
            headers,
            ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
            signal: controller.signal,
            cache: 'no-store',
        });
    } catch {
        throw new GitHubError('GitHub did not answer in time.', 'unavailable');
    } finally {
        clearTimeout(timer);
    }

    if (!response.ok) throw failureFor(response, headers.Authorization !== undefined);

    try {
        return (await response.json()) as unknown;
    } catch {
        throw new GitHubError('GitHub answered with something that is not JSON.', 'unavailable');
    }
}

function failureFor(response: Response, authenticated: boolean): GitHubError {
    const status = response.status;

    if (status === 404) {
        /*
          GitHub answers 404, not 403, for a private repository the caller
          cannot see: it will not confirm that one exists. So an anonymous 404
          is genuinely ambiguous, and reporting it as "does not exist" told
          somebody holding a perfectly good private repo that their URL was
          wrong, with no way forward. Said as a question about access, the next
          step is obvious and the studio can offer it.
        */
        if (!authenticated) {
            return new GitHubError(
                'That repository is private or does not exist. Connect GitHub to import a private repository.',
                'needs-auth',
            );
        }
        return new GitHubError(
            'That repository does not exist, or this account cannot see it.',
            'not-found',
        );
    }

    // An exhausted quota comes back as a plain 403 (429 for the secondary,
    // burst-based limits), so the remaining-quota header is the only way to tell
    // a throttled caller apart from an unauthorised one.
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (status === 429 || ((status === 401 || status === 403) && remaining === '0')) {
        return new GitHubError(
            'GitHub rate limit reached. Connecting a GitHub account raises the limit to 5,000 requests an hour.',
            'rate-limited',
        );
    }

    if (status === 401 || status === 403) {
        return new GitHubError('GitHub needs a connected account for this repository.', 'needs-auth');
    }

    if (status >= 500) {
        return new GitHubError(`GitHub is unavailable right now (HTTP ${status}).`, 'unavailable');
    }

    return new GitHubError(`GitHub rejected the request (HTTP ${status}).`, 'unavailable');
}

// ============= RESPONSE VALIDATION =============

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Owner and repo go into a URL path, so anything that is not a GitHub name is
 * rejected here rather than escaped and sent. */
const NAME = /^[A-Za-z0-9._-]+$/;

export function isRepoName(value: string): boolean {
    return value.length > 0 && value.length <= 100 && NAME.test(value);
}

function repoPath(ref: RepoRef): string {
    if (!isRepoName(ref.owner) || !isRepoName(ref.repo)) {
        throw new GitHubError(`"${ref.owner}/${ref.repo}" is not a GitHub repository name.`, 'not-found');
    }
    return `/repos/${ref.owner}/${ref.repo}`;
}

/** Turns one repository object into a summary, or null when it is not one. */
export function parseSummary(data: unknown): RepoSummary | null {
    if (!isRecord(data)) return null;

    const owner = isRecord(data.owner) ? text(data.owner.login) : null;
    const repo = text(data.name);
    if (owner === null || repo === null) return null;

    return {
        owner,
        repo,
        fullName: text(data.full_name) ?? `${owner}/${repo}`,
        private: data.private === true,
        defaultBranch: text(data.default_branch) ?? 'main',
        description: text(data.description),
        pushedAt: text(data.pushed_at),
        language: text(data.language),
    };
}

// ============= REPOSITORY READS =============

export async function describeRepo(ref: RepoRef, token: string | null): Promise<RepoSummary> {
    const summary = parseSummary(await githubFetch(repoPath(ref), { token }));
    if (summary === null) {
        throw new GitHubError('GitHub described that repository in a shape this build cannot read.', 'unavailable');
    }
    return summary;
}

export interface TreeEntry {
    path: string;
    sha: string;
    /** Blob size in bytes as the tree reports it. Null when GitHub omits it. */
    size: number | null;
}

export interface RepoTree {
    /** The ref actually read, with the default branch already resolved. */
    ref: string;
    private: boolean;
    entries: TreeEntry[];
    truncated: boolean;
}

/**
 * The repository's file list at a ref.
 *
 * Costs two requests rather than one because the repository object carries both
 * the default branch and the private flag, and the import result has to report
 * the second whether or not the caller named a ref.
 */
export async function fetchRepoTree(ref: RepoRef, token: string | null): Promise<RepoTree> {
    const summary = await describeRepo(ref, token);
    const resolved = ref.ref !== undefined && ref.ref.length > 0 ? ref.ref : summary.defaultBranch;

    const data = await githubFetch(
        `${repoPath(ref)}/git/trees/${encodeURIComponent(resolved)}?recursive=1`,
        { token },
    );

    if (!isRecord(data) || !Array.isArray(data.tree)) {
        throw new GitHubError(`GitHub has no tree for "${resolved}" in ${summary.fullName}.`, 'not-found');
    }

    const entries: TreeEntry[] = [];
    for (const raw of data.tree) {
        if (!isRecord(raw) || raw.type !== 'blob') continue;
        const path = text(raw.path);
        const sha = text(raw.sha);
        if (path === null || sha === null) continue;
        entries.push({ path, sha, size: typeof raw.size === 'number' ? raw.size : null });
    }

    return {
        ref: resolved,
        private: summary.private,
        entries,
        truncated: data.truncated === true,
    };
}

/**
 * One file's contents.
 *
 * The blobs endpoint rather than the contents endpoint, because the latter
 * refuses anything over a megabyte and a flattened contract can pass that.
 */
export async function fetchRepoBlob(
    ref: RepoRef,
    sha: string,
    token: string | null,
): Promise<string> {
    if (!/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(sha)) {
        throw new GitHubError('That is not a git object id.', 'not-found');
    }

    const data = await githubFetch(`${repoPath(ref)}/git/blobs/${sha}`, { token });
    if (!isRecord(data)) {
        throw new GitHubError('GitHub returned a blob this build cannot read.', 'unavailable');
    }

    const content = typeof data.content === 'string' ? data.content : null;
    if (content === null || data.encoding !== 'base64') {
        // GitHub answers with `encoding: "none"` when a blob is too big to inline.
        throw new GitHubError('That file is too large for GitHub to return.', 'too-large');
    }

    return Buffer.from(content, 'base64').toString('utf8');
}

// ============= THE SHARED IMPORT =============

export type TreeFetcher = (ref: RepoRef) => Promise<RepoTree>;
export type BlobFetcher = (sha: string, path: string) => Promise<string>;

type BlobOutcome =
    | { kind: 'file'; file: RepoFile }
    | { kind: 'skipped'; path: string; reason: string }
    | { kind: 'fatal'; error: GitHubError };

/**
 * Walks a repository tree and returns the Solidity worth auditing.
 *
 * Both sources share this so that a public import and a private one produce
 * byte-identical workspaces. The only difference between them is which token
 * the two injected readers carry, which is also why they are injected rather
 * than taken as a token argument: this function has no business knowing how the
 * caller authenticates, and it never sees a token at all.
 */
export async function collectSolidity(
    ref: RepoRef,
    fetchTree: TreeFetcher,
    fetchBlob: BlobFetcher,
): Promise<ImportResult> {
    const tree = await fetchTree(ref);
    const subdir = normaliseSubdir(ref.subdir);

    const skipped: Array<{ path: string; reason: string }> = [];
    const candidates: TreeEntry[] = [];

    for (const entry of tree.entries) {
        if (subdir !== null && !withinSubdir(entry.path, subdir)) continue;

        const verdict = classifySolidityPath(entry.path);
        if (!verdict.audit) {
            // Reporting every README and lockfile as "skipped" would bury the
            // exclusions that actually tell the user something.
            if (verdict.reason !== 'not Solidity') {
                skipped.push({ path: entry.path, reason: verdict.reason ?? 'excluded' });
            }
            continue;
        }

        if (entry.size !== null && entry.size > MAX_FILE_BYTES) {
            skipped.push({ path: entry.path, reason: `larger than ${MAX_FILE_BYTES / 1024} KB` });
            continue;
        }

        candidates.push(entry);
    }

    candidates.sort((a, b) => a.path.localeCompare(b.path));

    for (const entry of candidates.splice(MAX_FILES)) {
        skipped.push({ path: entry.path, reason: `beyond the ${MAX_FILES} file import ceiling` });
    }

    if (candidates.length === 0) {
        throw new GitHubError(noSolidityMessage(subdir, skipped.length), 'no-solidity');
    }

    const outcomes = await mapPool<TreeEntry, BlobOutcome>(
        candidates,
        MAX_IN_FLIGHT,
        async (entry) => {
            try {
                const content = await fetchBlob(entry.sha, entry.path);
                const bytes = Buffer.byteLength(content, 'utf8');
                if (bytes > MAX_FILE_BYTES) {
                    return { kind: 'skipped', path: entry.path, reason: `larger than ${MAX_FILE_BYTES / 1024} KB` };
                }
                return { kind: 'file', file: { path: entry.path, content, bytes } };
            } catch (error) {
                // A throttled or unauthorised read means every other read is
                // about to fail the same way, so it ends the import rather than
                // quietly producing a partial one. Anything else is this one
                // file's problem and is reported as a skip.
                if (
                    error instanceof GitHubError &&
                    (error.failure === 'rate-limited' || error.failure === 'needs-auth')
                ) {
                    return { kind: 'fatal', error };
                }
                return {
                    kind: 'skipped',
                    path: entry.path,
                    reason: error instanceof Error ? error.message : 'could not be read',
                };
            }
        },
    );

    const files: RepoFile[] = [];
    for (const outcome of outcomes) {
        if (outcome.kind === 'fatal') throw outcome.error;
        if (outcome.kind === 'skipped') skipped.push({ path: outcome.path, reason: outcome.reason });
        else files.push(outcome.file);
    }

    if (files.length === 0) {
        throw new GitHubError(noSolidityMessage(subdir, skipped.length), 'no-solidity');
    }

    const resolved: RepoRef & { ref: string } = {
        owner: ref.owner,
        repo: ref.repo,
        ref: tree.ref,
        ...(subdir !== null ? { subdir } : {}),
    };

    return { ref: resolved, private: tree.private, files, skipped, truncated: tree.truncated };
}

function noSolidityMessage(subdir: string | null, skippedCount: number): string {
    const where = subdir !== null ? `"${subdir}"` : 'that repository';
    if (skippedCount > 0) {
        return `Every Solidity file in ${where} is a dependency, a test or a script, so there is nothing to audit.`;
    }
    return `No Solidity found in ${where}.`;
}

function normaliseSubdir(subdir: string | undefined): string | null {
    if (subdir === undefined) return null;
    const trimmed = subdir.replace(/^\/+|\/+$/g, '').trim();
    return trimmed.length > 0 ? trimmed : null;
}

function withinSubdir(path: string, subdir: string): boolean {
    return path === subdir || path.startsWith(`${subdir}/`);
}

/**
 * Runs `worker` over `items` with at most `limit` in flight.
 *
 * A dependency for this would be twenty lines of code behind a supply chain, and
 * the worker is written to never reject, so there is no cancellation semantics
 * to get wrong either.
 */
async function mapPool<T, R>(
    items: readonly T[],
    limit: number,
    worker: (item: T) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cursor = 0;

    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        for (;;) {
            const index = cursor;
            cursor += 1;
            if (index >= items.length) return;
            results[index] = await worker(items[index]);
        }
    });

    await Promise.all(runners);
    return results;
}
