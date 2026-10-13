import 'server-only';

import type { Address, Hex } from 'viem';

import { attestationOfSource, attestConfig, EXPLORER, writeAttestation } from '../attest/chain';
import { reportHash, sourceHash } from '../attest/hash';
import { installationToken } from '../github/app';
import { classifySolidityPath } from '../github/source';
import { diffLines } from '../optimize/engine';
import { buildRepoReport } from '../report/build';
import type { FixReviewInput } from '../report/audit';
import { loadReport, recordAttestation, saveReport, unlockPullRequestReport } from '../report/store';
import { CONTRACTS_PER_RUN, type ContractReport, type RepoReport } from '../report/types';
import { siteUrl } from '../siteUrl';
import { checkSummary, renderComment, renderLimitComment, type CommentInput, type MergeOutcome } from './comment';
import { fileAt, finishCheck, importAt, listPullFiles, startCheck, upsertComment, type Repo } from './github';
import {
    attestationsOfPull,
    attestationsThisMonth,
    commentIdFor,
    latestHead,
    markClosed,
    notePullHead,
    recordPullAttestation,
    reviewsOf,
    reviewsThisMonth,
    saveCommentId,
    saveReview,
    type StoredReview,
} from './store';
import { annotationsFor, compareReviews, conclusionFor, trackedFindings, type PushDelta } from './tracking';
import type { WebhookEvent } from './webhook';

/**
 * Reviewing a pull request, end to end.
 *
 * One push becomes one report: the contracts the pull request changes are
 * audited with the same engine as a report run by hand, and the result goes
 * back to GitHub as one comment kept up to date and one check run with the
 * findings on their lines. A later push re-checks the earlier findings rather
 * than auditing from scratch, which is what makes "fixed" a measured word and
 * not two model runs that happened to disagree. A contract the push did not
 * touch is reused as it was. When the pull request merges, the reviewed code
 * is attested on Monad, but only if what merged is byte for byte what was
 * reviewed.
 */

type PullEvent = Extract<WebhookEvent, { kind: 'pull_request' }>;

/** Free reviews per installation per thirty days. Each one is a full audit of the changed contracts. */
function reviewLimit(): number {
    const value = Number(process.env.GITHUB_PR_REVIEWS_PER_MONTH);
    return Number.isInteger(value) && value > 0 ? value : 60;
}

/** Attestations Monsmith pays gas for, per installation per thirty days. */
function attestationLimit(): number {
    const value = Number(process.env.GITHUB_PR_ATTESTATIONS_PER_MONTH);
    return Number.isInteger(value) && value >= 0 ? value : 10;
}

/** Contracts attested per merge, the same bound a hand-published report has. */
const ATTESTATIONS_PER_MERGE = 3;

function repoOf(event: PullEvent): Repo {
    return { owner: event.repo.owner, name: event.repo.name };
}

function blobUrl(event: PullEvent, sha: string) {
    return (path: string, line: number | null): string =>
        `https://github.com/${event.repo.fullName}/blob/${sha}/${path.split('/').map(encodeURIComponent).join('/')}${line !== null ? `#L${line}` : ''}`;
}

async function tokenFor(installationId: number): Promise<string> {
    const token = await installationToken(installationId);
    if (token === null) throw new Error('The GitHub App is not configured on this deployment.');
    return token;
}

export async function handlePullRequest(event: PullEvent): Promise<void> {
    if (event.action === 'closed') {
        await handleClosed(event);
        return;
    }
    if (event.pull.draft) return;
    await reviewPush(event);
}

// ============= A PUSH =============

