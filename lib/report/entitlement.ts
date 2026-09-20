import 'server-only';

import { neon } from '@neondatabase/serverless';
import { formatEther, isAddress } from 'viem';

import { getApiViewer } from '../auth/server';
import { isUnlocked, type ReportOwner } from './store';

/**
 * Who is asking for a report, and whether they may see all of it.
 *
 * This module answers exactly one question and answers it on the server:
 * `entitled`. `redactReport` turns that boolean into a payload, `isUnlocked`
 * decides it against the database, and nothing here is allowed to widen it.
 * The reason a separate module exists at all is that two routes need the same
 * answer and they must not be able to drift: a read path that resolves
 * entitlement differently from the pay path is how a report becomes free by
 * accident.
 */

// ============= PRICE AND PAYEE =============

/**
 * What unlocking a report costs, and who gets paid for it.
 *
 * Both are read from the server environment at module load and both are
 * deliberately unreachable from the request. This is the whole security
 * property of the q402 rail: the witness a wallet signs travels inside the
 * request, so the terms it carries are the caller's claim about what they
 * agreed to pay, not a fact. A caller who can name the amount names 1 wei, and
 * a caller who can name the recipient names themselves and unlocks the report
 * with a signature that verifies perfectly. Verification is therefore always
 * checked against these constants and never against the copy of the terms that
 * arrived with the payload.
 *
 * A malformed override falls back to the default rather than throwing. A typo
 * in an environment variable must not take the read path down with it, and the
 * fallback direction is the safe one: payment goes to the address the product
 * already uses rather than to whatever a bad value happened to parse as.
 */
const DEFAULT_PRICE_WEI = '50000000000000000'; // 0.05 MON
const DEFAULT_PAYEE = '0x9dF95D6b0Fa0F09C6a90B60D1B7F79167195EDB1';

/** Monad testnet and mainnet share an id until mainnet launches. */
export const MONAD_CHAIN_ID = 10143;

function priceFromEnv(): string {
    const raw = process.env.REPORT_PRICE_WEI;
    if (raw === undefined || raw.length === 0) return DEFAULT_PRICE_WEI;

    if (!/^[1-9][0-9]*$/.test(raw)) {
        console.error(
            `REPORT_PRICE_WEI is not a positive integer ("${raw}"). Falling back to ${DEFAULT_PRICE_WEI} wei.`,
        );
        return DEFAULT_PRICE_WEI;
    }
    return raw;
}

function payeeFromEnv(): string {
    const raw = process.env.REPORT_PAYEE;
    if (raw === undefined || raw.length === 0) return DEFAULT_PAYEE;

    if (!isAddress(raw)) {
        console.error(
            `REPORT_PAYEE is not a valid address ("${raw}"). Falling back to ${DEFAULT_PAYEE}.`,
        );
        return DEFAULT_PAYEE;
    }
    return raw;
}

export const REPORT_PRICE_WEI: string = priceFromEnv();
export const REPORT_PAYEE: string = payeeFromEnv();

/** The same price as MON, for display. Derived so the two cannot disagree. */
export const REPORT_PRICE_MON: string = formatEther(BigInt(REPORT_PRICE_WEI));

// ============= OWNERSHIP =============

/**
 * The browser-scoped id an anonymous visitor carries.
 *
 * Signed-out people are real users of this product, so a report has to belong
 * to someone before anyone signs in. The id is the same random localStorage
 * value `lib/track.ts` mints for analytics, offered on a header and falling
 * back to a cookie so a plain navigation still carries an owner. It is
 * client-supplied and therefore only ever an identity of convenience: it
 * decides which anonymous session sees its own first free report, never
 * whether money changed hands. That one is the `report_unlocks` row.
 */
const VISITOR_HEADER = 'x-visitor-id';
const VISITOR_COOKIE = 'monsmith.visitor';
const VISITOR_ID_MAX = 100;

