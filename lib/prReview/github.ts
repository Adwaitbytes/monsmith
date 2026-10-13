import 'server-only';

import { collectSolidity, fetchRepoBlob, fetchRepoTree, githubFetch, isRecord } from '../github/client';
import { GitHubError, type ImportResult } from '../github/source';
import { COMMENT_MARKER } from './comment';
import type { CheckAnnotation, CheckConclusion } from './tracking';
import { MAX_ANNOTATIONS } from './tracking';

/**
 * The GitHub calls the pull request review makes, all as the app installation.
 *
 * Writes are limited to what the app was granted for this: one comment per pull
 * request and one check run per reviewed commit. Reads go through the same
 * importer the studio uses, so a pull request is audited from exactly the
 * workspace a person importing that commit by hand would get.
 */

export interface Repo {
    owner: string;
    name: string;
}

function base(repo: Repo): string {
    return `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
}

export interface PullFile {
    path: string;
    status: string;
}

/** A pull request has at most 3,000 files in this list; anything past that is GitHub's cap, not ours. */
const MAX_FILE_PAGES = 30;

export async function listPullFiles(token: string, repo: Repo, number: number): Promise<PullFile[]> {
    const files: PullFile[] = [];
    for (let page = 1; page <= MAX_FILE_PAGES; page += 1) {
        const data = await githubFetch(`${base(repo)}/pulls/${number}/files?per_page=100&page=${page}`, { token });
        if (!Array.isArray(data) || data.length === 0) break;
        for (const raw of data) {
            if (!isRecord(raw) || typeof raw.filename !== 'string' || typeof raw.status !== 'string') continue;
            files.push({ path: raw.filename, status: raw.status });
        }
        if (data.length < 100) break;
    }
    return files;
}

/** The repository's Solidity at one commit, through the studio's own importer. */
export async function importAt(token: string, repo: Repo, sha: string): Promise<ImportResult> {
    const ref = { owner: repo.owner, repo: repo.name, ref: sha };
    return collectSolidity(
        ref,
        (target) => fetchRepoTree(target, token),
        (blobSha) => fetchRepoBlob(ref, blobSha, token),
    );
}

/** One file at one commit, or null when it does not exist there. */
export async function fileAt(token: string, repo: Repo, path: string, sha: string): Promise<string | null> {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    try {
        const data = await githubFetch(`${base(repo)}/contents/${encoded}?ref=${sha}`, { token });
        if (!isRecord(data) || typeof data.content !== 'string' || data.encoding !== 'base64') return null;
        return Buffer.from(data.content, 'base64').toString('utf8');
    } catch (error) {
        if (error instanceof GitHubError && error.failure === 'not-found') return null;
        throw error;
    }
}

// ============= THE COMMENT =============

const MAX_COMMENT_PAGES = 10;

/** Finds Monsmith's comment by its marker, for a pull request reviewed before its id was stored. */
async function findComment(token: string, repo: Repo, number: number): Promise<number | null> {
    for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
        const data = await githubFetch(`${base(repo)}/issues/${number}/comments?per_page=100&page=${page}`, { token });
        if (!Array.isArray(data) || data.length === 0) return null;
        for (const raw of data) {
            if (!isRecord(raw) || typeof raw.body !== 'string' || typeof raw.id !== 'number') continue;
            const bot = isRecord(raw.user) && raw.user.type === 'Bot';
            if (bot && raw.body.startsWith(COMMENT_MARKER)) return raw.id;
        }
        if (data.length < 100) return null;
    }
    return null;
}

/**
 * Writes the review comment, editing the existing one when there is one.
 * Returns the comment id so the caller can remember it.
 */
export async function upsertComment(
    token: string,
    repo: Repo,
    number: number,
    body: string,
    knownId: number | null,
): Promise<number> {
    const existing = knownId ?? (await findComment(token, repo, number));
    if (existing !== null) {
        try {
            await githubFetch(`${base(repo)}/issues/comments/${existing}`, { token, method: 'PATCH', body: { body } });
            return existing;
        } catch (error) {
            // Someone deleted the comment. Post a fresh one rather than fail the review.
            if (!(error instanceof GitHubError && error.failure === 'not-found')) throw error;
        }
    }
    const created = await githubFetch(`${base(repo)}/issues/${number}/comments`, { token, method: 'POST', body: { body } });
    if (!isRecord(created) || typeof created.id !== 'number') {
        throw new GitHubError('GitHub did not return the comment it created.', 'unavailable');
    }
    return created.id;
}

// ============= THE CHECK RUN =============

export const CHECK_NAME = 'Monsmith';

/** Starts the check, so the pull request shows a review in progress. Null when the app cannot write checks. */
export async function startCheck(token: string, repo: Repo, headSha: string, detailsUrl: string): Promise<number | null> {
    try {
        const data = await githubFetch(`${base(repo)}/check-runs`, {
            token,
            method: 'POST',
            body: {
                name: CHECK_NAME,
                head_sha: headSha,
                status: 'in_progress',
                details_url: detailsUrl,
                output: { title: 'Auditing the contracts this pull request changes', summary: 'Monsmith is running a full audit. This usually takes one to three minutes.' },
            },
        });
        return isRecord(data) && typeof data.id === 'number' ? data.id : null;
    } catch (error) {
        // A check is a nicety on top of the comment. An installation that has
        // not accepted the checks permission still gets its review.
        console.warn('[pr-review] could not start a check run:', error instanceof Error ? error.message : error);
        return null;
    }
}

export async function finishCheck(
    token: string,
    repo: Repo,
    checkId: number | null,
    result: {
        conclusion: CheckConclusion | 'neutral';
        title: string;
        summary: string;
        detailsUrl?: string;
        annotations?: readonly CheckAnnotation[];
    },
): Promise<void> {
    if (checkId === null) return;
    try {
        await githubFetch(`${base(repo)}/check-runs/${checkId}`, {
            token,
            method: 'PATCH',
            body: {
                status: 'completed',
                conclusion: result.conclusion,
                completed_at: new Date().toISOString(),
                ...(result.detailsUrl !== undefined ? { details_url: result.detailsUrl } : {}),
                output: {
                    title: result.title.slice(0, 255),
                    summary: result.summary.slice(0, 60_000),
                    annotations: (result.annotations ?? []).slice(0, MAX_ANNOTATIONS),
                },
            },
        });
    } catch (error) {
        console.warn('[pr-review] could not finish the check run:', error instanceof Error ? error.message : error);
    }
}