async function reviewPush(event: PullEvent): Promise<void> {
    const repo = repoOf(event);
    const { headSha, number } = event.pull;
    const token = await tokenFor(event.installationId);

    const { commentId } = await notePullHead({
        repoId: event.repo.id,
        number,
        installationId: event.installationId,
        repoFullName: event.repo.fullName,
        private: event.repo.private,
        title: event.pull.title,
        author: event.pull.author,
        headSha,
    });

    const changed = (await listPullFiles(token, repo, number)).filter(
        (file) => file.status !== 'removed' && file.path.toLowerCase().endsWith('.sol'),
    );
    // A pull request that touches no Solidity is none of this reviewer's business,
    // and saying so on every docs change is how a bot gets uninstalled.
    if (changed.length === 0) return;

    const notAudited: Array<{ path: string; reason: string }> = [];
    const candidates: string[] = [];
    for (const file of changed) {
        const verdict = classifySolidityPath(file.path);
        if (verdict.audit) candidates.push(file.path);
        else notAudited.push({ path: file.path, reason: verdict.reason ?? 'excluded' });
    }
    if (candidates.length === 0) return;

    const site = siteUrl();
    const checkId = await startCheck(token, repo, headSha, `${site}/github`);

    try {
        const limit = reviewLimit();
        if ((await reviewsThisMonth(event.installationId)) >= limit) {
            const id = await upsertComment(token, repo, number, renderLimitComment(site, limit), commentId);
            await saveCommentId(event.repo.id, number, id);
            await finishCheck(token, repo, checkId, { conclusion: 'neutral', title: 'Monthly review limit reached', summary: renderLimitComment(site, limit) });
            return;
        }

        const imported = await importAt(token, repo, headSha);
        const files = Object.fromEntries(imported.files.map((file) => [file.path, file.content]));
        for (const path of candidates) {
            if (files[path] === undefined) {
                const skipped = imported.skipped.find((entry) => entry.path === path);
                notAudited.push({ path, reason: skipped?.reason ?? 'could not be read' });
            }
        }
        const toAudit = candidates.filter((path) => files[path] !== undefined);

        const history = await reviewsOf(event.repo.id, number);
        const previous = history.at(-1) ?? null;
        const previousReport = previous === null ? null : (await loadReport(previous.reportId))?.report ?? null;
        const { reuse, fixReviews } = await carryForward(token, repo, previous, previousReport, files, toAudit);

        let report: RepoReport | null = null;
        for await (const step of buildRepoReport({
            files,
            origin: { kind: 'github', owner: event.repo.owner, repo: event.repo.name, ref: headSha, private: event.repo.private },
            cap: CONTRACTS_PER_RUN,
            only: toAudit,
            fixReviews,
            reuse,
        })) {
            if (step.type === 'complete') report = step.report;
            if (step.type === 'error') throw new Error(step.message);
        }
        if (report === null) throw new Error('The audit ended without a report.');

        if (report.contracts.length === 0) {
            await finishCheck(token, repo, checkId, {
                conclusion: 'neutral',
                title: 'Nothing to audit',
                summary: 'The Solidity this pull request changes is interfaces, libraries or abstract contracts only, so there is no deployable contract to audit.',
            });
            return;
        }

        await saveReport(report, { userId: null, visitorId: `github-app:${event.installationId}` });
        await unlockPullRequestReport(report.reportId);

        const tracked = trackedFindings(report);
        const delta = compareReviews(previous?.findings ?? null, tracked, new Set(report.contracts.map((contract) => contract.path)));
        const scores = scoresOf(report);
        await saveReview({
            repoId: event.repo.id,
            number,
            installationId: event.installationId,
            headSha,
            reportId: report.reportId,
            score: report.health?.score ?? null,
            scores,
            findings: tracked,
            fixed: delta.fixed,
            introduced: delta.introduced,
        });

        const reportUrl = `${site}/report/${report.reportId}`;
        const input: CommentInput = {
            report,
            reportUrl,
            headSha,
            blobUrl: blobUrl(event, headSha),
            delta,
            firstScores: history[0]?.scores ?? scores,
            fixedSoFar: history.reduce((sum, review) => sum + review.fixed.length, 0) + delta.fixed.length,
            notAudited,
            siteUrl: site,
        };

        // The check belongs to this commit whatever happens next, so it always finishes.
        const summary = checkSummary(input);
        await finishCheck(token, repo, checkId, {
            conclusion: conclusionFor(delta.open),
            title: summary.title,
            summary: summary.summary,
            detailsUrl: reportUrl,
            annotations: annotationsFor(report),
        });

        // The comment does not. A newer push started its own review while this
        // one ran, and an older review must never overwrite a newer one.
        if ((await latestHead(event.repo.id, number)) !== headSha) return;
        const id = await upsertComment(token, repo, number, renderComment(input), await commentIdFor(event.repo.id, number));
        await saveCommentId(event.repo.id, number, id);
    } catch (error) {
        console.error(`[pr-review] ${event.repo.fullName}#${number} at ${headSha} failed:`, error);
        await finishCheck(token, repo, checkId, {
            conclusion: 'neutral',
            title: 'Monsmith could not finish this review',
            summary: `The review stopped with: ${error instanceof Error ? error.message : String(error)}. Push again to retry.`,
        });
    }
}

function scoresOf(report: RepoReport): Record<string, number> {
    const scores: Record<string, number> = {};
    for (const contract of report.contracts) {
        if (contract.health !== null) scores[contract.path] = contract.health.score;
    }
    return scores;
}

/**
 * Decides, per contract, between reusing the last review, a fix review against
 * it, and a fresh audit.
 *
 * The fix review needs to know which lines the push changed, and the report
 * keeps only a hash of the source it audited, so the earlier version is read
 * back from GitHub at the earlier commit. When it cannot be read, every line
 * counts as changed: that costs precision about where a new finding sits, never
 * a missed one.
 */
