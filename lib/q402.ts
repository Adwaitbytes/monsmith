// lib/q402.ts
import { verifyTypedData, defineChain, type TypedDataDomain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'crypto';

// --- MONAD CHAIN DEFINITIONS ---
const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: {
    decimals: 18,
    name: 'Monad',
    symbol: 'MON',
  },
  rpcUrls: {
    default: { http: ['https://testnet-rpc.monad.xyz'] },
  },
  blockExplorers: {
    default: { name: 'Monad Explorer', url: 'https://testnet.monadexplorer.com' },
  },
});

const monadMainnet = defineChain({
  // Was 10143, the testnet id, carried over from a copy of the block above with
  // a note to fix it later. A signature verified against the wrong chain id is
  // valid on a chain the payer did not agree to, so this is not cosmetic.
  id: 143,
  name: 'Monad Mainnet',
  nativeCurrency: {
    decimals: 18,
    name: 'Monad',
    symbol: 'MON',
  },
  rpcUrls: {
    default: { http: ['https://mainnet-rpc.monad.xyz'] },
  },
  blockExplorers: {
    default: { name: 'Monad Explorer', url: 'https://monadexplorer.com' },
  },
});

// --- CONFIG ---
const SPONSOR_KEY = process.env.PRIVATE_KEY;
const MAX_SETTLEMENT = 100_000_000_000_000_000n; // 0.1 MON

// --- TYPES ---
export interface Q402Witness {
  domain: TypedDataDomain;
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: {
    owner: string;
    token: string;
    amount: string;
    to: string;
    deadline: string | number;
    paymentId: string;
    nonce: string;
  };
}

export interface Q402Payload {
  witnessSignature: string;
  paymentDetails: {
    amount: string;
    to: string;
    token: string;
    networkId: string;
    witness: Q402Witness;
  };
}

/** Terms the server issued in its 402 challenge. Verification is checked against these, not against the client's copy. */
export interface Q402ExpectedTerms {
  payer: string;
  payee: string;
  minAmount: bigint;
  chainId: number;
}

export interface Q402Settlement {
  success: true;
  facilitator: string;
  settledAt: number;
  txHash: `0x${string}`;
}

/**
 * Payment ids that have already been settled. A valid signature is otherwise
 * replayable forever, so each witness is accepted exactly once.
 *
 * Process-local by design: this is a single-node demo facilitator. A multi-region
 * deployment must move this to shared storage (Redis/Postgres) or the same
 * witness can be spent once per instance.
 */
const spentPaymentIds = new Set<string>();

function isSameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

// --- 1. VERIFICATION SERVICE ---
/**
 * Verifies a q402 witness signature AND that the signed terms match what this
 * server actually asked for. Checking the signature alone is not enough: the
 * witness travels with the request, so a caller could sign terms of their own
 * choosing (1 wei, paid to themselves) and produce a technically valid signature.
 */
export async function verifyPayment(
  payload: Q402Payload,
  expected: Q402ExpectedTerms
): Promise<boolean> {
  try {
    console.log("🔍 Q402: Verifying Witness Signature...");
    const { witnessSignature, paymentDetails } = payload;
    const { witness } = paymentDetails ?? {};

    if (!witness?.message || !witnessSignature) {
      throw new Error("Malformed payment payload");
    }

    const { message, domain } = witness;

    // --- Terms must match the challenge this server issued ---
    if (!isSameAddress(message.owner, expected.payer)) {
      throw new Error("Witness owner does not match the authenticated wallet");
    }
    if (!isSameAddress(message.to, expected.payee)) {
      throw new Error("Witness pays an unexpected recipient");
    }
    if (BigInt(message.amount) < expected.minAmount) {
      throw new Error("Witness amount is below the required price");
    }
    if (Number(domain?.chainId) !== expected.chainId) {
      throw new Error("Witness signed for the wrong chain");
    }

    // --- Deadline is mandatory: an undated witness never expires ---
    const now = Math.floor(Date.now() / 1000);
    const deadline = Number(message.deadline);
    if (!Number.isFinite(deadline) || deadline <= 0) {
      throw new Error("Payment Witness has no deadline");
    }
    if (now > deadline) {
      throw new Error("Payment Witness Expired");
    }

    // --- Replay protection ---
    if (!message.paymentId || spentPaymentIds.has(message.paymentId)) {
      throw new Error("Payment Witness already used");
    }

    // --- EIP-712 signature check ---
    const valid = await verifyTypedData({
      address: message.owner as `0x${string}`,
      domain,
      types: witness.types,
      primaryType: witness.primaryType,
      message: message as unknown as Record<string, unknown>,
      signature: witnessSignature as `0x${string}`
    });

    if (!valid) {
      console.error("❌ EIP-712 Signature Mismatch");
      throw new Error("Signature Invalid");
    }

    spentPaymentIds.add(message.paymentId);

    console.log(`✅ Q402: Signature Verified for ${message.owner}`);
    return true;

  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("❌ Q402 Verification Failed:", reason);
    return false;
  }
}

// --- 2. SETTLEMENT SERVICE ---
/**
 * Settles a verified witness. On this demo facilitator settlement is the act of
 * granting the agent permission to proceed; the sponsor wallet is resolved here
 * so a misconfigured key fails loudly rather than mid-deployment.
 */
export async function settlePayment(payload: Q402Payload): Promise<Q402Settlement> {
  console.log("💼 Q402: Initiating Settlement via Facilitator...");

  if (!SPONSOR_KEY) {
    throw new Error("Facilitator wallet not configured: set PRIVATE_KEY");
  }

  const account = privateKeyToAccount(
    (SPONSOR_KEY.startsWith("0x") ? SPONSOR_KEY : `0x${SPONSOR_KEY}`) as `0x${string}`
  );

  const chain =
    payload.paymentDetails.networkId === 'monad-mainnet' ? monadMainnet : monadTestnet;

  // Policy check: cap what a single settlement may move.
  const amountBig = BigInt(payload.paymentDetails.amount);
  if (amountBig > MAX_SETTLEMENT) {
    throw new Error("Settlement amount exceeds Policy limit");
  }

  console.log(`✅ Q402: Facilitator ${account.address} sponsoring execution on ${chain.name}...`);

  return {
    success: true,
    facilitator: account.address,
    settledAt: Date.now(),
    txHash: `0x${randomBytes(32).toString('hex')}` as `0x${string}`,
  };
}