function visitorFromCookie(header: string | null): string | null {
    if (header === null) return null;

    for (const pair of header.split(';')) {
        const separator = pair.indexOf('=');
        if (separator === -1) continue;
        if (pair.slice(0, separator).trim() !== VISITOR_COOKIE) continue;

        try {
            const value = decodeURIComponent(pair.slice(separator + 1).trim());
            return value.length > 0 ? value.slice(0, VISITOR_ID_MAX) : null;
        } catch {
            // A cookie that is not valid percent-encoding is not our cookie.
            return null;
        }
    }
    return null;
}

function visitorFromRequest(req: Request): string | null {
    const header = req.headers.get(VISITOR_HEADER);
    if (header !== null && header.length > 0) return header.slice(0, VISITOR_ID_MAX);
    return visitorFromCookie(req.headers.get('cookie'));
}

export async function resolveOwner(req: Request): Promise<ReportOwner> {
    const viewer = await getApiViewer();
    return { userId: viewer.userId, visitorId: visitorFromRequest(req) };
}

// ============= ENTITLEMENT =============

/**
 * Why a viewer sees what they see.
 *
 * Carried alongside the boolean so the interface can tell the truth. Someone on
 * their first free report should read "this one is on us" rather than a price
 * they are not being asked to pay, and a paying tier should not be shown an
 * unlock button at all. None of these change what is served; they change what
 * is said about it.
 */
export type EntitlementReason = 'tier' | 'paid' | 'first-free' | 'none';

export interface Entitlement {
    entitled: boolean;
    owner: ReportOwner;
    unlimited: boolean;
    reason: EntitlementReason;
}

/**
 * Whether an unlock row exists, for labelling only.
 *
 * `isUnlocked` collapses three routes to entitlement into one boolean, which is
 * correct for the decision and useless for the copy. This read separates the
 * last two. It is deliberately not part of the decision: if the query fails the
 * viewer stays entitled and is labelled `paid`, because the conservative label
 * is the one that never claims a report was free when it was not.
 */
async function unlockRowExists(reportId: string): Promise<boolean | null> {
    const url = process.env.DATABASE_URL;
    if (url === undefined || url.length === 0) return false;

    try {
        const sql = neon(url);
        const rows = (await sql`
            SELECT 1 FROM report_unlocks WHERE report_id = ${reportId}
        `) as unknown[];
        return rows.length > 0;
    } catch (error) {
        console.error('Report entitlement: could not read report_unlocks for labelling:', error);
        return null;
    }
}

/**
 * Whether reports are sold at all.
 *
 * The half-report split is built, tested and dormant. Charging for a report is
 * a commercial decision rather than a technical one, and it is not being made
 * yet, so the whole mechanism sits behind one environment variable that
 * defaults to off. Off means every report comes back whole.
 *
 * It is a single flag read in a single place on purpose. The alternative, which
 * is to comment out the paywall or to have the client skip the unlock panel,
 * leaves the redaction path unexercised and quietly rotting until the day
 * somebody switches it on and finds it broken. This way the code that decides
 * what a free viewer sees keeps its tests and keeps working; it is only ever
 * asked a question whose answer is currently always yes.
 */
export function paywallEnabled(): boolean {
    return process.env.REPORTS_PAYWALL === 'on';
}

export async function entitlementFor(reportId: string, req: Request): Promise<Entitlement> {
    const viewer = await getApiViewer();

    if (!paywallEnabled()) {
        return {
            entitled: true,
            owner: await resolveOwner(req),
            unlimited: true,
            reason: 'tier',
        };
    }

    const unlimited = viewer.permissions.includes('analysis.unlimited');
    const owner = await resolveOwner(req);

    const entitled = await isUnlocked(reportId, owner, unlimited);
    if (!entitled) return { entitled: false, owner, unlimited, reason: 'none' };

    // Checked before the database read because a paying tier never produces an
    // unlock row and asking for one would be a query with a known answer.
    if (unlimited) return { entitled: true, owner, unlimited, reason: 'tier' };

    const paid = await unlockRowExists(reportId);
    return { entitled: true, owner, unlimited, reason: paid === false ? 'first-free' : 'paid' };
}
