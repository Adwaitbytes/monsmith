/**
 * Where a repository's Solidity comes from.
 *
 * Two implementations sit behind this: an unauthenticated one that needs no
 * login and works on any public repository, and an installation-backed one that
 * reaches private repositories through a GitHub App. The studio must not be able
 * to tell them apart, which is the whole reason this interface exists: the
 * zero-friction path and the authenticated path have to produce the same
 * workspace, or the product has two importers to maintain and two to debug.
 */

export interface RepoRef {
    owner: string;
    repo: string;
    /** Branch, tag or commit. Empty means the repository's default branch. */
    ref?: string;
    /** Restrict the import to one subtree, as a repo-relative path. */
    subdir?: string;
}

export interface RepoSummary {
    owner: string;
    repo: string;
    fullName: string;
    private: boolean;
    defaultBranch: string;
    description: string | null;
    /** ISO timestamp, used to sort a picker so the live work is at the top. */
    pushedAt: string | null;
    language: string | null;
}

export interface RepoFile {
    /** Repository-relative path, which becomes the workspace path verbatim. */
    path: string;
    content: string;
    bytes: number;
}

export interface ImportResult {
    ref: RepoRef & { ref: string };
    private: boolean;
    files: RepoFile[];
    /** Paths the tree offered that were filtered out, with the reason. */
    skipped: Array<{ path: string; reason: string }>;
    /** True when GitHub truncated the tree, so the import may be partial. */
    truncated: boolean;
}

export type GitHubFailure =
    | 'not-found'
    | 'needs-auth'
    | 'rate-limited'
    | 'no-solidity'
    | 'too-large'
    | 'unavailable';

export class GitHubError extends Error {
    readonly failure: GitHubFailure;

    constructor(message: string, failure: GitHubFailure) {
        super(message);
        this.name = 'GitHubError';
        this.failure = failure;
    }
}

export interface RepoSource {
    /** Human name for the provenance line in the report. */
    readonly kind: 'public' | 'installation';
    listRepos?(): Promise<RepoSummary[]>;
    describe(ref: RepoRef): Promise<RepoSummary>;
    importSolidity(ref: RepoRef): Promise<ImportResult>;
}

// ============= URL PARSING =============

/**
 * Pulls a repository out of whatever the user pasted.
 *
 * Accepts the shapes people actually have on their clipboard: the browser URL,
 * a deep link into a file or a tree, an SSH remote, a clone URL, or just
 * `owner/repo`. Returning null rather than throwing lets the omnibox try the
 * next interpretation (an address, or Solidity source) without a try/catch.
 */
export function parseRepoInput(input: string): RepoRef | null {
    const text = input.trim();
    if (text.length === 0) return null;

    const ssh = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(text);
    if (ssh !== null) return { owner: ssh[1], repo: ssh[2] };

    const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s?#]+)(.*)$/.exec(text);
    if (url !== null) {
        const owner = url[1];
        const repo = url[2].replace(/\.git$/, '');
        const rest = url[3] ?? '';

        // /tree/<ref>/<subdir> and /blob/<ref>/<path> both name a ref, and the
        // remainder is a subtree worth honouring: someone who pasted a link to
        // `contracts/` means that folder, not the whole monorepo.
        const deep = /^\/(?:tree|blob)\/([^/]+)(?:\/(.*))?$/.exec(rest.split('?')[0].split('#')[0]);
        if (deep !== null) {
            const subdir = deep[2];
            return {
                owner,
                repo,
                ref: decodeURIComponent(deep[1]),
                ...(subdir !== undefined && subdir.length > 0
                    ? { subdir: subdir.replace(/\/[^/]*\.[a-z]+$/i, '') }
                    : {}),
            };
        }
        return { owner, repo };
    }

    const bare = /^([A-Za-z0-9][\w.-]*)\/([\w.-]+?)(?:\.git)?$/.exec(text);
    if (bare !== null) return { owner: bare[1], repo: bare[2] };

    return null;
}

// ============= WHAT COUNTS AS AUDITABLE SOLIDITY =============

/** Largest single source file accepted, so one generated artefact cannot
 * exhaust a report's budget on its own. */
export const MAX_FILE_BYTES = 512 * 1024;

/** Directories that are never a repository's own contracts. */
const EXCLUDED_DIRS = [
    'node_modules',
    'lib/forge-std',
    'lib/openzeppelin-contracts',
    'lib/solmate',
    'lib/ds-test',
    '.git',
    'out',
    'artifacts',
    'cache',
    'coverage',
    'typechain',
    'typechain-types',
];

/**
 * Paths that are a repository's own work, as opposed to its dependencies, its
 * tests or its deploy scripts.
 *
 * Auditing a vendored copy of OpenZeppelin produces findings nobody asked for
 * and drowns the ones they did. Tests are excluded for the same reason: a mock
 * that deliberately contains a reentrancy is not a vulnerability report.
 */
export function classifySolidityPath(path: string): { audit: boolean; reason?: string } {
    const lower = path.toLowerCase();

    if (!lower.endsWith('.sol')) return { audit: false, reason: 'not Solidity' };

    for (const dir of EXCLUDED_DIRS) {
        if (lower === dir || lower.startsWith(`${dir}/`) || lower.includes(`/${dir}/`)) {
            return { audit: false, reason: `dependency or build output (${dir})` };
        }
    }

    if (/(^|\/)(test|tests|mocks?|script|scripts)\//.test(lower)) {
        return { audit: false, reason: 'test or script' };
    }
    if (/\.(t|test|s|spec)\.sol$/.test(lower)) {
        return { audit: false, reason: 'test or script' };
    }

    return { audit: true };
}

/** Source that declares no contract worth compiling on its own. */
export function isInterfaceOnly(source: string): boolean {
    const withoutComments = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');

    // `abstract contract` contains the word `contract`, so it has to be taken
    // out of the text before asking whether a concrete contract is declared.
    // An abstract contract cannot be deployed and is therefore nothing to
    // audit on its own, the same as an interface.
    const concrete = withoutComments.replace(/\babstract\s+contract\b/g, 'abstract');

    const hasContract = /\bcontract\s+[A-Za-z_]/.test(concrete);
    const hasDeclaration = /\b(interface|library|abstract)\s+[A-Za-z_]/.test(concrete);

    return !hasContract && hasDeclaration;
}
