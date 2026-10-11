import type { Metadata } from "next";

import { SiteFooter, SiteNav } from "../SiteChrome";
import { OpenSealed } from "./OpenSealed";

export const metadata: Metadata = {
    title: "Open a sealed report",
    description: "Open a Monsmith audit report sealed to your passkey. It is decrypted in your browser; the key never leaves your device.",
    robots: { index: false, follow: true },
};

export default function OpenPage() {
    return (
        <div className="min-h-screen bg-background text-text-primary">
            <SiteNav />
            <OpenSealed />
            <SiteFooter />
        </div>
    );
}
