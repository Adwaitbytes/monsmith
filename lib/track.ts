"use client";

import type { EventType } from "./analytics";
import { capture as capturePostHog } from "./posthog";

// The identity itself lives in its own module: report history reads it too,
// and reaching it through here meant importing the analytics client to do so.
export { resetVisitorId, visitorId } from "./visitor";

import { visitorId } from "./visitor";

interface TrackOptions {
  status?: "success" | "error";
  durationMs?: number;
  detail?: Record<string, unknown>;
  walletAddress?: string | null;
  deployment?: {
    contractAddress: string;
    contractName?: string;
    txHash: string;
    deployerAddress: string;
    gasUsed?: string;
  };
}

/**
 * Records an event. Never throws and never blocks the caller: analytics must not
 * be able to break the feature it is measuring.
 */
export function track(type: EventType, options: TrackOptions = {}): void {
  if (typeof window === "undefined") return;

  // Mirror the event into PostHog for funnels, retention, and DeltaV traction.
  // The first-party record below stays the source of truth; this is best-effort.
  capturePostHog(type, {
    status: options.status ?? "success",
    duration_ms: options.durationMs,
    path: window.location.pathname,
    ...options.detail,
  });

  const body = JSON.stringify({
    visitorId: visitorId(),
    type,
    status: options.status ?? "success",
    durationMs: options.durationMs,
    detail: options.detail ?? {},
    walletAddress: options.walletAddress ?? undefined,
    deployment: options.deployment,
    referrer: document.referrer || undefined,
    path: window.location.pathname,
  });

  // sendBeacon survives a page navigation, which a fetch started during unload
  // does not. It is unavailable in some browsers, hence the fetch fallback.
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
      return;
    }
  } catch {
    /* fall through to fetch */
  }

  void fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    /* analytics is best-effort on the client; the server logs real failures */
  });
}
