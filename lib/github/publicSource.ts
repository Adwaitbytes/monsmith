import 'server-only';

import { collectSolidity, describeRepo, fetchRepoBlob, fetchRepoTree } from './client';
import type { ImportResult, RepoRef, RepoSource, RepoSummary } from './source';

/**
 * Importing a public repository with no account, no redirect and no token.
 *
 * This is the path that has to work on a first visit, so it is deliberately the
 * one with nothing to configure. GitHub allows sixty unauthenticated requests an
 * hour per IP, which is enough for a handful of imports and not enough for a
 * team, and that is the honest moment to offer the GitHub App rather than asking
 * for an install before the product has shown anything.
 */
export const publicSource: RepoSource = {
    kind: 'public',

    describe(ref: RepoRef): Promise<RepoSummary> {
        return describeRepo(ref, null);
    },

    importSolidity(ref: RepoRef): Promise<ImportResult> {
        return collectSolidity(
            ref,
            (target) => fetchRepoTree(target, null),
            (sha) => fetchRepoBlob(ref, sha, null),
        );
    },
};
