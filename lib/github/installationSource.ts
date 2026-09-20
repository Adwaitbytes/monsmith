import 'server-only';

import { installationToken } from './app';
import {
    collectSolidity,
    describeRepo,
    fetchRepoBlob,
    fetchRepoTree,
    githubFetch,
    isRecord,
    parseSummary,
} from './client';
import { GitHubError, type ImportResult, type RepoRef, type RepoSource, type RepoSummary } from './source';

/**
 * Importing through a GitHub App installation.
 *
 * Identical to the public source in everything the studio can observe, which is
 * the point of `RepoSource`. What it adds is reach and headroom: private
 * repositories the installer selected, and 5,000 requests an hour instead of
 * sixty, which is the difference between importing one repository and working.
 *
 * It also adds `listRepos`, because an installation knows exactly which
 * repositories it was granted. That is a picker the public path cannot offer,
 * and it removes the only step of the import flow that requires typing.
 */

/** Guards the pagination loop against a response that never stops growing. */
const MAX_PAGES = 20;

export interface InstallationSource extends RepoSource {
    listRepos(): Promise<RepoSummary[]>;
}

export function installationSource(installationId: number): InstallationSource {
    async function token(): Promise<string> {
        const issued = await installationToken(installationId);
        if (issued === null) {
            throw new GitHubError(
                'This deployment has no GitHub App configured, so private repositories are out of reach.',
                'needs-auth',
            );
        }
        return issued;
    }

    return {
        kind: 'installation',

        async listRepos(): Promise<RepoSummary[]> {
            const auth = await token();
            const repos: RepoSummary[] = [];

            for (let page = 1; page <= MAX_PAGES; page += 1) {
                const data = await githubFetch(
                    `/installation/repositories?per_page=100&page=${page}`,
                    { token: auth },
                );
                if (!isRecord(data) || !Array.isArray(data.repositories)) break;
                if (data.repositories.length === 0) break;

                for (const raw of data.repositories) {
                    // One unreadable entry costs that repository a row in the
                    // picker, not the whole list.
                    const summary = parseSummary(raw);
                    if (summary !== null) repos.push(summary);
                }

                const total = typeof data.total_count === 'number' ? data.total_count : repos.length;
                if (repos.length >= total) break;
            }

            // Most recently pushed first: the repository someone wants to audit
            // is almost always the one they were just working in.
            return repos.sort(byPushedAtDesc);
        },

        async describe(ref: RepoRef): Promise<RepoSummary> {
            return describeRepo(ref, await token());
        },

        async importSolidity(ref: RepoRef): Promise<ImportResult> {
            const auth = await token();
            return collectSolidity(
                ref,
                (target) => fetchRepoTree(target, auth),
                (sha) => fetchRepoBlob(ref, sha, auth),
            );
        },
    };
}

function byPushedAtDesc(a: RepoSummary, b: RepoSummary): number {
    if (a.pushedAt === b.pushedAt) return a.fullName.localeCompare(b.fullName);
    if (a.pushedAt === null) return 1;
    if (b.pushedAt === null) return -1;
    return b.pushedAt.localeCompare(a.pushedAt);
}
