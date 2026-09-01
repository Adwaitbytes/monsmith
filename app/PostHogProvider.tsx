"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { initPostHog, capture, posthogEnabled } from "@/lib/posthog";

/**
 * Captures an App Router pageview whenever the route changes. Next needs
 * useSearchParams inside a Suspense boundary, which the provider supplies.
 */
function PageviewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!posthogEnabled) return;
    let url = window.location.origin + pathname;
    const qs = searchParams?.toString();
    if (qs) url += `?${qs}`;
    capture("$pageview", { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}

/** Boots PostHog on the client and tracks pageviews. No-ops without a key. */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initPostHog();
  }, []);

  return (
    <>
      {posthogEnabled && (
        <Suspense fallback={null}>
          <PageviewTracker />
        </Suspense>
      )}
      {children}
    </>
  );
}
