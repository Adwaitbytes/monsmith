'use client';

import React, { useCallback, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Loader2, Phone } from 'lucide-react';

import { useIDEStore } from '@/lib/store';

/**
 * A line to a person, above the assistant.
 *
 * The two are deliberately different offers stacked in one place. The assistant
 * answers about the contract on screen; this one is for the questions a model
 * should not be answering, which on a product like this usually means pricing,
 * whether it fits a particular team, and whether any of it can be trusted.
 * Someone about to hand over a private repository asks a person.
 *
 * Which agent answers depends on where the caller is, and that is resolved on
 * the server: a browser cannot see its own address, and the timezone it reports
 * is a setting rather than a location. The link is fetched on click rather than
 * on mount, so a page nobody calls from costs nothing and neither number sits
 * in the page source.
 *
 * Opened in a new tab. A call that replaces the page loses whatever the person
 * was in the middle of, which for this product is a running audit.
 */

export function VoiceAgent() {
    // Read from the store rather than a prop: this renders in the root layout,
    // above every page, and only one of those pages has an assistant to avoid.
    const offset = useIDEStore((state) => state.assistantOpen);
    const [connecting, setConnecting] = useState(false);
    const [failed, setFailed] = useState(false);
    const reduce = useReducedMotion();

    const call = useCallback(async () => {
        if (connecting) return;
        setConnecting(true);
        setFailed(false);

        try {
            const response = await fetch('/api/voice-agent');
            const data = (await response.json()) as { url?: string };

            if (typeof data.url !== 'string' || data.url.length === 0) {
                setFailed(true);
                return;
            }
            // `noopener` because the far side gets a handle on this window
            // otherwise, and it is a page we do not control.
            window.open(data.url, '_blank', 'noopener,noreferrer');
        } catch {
            setFailed(true);
        } finally {
            setConnecting(false);
        }
    }, [connecting]);

    return (
        <motion.button
            onClick={() => void call()}
            disabled={connecting}
            aria-label="Talk to someone"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: reduce ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
            className={`group fixed right-5 z-40 flex items-center gap-2 rounded-full border border-border-subtle bg-surface-raised py-2.5 pl-3.5 pr-4 shadow-[var(--shadow-panel)] outline-none ring-accent-line transition-[transform,bottom] hover:-translate-y-0.5 focus-visible:ring-2 disabled:cursor-wait motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
                offset ? 'bottom-[calc(min(34rem,70vh)+3.25rem)]' : 'bottom-[5.25rem]'
            }`}
        >
            {connecting ? (
                <Loader2 size={15} className="animate-spin text-accent motion-reduce:animate-none" />
            ) : (
                <Phone size={15} className="text-accent" />
            )}
            <span className="text-[12.5px] font-medium text-text-primary">
                {failed ? 'Try again' : 'Talk to us'}
            </span>
        </motion.button>
    );
}
