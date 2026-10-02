import { NextResponse } from "next/server";
import { randomBytes } from "crypto";

import { getAddress, isAddress } from "viem";

import {
    entitlementFor,
    monRailEnabled,
    paywallEnabled,
    MONAD_CHAIN_ID,
    REPORT_PAYEE,
    REPORT_PRICE_WEI,
    type EntitlementReason,
} from "@/lib/report/entitlement";
import { redactReport } from "@/lib/report/redact";
import { loadReport, recordUnlock, type ReportOwner, type StoredReport } from "@/lib/report/store";
import { settlePayment, verifyPayment, type Q402Payload, type Q402Settlement } from "@/lib/q402";

/**
 * Paying to unlock a report.
 *
 * This is the same q402 challenge, verify, settle rail already running for the
 * paid agent actions, pointed at a report instead of a deployment. It is
 * deliberately the same protocol rather than a second one: the wallet-side
 * signer in `utils/q402.ts` is written against that shape, and a bespoke
 * payment flow for one route would be a second place to get replay protection
 * wrong.
 *
 * Two structural decisions carry the security here. The terms are re-asserted
 * from server constants before verification, so the witness that arrives with
 * the request is checked against what this server charges rather than against
 * its own claim about what it owes. And the outcome of the attempt is computed
 * as a value before anything is serialised, so there is exactly one statement
 * in the file that puts report data into a response and it passes `true` to
 * `redactReport` only on the branch that has already established entitlement.
 */

export const runtime = "nodejs";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * How long a signed witness stays valid.
 *
 * Ten minutes is long enough for a wallet prompt that the user walks away from
 * and short enough that a witness captured from a log is dead before anyone
 * reads it. The agent route allows an hour; there is no reason for a single
 * button press to hold a live payment authorisation that long.
 */
const WITNESS_TTL_SECONDS = 600;

/**
 * Payment ids this process has already spent, and the report each was spent on.
 *
 * `verifyPayment` keeps its own spent set and rejects any witness twice, which
 * is the general defence. This map is the report-scoped one: it makes the
 * failure legible when a witness issued for one report is presented against
 * another, so the rejection says so instead of reading as a bad signature.
 *
 * Process-local, exactly like the set in `lib/q402.ts`, and for the same
 * reason. The durable guarantee is the `report_unlocks` row, whose primary key
 * is the report id: a second settlement for a report that is already unlocked
 * cannot happen because the entitlement check at the top of every attempt sees
 * that row first, on every instance.
 */
const spentOnReport = new Map<string, string>();

// ============= UNTRUSTED INPUT =============

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

/**
 * The wallet that will pay.
 *
 * Taken from the body because only the client knows which account is connected,
 * and it is safe to take from the body: it is written into the challenge as the
 * witness owner, so naming someone else's address produces a challenge that
 * only that someone else could sign. It cannot be used to name a payee or a
 * price, which are the fields worth lying about.
 */
function payerFrom(body: unknown): string | null {
    if (!isRecord(body)) return null;

    const value = body.userAddress;
    if (typeof value !== "string" || !isAddress(value)) return null;

    // Checksummed so the address written into the witness is the one wallets
    // display, which keeps the signing prompt legible.
    return getAddress(value);
}

function networkFrom(body: unknown): string {
    if (!isRecord(body)) return "monad-testnet";
    return body.network === "mainnet" ? "monad-mainnet" : "monad-testnet";
}

/**
 * Narrows a decoded `x-payment` header to the payload shape.
 *
 * `verifyPayment` tolerates malformed input and returns false, but a payload
 * that fails to parse is a client bug rather than a failed payment and deserves
 * to be told apart from one. The nested `types` object is checked for shape
 * only; whether it describes a valid EIP-712 struct is decided by the signature
 * recovery, which is the check that actually matters.
 */
function isQ402Payload(value: unknown): value is Q402Payload {
    if (!isRecord(value)) return false;
    if (typeof value.witnessSignature !== "string") return false;

    const details = value.paymentDetails;
    if (!isRecord(details)) return false;
    for (const field of ["amount", "to", "token", "networkId"] as const) {
        if (typeof details[field] !== "string") return false;
    }

    const witness = details.witness;
    if (!isRecord(witness)) return false;
    if (!isRecord(witness.domain) || !isRecord(witness.types)) return false;
    if (typeof witness.primaryType !== "string") return false;

    const message = witness.message;
    if (!isRecord(message)) return false;
    for (const field of ["owner", "token", "amount", "to", "paymentId", "nonce"] as const) {
        if (typeof message[field] !== "string") return false;
    }
    return typeof message.deadline === "string" || typeof message.deadline === "number";
}

