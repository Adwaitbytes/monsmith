import type { Metadata } from "next";

import { SiteFooter, SiteNav } from "../SiteChrome";
import { VerifyClient } from "./VerifyClient";

export const metadata: Metadata = {
    title: "Verify a contract",
    description:
        "Check whether a smart contract has been audited by Monsmith, read straight from Monad mainnet under Monsmith's ERC-8004 agent identity.",
};

export default function VerifyPage() {
    return (
        <div className="min-h-screen bg-background text-text-primary">
            <SiteNav />
            <VerifyClient />
            <SiteFooter />
        </div>
    );
}
