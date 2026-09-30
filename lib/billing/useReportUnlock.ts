'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth, useClerk } from '@clerk/nextjs';

import type { RepoReport } from '@/lib/report/types';
import { visitorId } from '@/lib/visitor';
import type { Price } from './offer';

/**
 * What a locked report costs this viewer, and the one next step that opens it.
 *
 * Shared by the studio's rail and the standalone report page so both make the
 * same decision in the same order:
 *
 * 1. Signed out with free reports on offer: sign in. It costs nothing, and the
 *    report being looked at is adopted by the account, so if it is within the
 *    allowance it opens without paying.
 * 2. Otherwise, a card through Dodo's hosted checkout when a price is set.
 * 3. MON as the alternative, where the page has a wallet to pay with.
 *
 * The offer is read from the server rather than worked out here, because only
 * the server knows whose report this is and how much of the allowance is left.
 */

export interface ReportOffer {
    locked: boolean;
    signInForFree: boolean;
    freeReports: number;
    card: Price | null;
    /** The MON price, formatted, when the MON rail is on offer. */
    mon: string | null;
}

interface OfferResponse {
    report?: RepoReport;
    locked?: boolean;
    signInForFree?: boolean;
    freeReports?: number;
    price?: { mon?: string; card?: Price | null } | null;
}

function toOffer(data: OfferResponse): ReportOffer {
    return {
        locked: data.locked === true,
        signInForFree: data.signInForFree === true,
        freeReports: typeof data.freeReports === 'number' ? data.freeReports : 0,
        card: data.price?.card ?? null,
        mon: typeof data.price?.mon === 'string' ? data.price.mon : null,
    };
}

export interface ReportUnlock {
    offer: ReportOffer | null;
    /** The primary action: sign in, or pay by card, or fall back to MON. */
    unlock: () => void;
    busy: boolean;
    error: string | null;
}

export function useReportUnlock({
    report,
    onReplace,
    payMon,
}: {
    /** The report on screen, or null while there is none. */
    report: RepoReport | null;
    /** Swaps in the full report once the viewer is entitled to it. */
    onReplace: (report: RepoReport) => void;
    /** The MON rail, where the page has one. */
    payMon?: () => void;
}): ReportUnlock {
    const { userId, isLoaded } = useAuth();
    const clerk = useClerk();
    // Keyed by report so a new report never shows the previous one's offer.
    const [fetched, setFetched] = useState<{ reportId: string; offer: ReportOffer | null } | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const reportId = report?.reportId ?? null;
    const redacted = report?.redacted === true;
    const offer = redacted && fetched !== null && fetched.reportId === reportId ? fetched.offer : null;

    // Held in a ref so a parent that passes a fresh callback every render does
    // not refetch the offer every render.
    const replaceRef = useRef(onReplace);
    useEffect(() => {
        replaceRef.current = onReplace;
    }, [onReplace]);

    /*
      Refetched when the viewer signs in, which is the moment the answer
      changes: the account adopts this browser's reports, and a report inside
      the free allowance comes back whole. Swapping it in here is what makes
      "sign in to see it free" true without a page reload.
    */
    useEffect(() => {
        if (reportId === null || !redacted || !isLoaded) return;
        const controller = new AbortController();
        fetch(`/api/report/${reportId}`, {
            headers: { 'x-visitor-id': visitorId() },
            signal: controller.signal,
        })
            .then(async (response) => {
                const data = (await response.json()) as OfferResponse;
                if (!response.ok) throw new Error(`Offer request failed with ${response.status}`);
                if (data.locked === false && data.report !== undefined) {
                    replaceRef.current(data.report);
                    setFetched({ reportId, offer: null });
                    return;
                }
                setFetched({ reportId, offer: toOffer(data) });
            })
            .catch((failure: unknown) => {
                if (failure instanceof DOMException && failure.name === 'AbortError') return;
                console.error('Could not read the report offer:', failure);
            });
        return () => controller.abort();
    }, [reportId, redacted, userId, isLoaded]);

    const payCard = useCallback(async () => {
        if (reportId === null) return;
        setBusy(true);
        setError(null);
        try {
            const response = await fetch(`/api/report/${reportId}/checkout`, {
                method: 'POST',
                headers: { 'x-visitor-id': visitorId() },
            });
            const data = (await response.json()) as {
                success?: boolean;
                checkoutUrl?: string;
                alreadyUnlocked?: boolean;
                error?: string;
            };
            if (data.alreadyUnlocked === true) {
                // Entitled after all, for instance a payment that landed in
                // another tab. Reading the report again picks it up.
                const fresh = await fetch(`/api/report/${reportId}`, { headers: { 'x-visitor-id': visitorId() } });
                const body = (await fresh.json()) as OfferResponse;
                if (body.report !== undefined) replaceRef.current(body.report);
                setBusy(false);
                return;
            }
            if (!response.ok || typeof data.checkoutUrl !== 'string') {
                setError(data.error ?? 'The payment page could not be opened.');
                setBusy(false);
                return;
            }
            // Busy stays on: the page is leaving for the checkout.
            window.location.assign(data.checkoutUrl);
        } catch {
            setError('Could not reach the payment page. Check your connection and try again.');
            setBusy(false);
        }
    }, [reportId]);

    const unlock = useCallback(() => {
        // The panel holds its button until the offer arrives, so this is only
        // reachable from a locked finding clicked in that first moment.
        if (offer === null) return;
        if (offer.signInForFree) {
            clerk.openSignIn();
            return;
        }
        if (offer.card !== null) {
            void payCard();
            return;
        }
        if (payMon !== undefined) {
            payMon();
            return;
        }
        setError('Payments are not available right now.');
    }, [offer, clerk, payCard, payMon]);

    return { offer, unlock, busy, error };
}
