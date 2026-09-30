/**
 * The offer, in words, for the parts of the interface that state it.
 *
 * Pure so it can be tested and shared between the server, which knows the
 * facts, and the pages that print them. Every sentence here is conditional on a
 * fact the server reported: no price when Dodo could not be read, no mention of
 * paying at all when the paywall is off, so the page can never promise a charge
 * that will not happen or quote a number checkout will not honour.
 */

export interface Price {
    /** Minor units, e.g. cents. */
    amount: number;
    currency: string;
}

export interface Plan {
    /** Whether reports past the free allowance are charged for at all. */
    paywall: boolean;
    /** Full reports a signed-in account gets before paying. */
    freeReports: number;
    /** What one report costs by card, when it is known. */
    price: Price | null;
}

export function formatPrice(price: Price): string {
    try {
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: price.currency,
            // Whole amounts print as "$10", not "$10.00".
            minimumFractionDigits: price.amount % 100 === 0 ? 0 : 2,
        }).format(price.amount / 100);
    } catch {
        // An unknown currency code is still better shown than hidden.
        return `${(price.amount / 100).toFixed(2)} ${price.currency}`;
    }
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** "two full reports", "one full report", "12 full reports". */
export function freeReportsPhrase(count: number): string {
    const word = count < NUMBER_WORDS.length ? NUMBER_WORDS[count] : String(count);
    return `${word} full ${count === 1 ? "report" : "reports"}`;
}

/** The one-line offer, or null when there is nothing to say. */
export function offerHeadline(plan: Plan): string | null {
    if (!plan.paywall) return "Every report is free while Monsmith is in beta.";
    if (plan.freeReports === 0) {
        return plan.price === null ? null : `${formatPrice(plan.price)} per report.`;
    }
    const free = freeReportsPhrase(plan.freeReports);
    const capitalised = free.charAt(0).toUpperCase() + free.slice(1);
    return plan.price === null
        ? `${capitalised} free with an account.`
        : `${capitalised} free with an account. Then ${formatPrice(plan.price)} per report.`;
}
