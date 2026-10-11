/**
 * A report as a Markdown document, for the Download button.
 *
 * Built from the same report object the page renders, and after redaction on
 * the server, so a download never contains more than the reader could already
 * see: a locked finding is written as locked, not recovered. Markdown because it
 * is the format a developer actually does something with (a pull request, an
 * issue, a doc in the repository), and it prints cleanly anywhere.
 *
 * Every read of section data is defensive. A stored report may predate a field,
 * and a download that throws on an old report is worse than one with a gap.
 */

import type { ChainFitReport } from '../chainfit/report';
import type { GasProfile } from '../gasProfiler';
import type { ParallelAnalysisResult } from '../parallel/analyzer';
import { optimizationPriorities } from '../parallel/graph';
import { SEVERITIES, type ContractReport, type Finding, type RepoReport, type Severity } from './types';
import { modelName } from './verification';

const SEVERITY_LABEL: Readonly<Record<Severity, string>> = {
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    info: 'Info',
};

function subjectOf(report: RepoReport): string {
    const origin = report.origin;
    if (origin.kind === 'github') return `${origin.owner}/${origin.repo}`;
    if (origin.kind === 'address') return origin.address;
    return report.contracts[0]?.name ?? 'Workspace';
}

/** Keeps table cells on one line and stops a pipe in the data breaking the table. */
function cell(text: string): string {
    return text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

/** Long dashes read as machine written; the product's copy does not use them. */
function plain(text: string): string {
    return text.replace(/\s*—\s*/g, ': ');
}

function gasText(gas: number | null): string {
    return gas === null ? 'unbounded' : gas.toLocaleString('en-US');
}

function findingBlock(finding: Finding): string {
    const lines = [`#### ${SEVERITY_LABEL[finding.severity]}: ${plain(finding.title)}`, ''];
    const where = finding.file === undefined ? null : `${finding.file}${finding.line === undefined ? '' : `:${finding.line}`}`;
    if (where !== null) lines.push(`Location: \`${where}\``, '');

    // A redacted finding keeps only its title and severity.
    if (finding.description === undefined && finding.fix === undefined) {
        lines.push('_Details are in the full report._', '');
        return lines.join('\n');
    }

    if (finding.description !== undefined) lines.push(plain(finding.description), '');
    if (finding.evidence !== undefined && finding.evidence.trim().length > 0) {
        lines.push('```solidity', finding.evidence.trimEnd(), '```', '');
    }
    if (finding.fix !== undefined) lines.push(`**Fix:** ${plain(finding.fix)}`, '');
    if (finding.patch !== undefined && finding.patch.trim().length > 0) {
        lines.push('```diff', finding.patch.trimEnd(), '```', '');
    }
    return lines.join('\n');
}

function parallelBlock(data: ParallelAnalysisResult): string[] {
    const lines = ['### Parallel execution on Monad', ''];
    if (typeof data.headline === 'string' && data.headline.length > 0) lines.push(plain(data.headline), '');
    if (typeof data.score === 'number') lines.push(`- Parallel score: ${Math.round(data.score)}${typeof data.grade === 'string' ? ` (${data.grade})` : ''}`);
    if (typeof data.totalFunctions === 'number') {
        lines.push(`- Functions that can run together: ${data.parallelizableFunctions ?? 0} of ${data.totalFunctions}`);
    }
    const hotspots = Array.isArray(data.hotspots) ? data.hotspots : [];
    if (hotspots.length > 0) lines.push(`- Contended storage: ${hotspots.map((hotspot) => `\`${hotspot.variable}\``).join(', ')}`);
    lines.push('');

    let priorities: string[] = [];
    try {
        priorities = optimizationPriorities(data);
    } catch {
        priorities = [];
    }
    if (priorities.length > 0) {
        lines.push('Fix first:', '', ...priorities.map((priority, index) => `${index + 1}. ${plain(priority)}`), '');
    }
    return lines;
}

function gasBlock(data: GasProfile): string[] {
    const lines = ['### Gas', ''];
    const deploy = data.deployment?.totalCost;
    if (typeof deploy === 'number') lines.push(`- Deploy: ${gasText(deploy)} gas`);
    if (typeof data.contractSizeBytes === 'number') {
        lines.push(`- Runtime size: ${data.contractSizeBytes.toLocaleString('en-US')} bytes of ${(data.contractSizeLimitBytes ?? 24576).toLocaleString('en-US')}`);
    }
    lines.push('');

    const functions = Array.isArray(data.functions) ? data.functions : [];
    if (functions.length > 0) {
        lines.push('| Function | Gas |', '| --- | ---: |');
        for (const fn of functions) lines.push(`| \`${cell(fn.signature ?? fn.name)}\` | ${gasText(fn.gas)} |`);
        lines.push('');
    }
    return lines;
}

