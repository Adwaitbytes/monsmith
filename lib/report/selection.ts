/**
 * Which files in a workspace can be audited, for the contract chooser.
 *
 * Built on the same rules the server applies when it plans a report, from
 * `lib/github/source`, so the list a person picks from is exactly the list the
 * server would accept: tests, scripts, vendored dependencies, interface-only
 * files and files too large to compile in time are left out here for the same
 * reasons they are skipped there.
 */

import { classifySolidityPath, isInterfaceOnly, MAX_FILE_BYTES } from '../github/source';
import { CONTRACTS_PER_RUN } from './types';

export interface AuditCandidate {
    path: string;
    /** The main contract the file declares, or the file name when it declares none by name. */
    name: string;
    lines: number;
}

function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** The last concrete contract a file declares, which by convention is its main one. */
function mainContract(source: string): string | null {
    const names = [...withoutComments(source).matchAll(/^\s*contract\s+([A-Za-z_]\w*)/gm)].map((match) => match[1]);
    return names[names.length - 1] ?? null;
}

export function auditCandidates(files: Readonly<Record<string, string>>): AuditCandidate[] {
    const candidates: AuditCandidate[] = [];
    for (const [path, source] of Object.entries(files)) {
        if (!path.toLowerCase().endsWith('.sol')) continue;
        if (!classifySolidityPath(path).audit) continue;
        if (isInterfaceOnly(source)) continue;
        const name = mainContract(source);
        if (name === null) continue;
        if (new TextEncoder().encode(source).length > MAX_FILE_BYTES) continue;
        candidates.push({ path, name, lines: source.split('\n').length });
    }
    return candidates.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * What the chooser starts with ticked.
 *
 * The open file alone when it can be audited: it is almost always the one the
 * person means, and each extra contract adds most of a minute. Without one,
 * everything up to the per-run cap. "All" is one click either way.
 */
export function defaultSelection(candidates: readonly AuditCandidate[], activePath: string | null, cap = CONTRACTS_PER_RUN): string[] {
    const paths = candidates.map((candidate) => candidate.path);
    if (activePath !== null && paths.includes(activePath)) return [activePath];
    return paths.slice(0, cap);
}

/** Rough wall clock for a report over `count` contracts, for the button that starts it. */
export function estimateSeconds(count: number): number {
    // Measured: about fifty seconds for one contract, most of it the audit,
    // which the server runs one contract after another.
    return count <= 0 ? 0 : 50 + (count - 1) * 40;
}
