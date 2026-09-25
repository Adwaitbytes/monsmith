// lib/apiTypes.ts
// Response contracts shared by the API routes and the studio UI. Keeping both
// sides on one definition is what stops a renamed field from silently becoming
// `undefined` in the interface.

export type Severity = "critical" | "high" | "medium" | "low" | "info";

/**
 * The assistant's one-click actions.
 *
 * Lived in a Supabase analytics module that recorded which of them people
 * pressed, against a project that had been deleted. The recording is gone; the
 * four actions are still on screen, so the type outlived its file.
 */
export type QuickActionType = "explain" | "optimize" | "secure" | "debug";

export interface SecurityIssue {
  severity: Severity;
  title: string;
  description: string;
  line?: number;
  recommendation: string;
}

export interface SecurityAnalysis {
  riskLevel: string;
  /** Penalty points accumulated across findings - higher is worse, unbounded. */
  riskScore: number;
  /** 0-100, higher is safer. Derived from riskScore and clamped. */
  securityScore: number;
  deploymentRecommendation: string;
  summary: Record<Severity, number>;
  issues: SecurityIssue[];
  timestamp: string;
  disclaimer: string;
}

export interface SecurityAuditResponse {
  success: boolean;
  analysis?: SecurityAnalysis;
  error?: string;
}

export interface CompilerDiagnostic {
  message: string;
  severity?: string;
  type?: string;
  line?: number;
}

/** solc's record of where a library address has to be written in. */
export type LinkReferences = Record<string, Record<string, { start: number; length: number }[]>>;

export interface CompiledLibrary {
  qualified: string;
  name: string;
  bytecode: string;
  linkReferences?: LinkReferences;
}

export interface CompileResponse {
  success: boolean;
  /** Which contract was built, which matters when the file declares several. */
  contractName?: string;
  abi?: unknown[];
  bytecode?: string;
  contractSize?: number;
  errors?: CompilerDiagnostic[];
  message?: string;
  error?: string;
  /** Present when the contract calls a library that must be deployed first. */
  linkReferences?: LinkReferences;
  libraries?: CompiledLibrary[];
}

export interface DeployResponse {
  success: boolean;
  address?: string;
  txHash?: string;
  logs?: string;
  gasUsed?: string;
  error?: string;
  paymentDetails?: unknown;
}

export interface AgentTextResponse {
  success: boolean;
  result?: string;
  answer?: string;
  response?: string;
  code?: string;
  report?: string;
  explanation?: string;
  error?: string;
}

export interface PymonFinding {
  severity: Severity;
  title: string;
  description?: string;
}

export interface PymonAuditResponse {
  success: boolean;
  score?: number;
  riskLevel?: string;
  findings?: PymonFinding[];
  bestPractices?: string[];
  error?: string;
}

export interface TranspileResponse {
  success: boolean;
  contractName?: string;
  solidityCode?: string;
  abi?: unknown[];
  error?: string;
}

export interface ExplainErrorResponse {
  success: boolean;
  explanation?: string;
  fix?: string;
  teachMode?: TeachModeContent | null;
  error?: string;
}

export interface TeachModeContent {
  title: string;
  steps: string[];
}

/** Body of a 402 response: the witness the client must sign to proceed. */
export interface PaymentChallenge {
  error?: string;
  paymentDetails: {
    scheme: string;
    networkId: string;
    amount: string;
    witness: {
      domain: { name: string; version: string; chainId: number; verifyingContract: string };
      types: Record<string, { name: string; type: string }[]>;
      primaryType: string;
      message: Record<string, string | number>;
    };
  };
}

/**
 * Parses a response that is *supposed* to be JSON.
 *
 * A serverless function that times out or crashes returns an HTML or plain-text
 * page from the platform, and calling .json() on that throws a parse error that
 * surfaces to the user as `Unexpected token 'A'`. This turns those into a real
 * message instead.
 */
export async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    const snippet = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
    if (res.status === 504 || /timed out|FUNCTION_INVOCATION_TIMEOUT/i.test(text)) {
      throw new Error("The request took too long and timed out. Try a shorter prompt.");
    }
    throw new Error(
      snippet
        ? `Server error (${res.status}): ${snippet}`
        : `Server returned ${res.status} with no readable body.`
    );
  }
}

/** Narrows an unknown thrown value to a displayable message. */
export function errorMessage(error: unknown, fallback = "Unexpected error"): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return fallback;
}
