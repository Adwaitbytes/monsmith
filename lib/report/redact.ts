/**
 * The free half of a report.
 *
 * This is the only place that decides what an unentitled viewer sees, and it
 * runs on the server before the report is serialised. That matters more than it
 * might look: the audience for this product opens dev tools by reflex, and a
 * paywall implemented as a blur over data already sent to the browser is not a
 * paywall, it is a rumour. Nothing paid may leave the server unredacted.
 *
 * The free half is built to be *provable* rather than teasing. Real counts, real
 * severities, real scores, and the two least severe findings in full. A reader
 * can verify that the thing we are charging for exists before paying for it, and
 * we never invent a finding to make the locked section look fuller.
 */

import {
    countBySeverity,
    SEVERITIES,
    type ContractReport,
    type Finding,
    type RepoReport,
    type Section,
} from './types';

/** Findings shown in full to a viewer who has not unlocked the report. */
const FREE_FINDINGS_PER_CONTRACT = 2;

/**
 * Strips a finding to what a free viewer may see.
 *
 * Title and severity survive: knowing that a critical issue exists, and roughly
 * what it is called, is the honest sales pitch. Everything that tells you where
 * it is or how to repair it is the product.
 */
function teaseFinding(finding: Finding): Finding {
    return {
        id: finding.id,
        severity: finding.severity,
        title: finding.title,
        source: finding.source,
        // `file`, `line`, `description`, `evidence`, `fix` and `patch` are
        // deliberately absent rather than emptied, so a bug that forgets to
        // check `redacted` fails loudly instead of rendering blanks.
    };
}

/**
 * The free findings, chosen from the least severe end.
 *
 * Giving away the two mildest findings rather than the worst is the point: it
 * demonstrates the depth of the analysis without handing over the part someone
 * would actually pay for. Ordering is worst-first everywhere else, so this
 * reads from the back.
 */
function freeFindings(findings: readonly Finding[]): Finding[] {
    const byseverity = [...findings].sort(
        (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity),
    );
    const free = new Set(
        byseverity.slice(-FREE_FINDINGS_PER_CONTRACT).map((finding) => finding.id),
    );

    // Preserve the original worst-first order in the output, so the locked and
    // unlocked reports read identically apart from what is filled in.
    return findings.map((finding) => (free.has(finding.id) ? finding : teaseFinding(finding)));
}

/**
 * Sections collapse to their status and headline number.
 *
 * A section's `data` is the analysis itself, so none of it survives. The status
 * does, because "we could not measure gas on this contract" is something a free
 * viewer is entitled to know before deciding whether the paid report is worth
 * buying.
 */
function teaseSection<T>(section: Section<T>): Section<never> {
    if (section.status === 'ok') {
        return { status: 'ok', data: undefined as never, durationMs: section.durationMs };
    }
    return section;
}

function redactContract(contract: ContractReport): ContractReport {
    return {
        id: contract.id,
        path: contract.path,
        name: contract.name,
        // Free. Stating what the audit understood the contract to do is how a
        // reader judges whether the findings rest on a correct reading, and it
        // is the most honest demonstration that the analysis is real.
        ...(contract.purpose !== undefined ? { purpose: contract.purpose } : {}),
        // Free for the same reason the purpose is. What was looked for is the
        // honest demonstration of depth; what was found is the product.
        ...(contract.threats !== undefined ? { threats: contract.threats } : {}),
        health: contract.health,
        // Counts come from the *unredacted* findings, so they stay true.
        counts: countBySeverity(contract.findings),
        findings: freeFindings(contract.findings),
        sections: {
            security: teaseSection(contract.sections.security),
            parallel: teaseSection(contract.sections.parallel),
            gas: teaseSection(contract.sections.gas),
            chainfit: teaseSection(contract.sections.chainfit),
        },
    };
}

/**
 * Returns the report as the given viewer may see it.
 *
 * `entitled` is resolved by the caller from payment or tier. This function does
 * not know how someone became entitled and must not: one boolean, one decision,
 * one place to audit.
 */
export function redactReport(report: RepoReport, entitled: boolean): RepoReport {
    if (entitled) return { ...report, redacted: false };

    return {
        ...report,
        contracts: report.contracts.map(redactContract),
        redacted: true,
    };
}

/**
 * What unlocking would add, for the upsell copy.
 *
 * Derived from the real report rather than written as marketing, so the promise
 * cannot drift from what the paid report actually contains.
 */
export interface LockedSummary {
    lockedFindings: number;
    contractsMeasured: number;
    hasPatches: boolean;
    hasChainFit: boolean;
}

export function summariseLocked(report: RepoReport): LockedSummary {
    let lockedFindings = 0;
    let hasPatches = false;
    let hasChainFit = false;
    let contractsMeasured = 0;

    for (const contract of report.contracts) {
        const free = Math.min(FREE_FINDINGS_PER_CONTRACT, contract.findings.length);
        lockedFindings += Math.max(0, contract.findings.length - free);
        if (contract.findings.some((finding) => finding.patch !== undefined)) hasPatches = true;
        if (contract.sections.chainfit.status === 'ok') hasChainFit = true;
        if (contract.health !== null) contractsMeasured += 1;
    }

    return { lockedFindings, contractsMeasured, hasPatches, hasChainFit };
}