async function carryForward(
    token: string,
    repo: Repo,
    previous: StoredReview | null,
    previousReport: RepoReport | null,
    files: Readonly<Record<string, string>>,
    paths: readonly string[],
): Promise<{ reuse: Record<string, ContractReport>; fixReviews: Record<string, FixReviewInput> }> {
    const reuse: Record<string, ContractReport> = {};
    const fixReviews: Record<string, FixReviewInput> = {};
    if (previous === null || previousReport === null) return { reuse, fixReviews };

    for (const path of paths) {
        const earlier = previousReport.contracts.find((contract) => contract.path === path);
        const source = files[path];
        if (earlier === undefined || source === undefined) continue;
        if (earlier.sourceHash === sourceHash(source)) {
            reuse[path] = earlier;
            continue;
        }
        const before = await fileAt(token, repo, path, previous.headSha).catch(() => null);
        const changedLines =
            before === null ? source.split('\n').map((_, index) => index + 1) : diffLines(before, source).changed;
        fixReviews[path] = {
            prior: earlier.findings.filter((finding) => finding.source === 'ai'),
            changedLines,
            ...(earlier.threats !== undefined ? { threats: earlier.threats } : {}),
            ...(earlier.invariants !== undefined ? { invariants: earlier.invariants } : {}),
        };
    }
    return { reuse, fixReviews };
}

// ============= A MERGE =============

async function handleClosed(event: PullEvent): Promise<void> {
    const repo = repoOf(event);
    const { number } = event.pull;
    await markClosed(event.repo.id, number, event.pull.merged, event.pull.mergeSha);
    if (!event.pull.merged || event.pull.mergeSha === null) return;

    const history = await reviewsOf(event.repo.id, number);
    const last = history.at(-1);
    if (last === undefined) return;
    const stored = await loadReport(last.reportId);
    if (stored === null) return;

    const token = await tokenFor(event.installationId);
    const merge = await attestMerge(token, repo, event, stored.report, event.pull.mergeSha);

    const delta: PushDelta = {
        firstReview: history.length === 1,
        fixed: last.fixed,
        introduced: last.introduced,
        open: last.findings,
    };
    const site = siteUrl();
    const body = renderComment({
        report: stored.report,
        reportUrl: `${site}/report/${last.reportId}`,
        headSha: last.headSha,
        blobUrl: blobUrl(event, last.headSha),
        delta,
        firstScores: history[0]?.scores ?? last.scores,
        fixedSoFar: history.reduce((sum, review) => sum + review.fixed.length, 0),
        notAudited: [],
        merge,
        siteUrl: site,
    });
    const id = await upsertComment(token, repo, number, body, await commentIdFor(event.repo.id, number));
    await saveCommentId(event.repo.id, number, id);
}

/**
 * Attests each reviewed contract whose merged source is exactly what was reviewed.
 *
 * The merge commit is read rather than trusted: a pull request can merge after
 * a push nobody reviewed, or onto a base that changed the same file, and an
 * attestation about code that is not the code on the branch would be the one
 * thing worse than no attestation.
 */
async function attestMerge(token: string, repo: Repo, event: PullEvent, report: RepoReport, mergeSha: string): Promise<MergeOutcome> {
    const outcome: MergeOutcome = { attested: [], notAttested: [] };
    const config = attestConfig();
    if (config === null) return outcome;

    const done = new Map((await attestationsOfPull(event.repo.id, event.pull.number)).map((entry) => [entry.path, entry.txHash]));
    let budget = Math.min(ATTESTATIONS_PER_MERGE, attestationLimit() - (await attestationsThisMonth(event.installationId)));
    const hash = reportHash(report);
    const uri = `${siteUrl()}/report/${report.reportId}`;

    for (const contract of report.contracts) {
        if (contract.health === null || contract.sourceHash === undefined) continue;
        const already = done.get(contract.path);
        if (already !== undefined) {
            outcome.attested.push({ path: contract.path, txUrl: `${EXPLORER}/tx/${already}` });
            continue;
        }
        const merged = await fileAt(token, repo, contract.path, mergeSha).catch(() => null);
        if (merged === null || sourceHash(merged) !== contract.sourceHash) {
            outcome.notAttested.push({ path: contract.path, reason: 'the merged code is not the code that was reviewed. Push it to a pull request to review it first' });
            continue;
        }
        try {
            if ((await attestationOfSource(config, contract.sourceHash as Hex)) !== null) {
                outcome.notAttested.push({ path: contract.path, reason: 'this exact source was already attested by an earlier review' });
                continue;
            }
            if (budget <= 0) {
                outcome.notAttested.push({ path: contract.path, reason: 'this installation has used its free attestations for the month' });
                continue;
            }
            const tx = await writeAttestation(config, {
                sourceHash: contract.sourceHash as Hex,
                chainId: 0,
                target: '0x0000000000000000000000000000000000000000' as Address,
                score: contract.health.score,
                critical: contract.counts.critical,
                high: contract.counts.high,
                medium: contract.counts.medium,
                low: contract.counts.low,
                reportHash: hash,
                reportURI: uri,
            });
            budget -= 1;
            await recordPullAttestation(event.repo.id, event.pull.number, event.installationId, contract.path, contract.sourceHash, tx);
            await recordAttestation(report.reportId, contract.path, contract.sourceHash, tx);
            outcome.attested.push({ path: contract.path, txUrl: `${EXPLORER}/tx/${tx}` });
        } catch (error) {
            console.error(`[pr-review] attesting ${contract.path} for ${event.repo.fullName}#${event.pull.number} failed:`, error);
            outcome.notAttested.push({ path: contract.path, reason: 'the attestation transaction failed' });
        }
    }
    return outcome;
}
