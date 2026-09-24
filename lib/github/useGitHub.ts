'use client';

import { useCallback, useEffect, useState } from 'react';

import type { RepoRef, RepoSummary } from './source';

/**
 * The studio's side of importing a repository.
 *
 * The connection state is loaded lazily rather than on mount, because the
 * overwhelming majority of visits never touch GitHub and a status request on
 * every studio load would be a round trip spent on nothing. It is fetched the
 * first time something actually needs to know, which is when the picker opens.
 *
 * Importing deliberately does not require being connected. A public repository
 * URL resolves with no account at all, and the 401 that comes back from a
 * private one carries the install URL so the connect step can be offered in
 * place, at the moment it became relevant, rather than as a gate in front of
 * everything.
 */

export interface GitHubStatus {
    configured: boolean;
    connected: boolean;
    installUrl: string | null;
    accounts: Array<{ installationId: number; accountLogin: string | null }>;
    /** False means sign in, not that the deployment is broken. */
    signedIn: boolean;
    /** False means the GitHub App genuinely is not set up on this deployment. */
    appAvailable: boolean;
}

export interface ImportedRepo {
    files: Record<string, string>;
    ref: RepoRef & { ref: string };
    private: boolean;
    skipped: Array<{ path: string; reason: string }>;
    truncated: boolean;
    counts: { solidity: number; auditable: number };
}

interface ImportFailure {
    message: string;
    /** Present when there is an installation to send them to. */
    installUrl?: string;
    /**
     * Whether connecting an account could make this import work.
     *
     * Read from the failure code rather than from the presence of an install
     * URL. A signed-out visitor has no URL to be given yet — there is nobody to
     * issue it to — and they are exactly the person who needs to be offered the
     * way in, so keying the offer off the URL hid it from the only audience
     * that could not do without it.
     */
    connectable?: boolean;
}

export function useGitHub() {
    const [status, setStatus] = useState<GitHubStatus | null>(null);
    const [repos, setRepos] = useState<RepoSummary[]>([]);
    const [reposLoading, setReposLoading] = useState(false);
    const [reposError, setReposError] = useState<string | null>(null);
    const [importing, setImporting] = useState(false);

    const refreshStatus = useCallback(async () => {
        try {
            const response = await fetch('/api/github/status');
            if (!response.ok) {
                setStatus({ configured: false, connected: false, installUrl: null, accounts: [], signedIn: false, appAvailable: false });
                return;
            }
            setStatus((await response.json()) as GitHubStatus);
        } catch {
            // A status we cannot read is indistinguishable from not configured,
            // and both lead to the same offer: paste a public URL instead.
            setStatus({ configured: false, connected: false, installUrl: null, accounts: [], signedIn: false, appAvailable: false });
        }
    }, []);

    const loadRepos = useCallback(async () => {
        setReposLoading(true);
        setReposError(null);
        try {
            const response = await fetch('/api/github/repos');
            const data = (await response.json()) as
                | { repos: RepoSummary[] }
                | { error: string };

            if (!response.ok || 'error' in data) {
                setReposError('error' in data ? data.error : 'Could not list your repositories.');
                setRepos([]);
                return;
            }
            setRepos(data.repos);
        } catch {
            setReposError('Could not reach GitHub.');
            setRepos([]);
        } finally {
            setReposLoading(false);
        }
    }, []);

    /** Loads status and, when connected, the repository list behind it. */
    const prepare = useCallback(async () => {
        const current = status ?? null;
        if (current === null) await refreshStatus();
    }, [status, refreshStatus]);

    useEffect(() => {
        if (status?.connected === true && repos.length === 0 && !reposLoading && reposError === null) {
            void loadRepos();
        }
    }, [status, repos.length, reposLoading, reposError, loadRepos]);

    const importRepo = useCallback(
        async (target: RepoRef | { url: string }): Promise<ImportedRepo | ImportFailure> => {
            setImporting(true);
            try {
                const response = await fetch('/api/github/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(target),
                });
                const data = (await response.json()) as Record<string, unknown>;

                if (!response.ok) {
                    const failure = typeof data.failure === 'string' ? data.failure : null;
                    return {
                        message:
                            typeof data.error === 'string'
                                ? data.error
                                : 'That repository could not be imported.',
                        ...(typeof data.installUrl === 'string'
                            ? { installUrl: data.installUrl }
                            : {}),
                        ...(failure === 'needs-auth' || failure === 'not-found'
                            ? { connectable: true }
                            : {}),
                    };
                }

                return {
                    files: (data.files ?? {}) as Record<string, string>,
                    ref: data.ref as RepoRef & { ref: string },
                    private: data.private === true,
                    skipped: (data.skipped ?? []) as Array<{ path: string; reason: string }>,
                    truncated: data.truncated === true,
                    counts: (data.counts ?? { solidity: 0, auditable: 0 }) as {
                        solidity: number;
                        auditable: number;
                    },
                };
            } catch (error) {
                return {
                    message: error instanceof Error ? error.message : 'The import failed.',
                };
            } finally {
                setImporting(false);
            }
        },
        [],
    );

    return {
        status,
        repos,
        reposLoading,
        reposError,
        importing,
        prepare,
        refreshStatus,
        loadRepos,
        importRepo,
    };
}

/** Narrows an import result, which is a union rather than a throw. */
export function importFailed(
    result: ImportedRepo | ImportFailure,
): result is ImportFailure {
    return 'message' in result;
}
