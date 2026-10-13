/**
 * Reading GitHub's webhook deliveries.
 *
 * Every delivery is signed with the app's webhook secret, and nothing in one is
 * trusted until that signature checks out: the endpoint is public, and a forged
 * "pull request opened" would otherwise spend model credits and post comments
 * on any repository the app is installed on. After the signature, the payload
 * is still read field by field, because a shape change on GitHub's side should
 * end as an ignored event rather than an undefined in a database row.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** True when `header` is GitHub's `sha256=` signature of `body` under `secret`. */
export function verifySignature(secret: string, body: string, header: string | null): boolean {
    if (secret.length === 0 || header === null || !header.startsWith('sha256=')) return false;
    const expected = Buffer.from(createHmac('sha256', secret).update(body, 'utf8').digest('hex'), 'utf8');
    const given = Buffer.from(header.slice('sha256='.length), 'utf8');
    return given.length === expected.length && timingSafeEqual(given, expected);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function int(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export interface RepoInfo {
    id: number;
    owner: string;
    name: string;
    fullName: string;
    private: boolean;
    defaultBranch: string;
}

export interface PullInfo {
    number: number;
    title: string;
    author: string | null;
    headSha: string;
    draft: boolean;
    merged: boolean;
    mergeSha: string | null;
    baseRef: string;
}

export type PullAction = 'opened' | 'synchronize' | 'reopened' | 'ready_for_review' | 'closed';

export type WebhookEvent =
    | { kind: 'pull_request'; action: PullAction; installationId: number; repo: RepoInfo; pull: PullInfo }
    | { kind: 'installation'; action: 'created' | 'deleted' | 'suspend' | 'unsuspend'; installationId: number; account: string | null; accountType: string | null }
    | { kind: 'ignored'; reason: string };

const PULL_ACTIONS = new Set<string>(['opened', 'synchronize', 'reopened', 'ready_for_review', 'closed']);
const INSTALL_ACTIONS = new Set<string>(['created', 'deleted', 'suspend', 'unsuspend']);

function readRepo(raw: unknown): RepoInfo | null {
    if (!isRecord(raw) || !isRecord(raw.owner)) return null;
    const id = int(raw.id);
    const owner = str(raw.owner.login);
    const name = str(raw.name);
    if (id === null || owner === null || name === null) return null;
    return {
        id,
        owner,
        name,
        fullName: str(raw.full_name) ?? `${owner}/${name}`,
        private: raw.private === true,
        defaultBranch: str(raw.default_branch) ?? 'main',
    };
}

function readPull(raw: unknown): PullInfo | null {
    if (!isRecord(raw) || !isRecord(raw.head) || !isRecord(raw.base)) return null;
    const number = int(raw.number);
    const headSha = str(raw.head.sha);
    const baseRef = str(raw.base.ref);
    if (number === null || headSha === null || !/^[0-9a-f]{40}$/.test(headSha) || baseRef === null) return null;
    const mergeSha = str(raw.merge_commit_sha);
    return {
        number,
        title: (str(raw.title) ?? '').slice(0, 300),
        author: isRecord(raw.user) ? str(raw.user.login) : null,
        headSha,
        draft: raw.draft === true,
        merged: raw.merged === true,
        mergeSha: mergeSha !== null && /^[0-9a-f]{40}$/.test(mergeSha) ? mergeSha : null,
        baseRef,
    };
}

/** Narrows a verified delivery to the events the review acts on. */
export function parseEvent(name: string | null, payload: unknown): WebhookEvent {
    if (!isRecord(payload)) return { kind: 'ignored', reason: 'payload is not an object' };
    const action = str(payload.action);
    const installationId = isRecord(payload.installation) ? int(payload.installation.id) : null;
    if (installationId === null) return { kind: 'ignored', reason: 'no installation' };

    if (name === 'pull_request') {
        if (action === null || !PULL_ACTIONS.has(action)) return { kind: 'ignored', reason: `pull_request.${action ?? 'unknown'}` };
        const repo = readRepo(payload.repository);
        const pull = readPull(payload.pull_request);
        if (repo === null || pull === null) return { kind: 'ignored', reason: 'unreadable pull request' };
        return { kind: 'pull_request', action: action as PullAction, installationId, repo, pull };
    }

    if (name === 'installation') {
        if (action === null || !INSTALL_ACTIONS.has(action)) return { kind: 'ignored', reason: `installation.${action ?? 'unknown'}` };
        const account = isRecord(payload.installation) && isRecord(payload.installation.account) ? payload.installation.account : null;
        return {
            kind: 'installation',
            action: action as 'created' | 'deleted' | 'suspend' | 'unsuspend',
            installationId,
            account: account === null ? null : str(account.login),
            accountType: account === null ? null : str(account.type),
        };
    }

    return { kind: 'ignored', reason: name ?? 'unnamed event' };
}

/** Whether a pull request event should start a review. Drafts wait until they are ready. */
export function shouldReview(event: Extract<WebhookEvent, { kind: 'pull_request' }>): boolean {
    if (event.action === 'closed') return false;
    return !event.pull.draft;
}
