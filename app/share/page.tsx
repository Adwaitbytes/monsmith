import React from "react";
import type { Metadata } from "next";

import { ShareClient } from "./ShareClient";

/**
 * A shared analysis.
 *
 * The contract lives in the URL fragment, which browsers never send to a
 * server, so there is nothing to render here ahead of time and nothing to
 * preview. That is the trade the fragment buys: a shared contract does not pass
 * through our logs on its way to the person it was sent to.
 */

export const metadata: Metadata = {
    title: "Shared analysis · Monsmith",
    description:
        "A contract analysis shared from Monsmith. The contract travels inside the link and is never stored.",
    robots: { index: false, follow: false },
};

export default function SharePage() {
    return <ShareClient />;
}