function parsePaymentHeader(header: string): Q402Payload | null {
    try {
        const decoded = Buffer.from(header, "base64").toString("utf-8");
        const parsed: unknown = JSON.parse(decoded);
        return isQ402Payload(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

// ============= THE CHALLENGE =============

interface PaymentChallenge {
    scheme: string;
    networkId: string;
    amount: string;
    witness: {
        domain: { name: string; version: string; chainId: number; verifyingContract: string };
        types: Record<string, Array<{ name: string; type: string }>>;
        primaryType: string;
        message: {
            owner: string;
            token: string;
            amount: string;
            to: string;
            deadline: number;
            paymentId: string;
            nonce: string;
        };
    };
}

function challengeFor(payer: string, networkId: string): PaymentChallenge {
    return {
        scheme: "evm/eip7702-delegated-payment",
        networkId,
        amount: REPORT_PRICE_WEI,
        witness: {
            domain: {
                name: "q402",
                version: "1",
                chainId: MONAD_CHAIN_ID,
                verifyingContract: ZERO_ADDRESS,
            },
            types: {
                Witness: [
                    { name: "owner", type: "address" },
                    { name: "token", type: "address" },
                    { name: "amount", type: "uint256" },
                    { name: "to", type: "address" },
                    { name: "deadline", type: "uint256" },
                    { name: "paymentId", type: "bytes32" },
                    { name: "nonce", type: "uint256" },
                ],
            },
            primaryType: "Witness",
            message: {
                owner: payer,
                token: ZERO_ADDRESS,
                amount: REPORT_PRICE_WEI,
                to: REPORT_PAYEE,
                deadline: Math.floor(Date.now() / 1000) + WITNESS_TTL_SECONDS,
                // Unguessable, so a third party cannot pre-sign a witness for
                // someone else's session.
                paymentId: `0x${randomBytes(32).toString("hex")}`,
                nonce: `0x${randomBytes(8).toString("hex")}`,
            },
        },
    };
}

// ============= THE ATTEMPT =============

/**
 * What happened, as a value.
 *
 * Kept separate from the response so the decision to hand over the full report
 * is made once, in one branch, and cannot be reached by any path that has not
 * established entitlement.
 */
type UnlockOutcome =
    | {
          kind: "unlocked";
          alreadyUnlocked: boolean;
          reason: EntitlementReason;
          txHash: string | null;
          /** False when settlement succeeded but the unlock could not be stored. */
          persisted: boolean;
      }
    | { kind: "challenge"; paymentDetails: PaymentChallenge }
    | { kind: "rejected"; status: number; error: string };

async function attemptUnlock(
    reportId: string,
    req: Request,
    body: unknown,
): Promise<UnlockOutcome> {
    const { entitled, owner, reason } = await entitlementFor(reportId, req);


    // Charging someone twice for the same report is worse than any other bug on
    // this path, so entitlement is resolved before a payment header is even
    // read. A tier, a settled unlock and a first free report all land here.
    if (entitled) {
        return { kind: "unlocked", alreadyUnlocked: true, reason, txHash: null, persisted: true };
    }

    const payer = payerFrom(body);
    if (payer === null) {
        return {
            kind: "rejected",
            status: 400,
            error: "Connect a wallet before unlocking this report.",
        };
    }

    const header = req.headers.get("x-payment");
    if (header === null || header.length === 0) {
        return { kind: "challenge", paymentDetails: challengeFor(payer, networkFrom(body)) };
    }

    const payload = parsePaymentHeader(header);
    if (payload === null) {
        console.error(`Report unlock ${reportId}: malformed x-payment header`);
        return { kind: "rejected", status: 400, error: "Malformed payment header." };
    }

    const paymentId = payload.paymentDetails.witness.message.paymentId;
    const spentOn = spentOnReport.get(paymentId);
    if (spentOn !== undefined && spentOn !== reportId) {
        console.error(
            `Report unlock ${reportId}: witness ${paymentId} was already spent on report ${spentOn}`,
        );
        return {
            kind: "rejected",
            status: 402,
            error: "That payment was already used to unlock a different report.",
        };
    }

    // The terms come from server constants. The payload's own copy of the
    // amount and the payee is never consulted.
    const verified = await verifyPayment(payload, {
        payer,
        payee: REPORT_PAYEE,
        minAmount: BigInt(REPORT_PRICE_WEI),
        chainId: MONAD_CHAIN_ID,
    });
    if (!verified) {
        console.error(`Report unlock ${reportId}: witness failed verification for payer ${payer}`);
        return {
            kind: "rejected",
            status: 402,
            error: "The payment signature did not match the terms this server issued.",
        };
    }

    let settlement: Q402Settlement;
    try {
        settlement = await settlePayment(payload);
    } catch (error) {
        const detail = error instanceof Error ? error.message : "Settlement failed";
        console.error(`Report unlock ${reportId}: settlement failed:`, detail);
        return { kind: "rejected", status: 402, error: `Payment settlement failed: ${detail}` };
    }

    // From here the payment has gone through, so the report is owed regardless
    // of what happens next. A store that refuses the row leaves us unable to
    // remember an unlock we were paid for, which is a reconciliation problem
    // and gets logged as one, but withholding the report would take the money
    // and give nothing back. The flag lets the client say so honestly.
    let persisted = true;
    try {
        await recordUnlock(reportId, owner, settlement.txHash, REPORT_PRICE_WEI);
    } catch (error) {
        persisted = false;
        console.error(
            `Report unlock ${reportId}: settled as ${settlement.txHash} but could not be recorded:`,
            error,
        );
    }

    spentOnReport.set(paymentId, reportId);
    logSettled(reportId, owner, settlement.txHash);

    return {
        kind: "unlocked",
        alreadyUnlocked: false,
        reason: "paid",
        txHash: settlement.txHash,
        persisted,
    };
}

function logSettled(reportId: string, owner: ReportOwner, txHash: string): void {
    const who = owner.userId ?? owner.visitorId ?? "anonymous";
    console.info(`[unlock] report ${reportId}: settled ${REPORT_PRICE_WEI} wei for ${who} (${txHash})`);
}

// ============= THE ROUTE =============

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    // Route params are a promise in this version of Next, so this await is load
    // bearing: the unresolved object has no `id` to charge against.
    const { id } = await params;

    if (id.length === 0) {
        return NextResponse.json({ error: "Report id is required" }, { status: 400 });
    }

    let stored: StoredReport | null;
    try {
        stored = await loadReport(id);
    } catch (error) {
        console.error(`Report unlock ${id}: could not read the report store:`, error);
        return NextResponse.json(
            { success: false, error: "Could not read the report store" },
            { status: 503 },
        );
    }

    // Nothing is charged for a report that does not exist, so the lookup comes
    // before the payment rail rather than after it.
    if (stored === null) {
        return NextResponse.json({ success: false, error: "Report not found" }, { status: 404 });
    }

    // With the paywall dormant every report is already whole, so there is
    // nothing to sell and no signature to ask for. Handing back the report
    // rather than an error means a client that still offers an unlock button
    // gets the right outcome instead of a failure it would have to explain.
    if (!paywallEnabled()) {
        return NextResponse.json({
            success: true,
            alreadyUnlocked: true,
            reason: "tier",
            txHash: null,
            persisted: true,
            report: redactReport(stored.report, true),
        });
    }

    if (!monRailEnabled()) {
        return NextResponse.json(
            { success: false, error: "Paying in MON is not available right now. Unlock this report by card instead." },
            { status: 403 },
        );
    }

    let body: unknown = null;
    try {
        body = await req.json();
    } catch {
        // An absent or unparseable body is not fatal on its own. It fails later
        // as a missing payer, which is the more useful message.
        body = null;
    }

    const outcome = await attemptUnlock(id, req, body);

    if (outcome.kind === "challenge") {
        return NextResponse.json(
            { success: false, error: "Payment Required", paymentDetails: outcome.paymentDetails },
            { status: 402 },
        );
    }

    if (outcome.kind === "rejected") {
        return NextResponse.json(
            { success: false, error: outcome.error },
            { status: outcome.status },
        );
    }

    // The only statement in this file that serialises report data, and the only
    // one that passes `true` to the redactor. It is reachable solely from the
    // `unlocked` outcome, which is produced either by an entitlement that
    // already held or by a payment that verified and settled.
    return NextResponse.json({
        success: true,
        alreadyUnlocked: outcome.alreadyUnlocked,
        reason: outcome.reason,
        txHash: outcome.txHash,
        persisted: outcome.persisted,
        report: redactReport(stored.report, true),
    });
}
