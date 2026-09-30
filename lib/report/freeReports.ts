/**
 * The free allowance: how many reports someone gets before being asked to pay.
 *
 * Counted by creation order. An owner's earliest reports are the free ones and
 * stay free, so a report someone shared never locks itself later because they ran
 * more. Two, so a person sees the product work on something of their own and on a
 * second contract before any money is involved.
 *
 * REPORTS_FREE overrides it. Zero is allowed (charge from the first report); a
 * value that is not a whole number falls back to the default rather than
 * accidentally giving everything away or locking everything, and the ceiling
 * keeps a typo from turning the paywall off in all but name.
 */

const DEFAULT_FREE = 2;
const MAX_FREE = 50;

export function freeReportAllowance(raw: string | undefined): number {
    if (raw === undefined || raw.trim().length === 0) return DEFAULT_FREE;
    if (!/^\d+$/.test(raw.trim())) return DEFAULT_FREE;
    return Math.min(Number(raw.trim()), MAX_FREE);
}

export const FREE_REPORTS: number = freeReportAllowance(process.env.REPORTS_FREE);

/**
 * The allowance a given owner gets. Free reports need an account.
 *
 * A signed-out visitor is known only by an id their browser stores, and clearing
 * site data mints a new one, so a browser-scoped allowance is an unlimited one.
 * An account is the cheapest identity that costs something to replace. Signed-out
 * visitors still run reports; they see the summary and are asked to sign in.
 */
export function freeAllowanceFor(owner: { userId: string | null; visitorId: string | null }): number {
    return owner.userId === null ? 0 : FREE_REPORTS;
}

/** True when `reportId` is among the owner's first `allowance` reports, oldest first. */
export function isFreeReport(reportId: string, earliestFirst: readonly string[], allowance: number = FREE_REPORTS): boolean {
    return earliestFirst.slice(0, allowance).includes(reportId);
}
