import { NextResponse } from "next/server";
import { recordDeployment, trackEvent, type EventType } from "@/lib/analytics";
import { readRequestContext, referrerHost } from "@/lib/requestContext";

const KNOWN_EVENTS: EventType[] = [
  "page_view",
  "compile",
  "deploy",
  "audit",
  "parallel_analysis",
  "gas_profile",
  "chain_fit",
  "migration",
  "ai_generate",
  "transpile",
  "interact_read",
  "interact_write",
  "wallet_connect",
];

function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && (KNOWN_EVENTS as string[]).includes(value);
}

interface TrackBody {
  visitorId?: unknown;
  type?: unknown;
  status?: unknown;
  durationMs?: unknown;
  detail?: unknown;
  walletAddress?: unknown;
  referrer?: unknown;
  path?: unknown;
  deployment?: {
    contractAddress?: unknown;
    contractName?: unknown;
    txHash?: unknown;
    deployerAddress?: unknown;
    gasUsed?: unknown;
  };
}

/**
 * Receives analytics from the browser.
 *
 * The database credential cannot leave the server, so the client posts here
 * rather than writing directly. Bad input is rejected rather than stored, since
 * a table full of malformed rows is worse than a smaller honest one.
 */
export async function POST(req: Request) {
  let body: TrackBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Malformed body" }, { status: 400 });
  }

  const visitorId = typeof body.visitorId === "string" ? body.visitorId.slice(0, 100) : "";
  if (!visitorId) {
    return NextResponse.json({ success: false, error: "visitorId is required" }, { status: 400 });
  }
  if (!isEventType(body.type)) {
    return NextResponse.json({ success: false, error: "Unknown event type" }, { status: 400 });
  }

  const walletAddress =
    typeof body.walletAddress === "string" && /^0x[a-fA-F0-9]{40}$/.test(body.walletAddress)
      ? body.walletAddress
      : undefined;

  // Geography and device come from the request itself rather than the client,
  // which cannot be trusted to report where it is.
  const context = readRequestContext(req);
  const referrer = referrerHost(
    typeof body.referrer === "string" ? body.referrer : req.headers.get("referer")
  );

  const written = await trackEvent({
    visitorId,
    type: body.type,
    context,
    referrer,
    path: typeof body.path === "string" ? body.path.slice(0, 200) : null,
    status: body.status === "error" ? "error" : "success",
    durationMs: typeof body.durationMs === "number" ? Math.round(body.durationMs) : undefined,
    detail: typeof body.detail === "object" && body.detail !== null
      ? (body.detail as Record<string, unknown>)
      : {},
    walletAddress,
  });

  // A deploy carries the on-chain record alongside the event.
  const deployment = body.deployment;
  if (
    deployment &&
    typeof deployment.contractAddress === "string" &&
    typeof deployment.txHash === "string" &&
    typeof deployment.deployerAddress === "string"
  ) {
    await recordDeployment({
      visitorId,
      contractAddress: deployment.contractAddress,
      contractName: typeof deployment.contractName === "string" ? deployment.contractName : undefined,
      txHash: deployment.txHash,
      deployerAddress: deployment.deployerAddress,
      gasUsed: typeof deployment.gasUsed === "string" ? deployment.gasUsed : undefined,
    });
  }

  return NextResponse.json({ success: written });
}