function chainFitBlock(data: ChainFitReport): string[] {
    const chains = Array.isArray(data.chains) ? data.chains : [];
    if (chains.length === 0) return [];
    const lines = ['### Deploy cost by chain', '', '| Chain | Cost (USD) |', '| --- | ---: |'];
    for (const chain of chains) {
        const usd = data.deployment?.cost?.[chain.id]?.usd;
        lines.push(`| ${cell(chain.shortName)} | ${typeof usd === 'number' ? `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}` : 'n/a'} |`);
    }
    lines.push('');
    const blocked = Array.isArray(data.deployment?.blockedOn) ? data.deployment.blockedOn : [];
    if (blocked.length > 0) lines.push(`Too large to deploy on ${blocked.join(', ')}.`, '');
    return lines;
}

function contractBlock(contract: ContractReport): string[] {
    const lines = [`## ${contract.name}`, '', `\`${contract.path}\``, ''];
    if (contract.health !== null) lines.push(`**Score: ${contract.health.score} / 100 (${contract.health.grade})**`, '');
    if (contract.purpose !== undefined) lines.push(plain(contract.purpose), '');
    if (contract.verification !== undefined) {
        const { model, upheld, rejected } = contract.verification;
        lines.push(`Findings cross-examined by ${modelName(model)}: ${upheld} upheld, ${rejected} rejected.`, '');
    }

    const findings = [...contract.findings].sort(
        (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity),
    );
    lines.push(`### Findings (${findings.length})`, '');
    if (findings.length === 0) lines.push('No findings.', '');
    for (const finding of findings) lines.push(findingBlock(finding));

    const sections = contract.sections;
    if (sections.parallel?.status === 'ok' && sections.parallel.data !== undefined) lines.push(...parallelBlock(sections.parallel.data));
    if (sections.gas?.status === 'ok' && sections.gas.data !== undefined) lines.push(...gasBlock(sections.gas.data));
    if (sections.chainfit?.status === 'ok' && sections.chainfit.data !== undefined) lines.push(...chainFitBlock(sections.chainfit.data));
    return lines;
}

export function reportToMarkdown(report: RepoReport, link: string | null = null): string {
    const lines = [`# Contract audit: ${subjectOf(report)}`, ''];
    lines.push(`Generated by Monsmith on ${report.createdAt.slice(0, 10)}.${link === null ? '' : ` Live report: ${link}`}`, '');

    if (report.health !== null) lines.push(`**Overall score: ${report.health.score} / 100 (${report.health.grade})**`, '');
    lines.push(
        '| Critical | High | Medium | Low | Info |',
        '| ---: | ---: | ---: | ---: | ---: |',
        `| ${report.counts.critical} | ${report.counts.high} | ${report.counts.medium} | ${report.counts.low} | ${report.counts.info} |`,
        '',
    );
    if (report.redacted) {
        lines.push('> This is the free view. Locked findings show their title and severity only; unlock the report for every detail.', '');
    }

    for (const contract of report.contracts) lines.push(...contractBlock(contract));

    if (report.notes.length > 0) lines.push('## Notes', '', ...report.notes.map((note) => `- ${plain(note)}`), '');
    lines.push(
        '---',
        '',
        'An audit is not a guarantee. This report comes from static analysis, a local EVM run and a language model working to a threat model. Treat it as a first pass that tells you where to look.',
        '',
    );
    return lines.join('\n');
}

/** A file name that survives every filesystem. */
export function reportFileName(report: RepoReport, extension: string): string {
    const slug = subjectOf(report)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60);
    return `monsmith-${slug || 'report'}-${report.createdAt.slice(0, 10)}.${extension}`;
}
