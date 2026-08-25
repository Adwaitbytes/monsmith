"use client";

import type { EventType } from "./analytics";

const VISITOR_KEY = "monsmith.visitor";

/**
 * A stable id for this browser.
 *
 * Without one, an anonymous visitor counts as a new user on every page load and
 * the totals become meaningless. It is random and carries no personal data; a
 * wallet address is attached separately only once the user connects one.
 */
function visitorId(): string {
  if (typeof window === "undefined") return "";

  let id = window.localStorage.getItem(VISITOR_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(VISITOR_KEY, id);
  }
  return id;
}

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
