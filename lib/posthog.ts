"use client";

import posthog from "posthog-js";

/**
 * PostHog wiring. Optional: with no key set, every function here no-ops and the
 * app is unchanged. Use the PROJECT API key (starts with `phc_`) — never the
 * personal `phx_` key, which is a secret read key and belongs only in DeltaV.
 *
 * This runs alongside the first-party Neon analytics rather than replacing it:
 * we own the raw data in our own database, and PostHog gives funnels, retention,
 * and the aggregated metrics DeltaV reads for traction.
 */

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

export const posthogEnabled = Boolean(KEY);

let started = false;

/** Initialise once on the client. Safe to call repeatedly. */
export function initPostHog(): void {
  if (started || !KEY || typeof window === "undefined") return;
  started = true;
  posthog.init(KEY, {
    api_host: HOST,
    capture_pageview: false, // App Router pageviews are captured manually
    capture_pageleave: true, // needed for session duration / bounce rate
    autocapture: true,
    person_profiles: "identified_only",
  });
}

/** Fire an event. Best-effort: never throws, no-ops until initialised. */
export function capture(event: string, props?: Record<string, unknown>): void {
  if (!started) return;
  try {
    posthog.capture(event, props);
  } catch {
    /* analytics must never break the feature it measures */
  }
}

export { posthog };
