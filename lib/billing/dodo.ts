import "server-only";

import DodoPayments from "dodopayments";

/**
 * The Dodo Payments connection, read from the server environment.
 *
 * Card payments are one of two ways to unlock a report (the other is MON over
 * q402), so an unconfigured deployment is normal rather than broken: it simply
 * offers no card checkout. Every setting is read here and nowhere else, and none
 * of them can come from a request. In particular the product, and therefore the
 * price, is fixed by the server: a caller who could name the product would name
 * a cheaper one.
 *
 * DODO_PAYMENTS_API_KEY         secret key from the Dodo dashboard
 * DODO_PAYMENTS_WEBHOOK_KEY     `whsec_...` signing secret of the webhook endpoint
 * DODO_PAYMENTS_ENVIRONMENT     `test_mode` (default) or `live_mode`
 * DODO_REPORT_PRODUCT_ID        the one-time product that unlocks one report
 */

export type DodoEnvironment = "test_mode" | "live_mode";

export interface DodoConfig {
    apiKey: string;
    webhookKey: string | null;
    environment: DodoEnvironment;
    productId: string;
}

function read(name: string): string | null {
    const value = process.env[name];
    return value === undefined || value.trim().length === 0 ? null : value.trim();
}

/**
 * The configuration, or null when card checkout is not set up.
 *
 * Test mode is the default on purpose: a deployment that forgets to name its
 * environment must not start taking real money.
 */
export function dodoConfig(): DodoConfig | null {
    const apiKey = read("DODO_PAYMENTS_API_KEY");
    const productId = read("DODO_REPORT_PRODUCT_ID");
    if (apiKey === null || productId === null) return null;

    const environment: DodoEnvironment = read("DODO_PAYMENTS_ENVIRONMENT") === "live_mode" ? "live_mode" : "test_mode";
    return { apiKey, webhookKey: read("DODO_PAYMENTS_WEBHOOK_KEY"), environment, productId };
}

let cached: { key: string; client: DodoPayments } | null = null;

export function dodoClient(config: DodoConfig): DodoPayments {
    const key = `${config.environment}:${config.apiKey}`;
    if (cached?.key !== key) {
        cached = {
            key,
            client: new DodoPayments({
                bearerToken: config.apiKey,
                environment: config.environment,
                // A checkout request is on a person's click; they should hear back fast.
                timeout: 15_000,
                maxRetries: 2,
            }),
        };
    }
    return cached.client;
}

export interface ReportPrice {
    /** Minor units, e.g. cents. */
    amount: number;
    currency: string;
}

let priceCache: { productId: string; price: ReportPrice | null; at: number } | null = null;
const PRICE_TTL_MS = 10 * 60 * 1000;

/**
 * What the report product costs, from Dodo, for display.
 *
 * Read from the product rather than duplicated in an environment variable so the
 * price shown can never disagree with the price charged: Dodo's checkout is the
 * authority, this is only its label. Cached for ten minutes, and null when the
 * product cannot be read, in which case the interface shows no number rather
 * than a wrong one.
 */
export async function reportPrice(config: DodoConfig): Promise<ReportPrice | null> {
    if (priceCache !== null && priceCache.productId === config.productId && Date.now() - priceCache.at < PRICE_TTL_MS) {
        return priceCache.price;
    }

    let price: ReportPrice | null = null;
    try {
        const product = await dodoClient(config).products.retrieve(config.productId);
        // A report is bought once. A subscription or usage product here is a
        // dashboard mistake, and showing its number as the report price would lie.
        if (product.price.type === "one_time_price" && product.price.price > 0) {
            price = { amount: product.price.price, currency: product.price.currency };
        } else {
            console.error(`Dodo: product ${config.productId} is not a one-time price; card checkout shows no price.`);
        }
    } catch (error) {
        console.error("Dodo: could not read the report product price:", error);
    }

    priceCache = { productId: config.productId, price, at: Date.now() };
    return price;
}
