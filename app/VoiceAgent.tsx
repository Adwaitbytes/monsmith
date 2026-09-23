'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Loader2, Maximize2, Minimize2, Phone, X } from 'lucide-react';

import { useIDEStore } from '@/lib/store';

/**
 * Aria, in a panel rather than a new tab.
 *
 * A call used to open a tab of its own, which sounds harmless and is not: the
 * studio is a page people have work sitting in, and sending them away mid-audit
 * to talk to somebody means coming back to find the tab they left. Keeping the
 * call beside the work is the whole point of it being here at all.
 *
 * Two things the frame must have or the call does not happen. It needs the
 * microphone, which a cross-origin frame is denied unless the embedding page
 * hands it over explicitly, and the permission fails quietly: you get a panel
 * that loads, looks right, and never hears anything. And it needs enough room,
 * which is why the size is draggable and remembered rather than chosen once by
 * whoever wrote the stylesheet.
 *
 * Which agent answers is still decided on the server. A browser cannot see its
 * own address, and the timezone it reports is a setting rather than a location.
 */

const MIN_WIDTH = 320;
const MIN_HEIGHT = 380;
const SIZE_KEY = 'monsmith.aria.size';

interface Size {
    width: number;
    height: number;
}

const DEFAULT_SIZE: Size = { width: 400, height: 560 };

function readSize(): Size {
    try {
        const raw = window.localStorage.getItem(SIZE_KEY);
        if (raw === null) return DEFAULT_SIZE;
        const parsed = JSON.parse(raw) as Partial<Size>;
        if (typeof parsed.width !== 'number' || typeof parsed.height !== 'number') {
            return DEFAULT_SIZE;
        }
        return {
            width: Math.max(MIN_WIDTH, parsed.width),
            height: Math.max(MIN_HEIGHT, parsed.height),
        };
    } catch {
        // A blocked or corrupt store is not a reason to refuse to open.
        return DEFAULT_SIZE;
    }
}

export function VoiceAgent() {
    // Read from the store rather than a prop: this renders in the root layout,
    // above every page, and only one of those pages has an assistant to avoid.
    const assistantOpen = useIDEStore((state) => state.assistantOpen);

    const [open, setOpen] = useState(false);
    const [url, setUrl] = useState<string | null>(null);
    const [connecting, setConnecting] = useState(false);
    const [failed, setFailed] = useState(false);
    const [size, setSize] = useState<Size>(DEFAULT_SIZE);
    const [expanded, setExpanded] = useState(false);
    const [loaded, setLoaded] = useState(false);

    const reduce = useReducedMotion();
    const dragFrom = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

    useEffect(() => {
        setSize(readSize());
    }, []);

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
            setUrl(data.url);
            setLoaded(false);
            setOpen(true);
        } catch {
            setFailed(true);
        } finally {
            setConnecting(false);
        }
    }, [connecting]);

    /*
      Resizing from the top-left corner, because the panel is anchored bottom
      right. Dragging that corner outward has to grow the panel, which means the
      delta is subtracted rather than added, and getting that backwards produces
      a panel that shrinks when you pull it.
    */
    const onResizeStart = (event: React.PointerEvent) => {
        event.preventDefault();
        dragFrom.current = { x: event.clientX, y: event.clientY, ...size };
        (event.target as HTMLElement).setPointerCapture(event.pointerId);
    };

    const onResizeMove = (event: React.PointerEvent) => {
        const from = dragFrom.current;
        if (from === null) return;

        const width = Math.max(MIN_WIDTH, Math.min(from.width - (event.clientX - from.x), window.innerWidth - 40));
        const height = Math.max(MIN_HEIGHT, Math.min(from.height - (event.clientY - from.y), window.innerHeight - 40));
        setSize({ width, height });
    };

    const onResizeEnd = () => {
        if (dragFrom.current === null) return;
        dragFrom.current = null;

        /*
          Read the size back out of state rather than off the closure.
          
          Written the obvious way this saved `size` as it was when the handler
          was created, which is the value from before the drag, so the panel
          resized correctly and then reopened at its old size every time. The
          updater form is the only thing here that sees what the drag produced.
        */
        setSize((current) => {
            try {
                window.localStorage.setItem(SIZE_KEY, JSON.stringify(current));
            } catch {
                // Losing a remembered size costs a drag next time, nothing more.
            }
            return current;
        });
    };

    const close = () => {
        setOpen(false);
        setExpanded(false);
        // Dropping the src ends the call rather than leaving a live microphone
        // in a hidden frame, which is the version of this bug that matters.
        setUrl(null);
    };

    const frameStyle = expanded
        ? { width: 'min(52rem, calc(100vw - 2.5rem))', height: 'min(44rem, calc(100vh - 6rem))' }
        : { width: size.width, height: size.height };

    return (
        <>
            <AnimatePresence>
                {!open && (
                    <motion.button
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: reduce ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
                        onClick={() => void call()}
                        disabled={connecting}
                        aria-label="Talk to Aria"
                        className={`group fixed right-5 z-40 flex items-center gap-2 rounded-full border border-border-subtle bg-surface-raised py-2.5 pl-3.5 pr-4 shadow-[var(--shadow-panel)] outline-none ring-accent-line transition-[transform,bottom] hover:-translate-y-0.5 focus-visible:ring-2 disabled:cursor-wait motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
                            assistantOpen ? 'bottom-[calc(min(34rem,70vh)+3.25rem)]' : 'bottom-[5.25rem]'
                        }`}
                    >
                        {connecting ? (
                            <Loader2
                                size={15}
                                className="animate-spin text-accent motion-reduce:animate-none"
                            />
                        ) : (
                            <Phone size={15} className="text-accent" />
                        )}
                        <span className="text-[12.5px] font-medium text-text-primary">
                            {failed ? 'Try again' : 'Talk to Aria'}
                        </span>
                    </motion.button>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {open && url !== null && (
                    <motion.aside
                        role="dialog"
                        aria-label="Talk to Aria"
                        initial={{ opacity: 0, y: 12, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 12, scale: 0.98 }}
                        transition={{ duration: reduce ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
                        style={frameStyle}
                        className="fixed bottom-9 right-5 z-50 flex flex-col overflow-hidden rounded-2xl border border-border-subtle bg-surface-raised shadow-[var(--shadow-panel)]"
                    >
                        {/* The grip, on the corner away from the page edges. */}
                        {!expanded && (
                            <div
                                onPointerDown={onResizeStart}
                                onPointerMove={onResizeMove}
                                onPointerUp={onResizeEnd}
                                onPointerCancel={onResizeEnd}
                                role="separator"
                                aria-label="Resize the call"
                                className="absolute left-0 top-0 z-10 h-5 w-5 cursor-nwse-resize"
                            >
                                <span className="absolute left-1.5 top-1.5 h-2 w-2 rounded-tl border-l-2 border-t-2 border-border-strong" />
                            </div>
                        )}

                        <header className="flex shrink-0 items-center gap-2 border-b border-border-subtle py-2.5 pl-7 pr-2.5">
                            <Phone size={13} className="text-accent" />
                            <h2 className="flex-1 font-display text-[13px] font-semibold text-text-primary">
                                Aria
                            </h2>
                            <button
                                onClick={() => setExpanded((current) => !current)}
                                aria-label={expanded ? 'Shrink the call' : 'Expand the call'}
                                className="rounded-md p-1 text-text-muted outline-none ring-accent-line transition-colors hover:text-text-primary focus-visible:ring-2"
                            >
                                {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                            </button>
                            <button
                                onClick={close}
                                aria-label="End the call"
                                className="rounded-md p-1 text-text-muted outline-none ring-accent-line transition-colors hover:text-text-primary focus-visible:ring-2"
                            >
                                <X size={14} />
                            </button>
                        </header>

                        <div className="relative min-h-0 flex-1">
                            {!loaded && (
                                <p className="absolute inset-0 flex items-center justify-center gap-2 text-[12.5px] text-text-muted">
                                    <Loader2
                                        size={13}
                                        className="animate-spin motion-reduce:animate-none"
                                    />
                                    Connecting you to Aria
                                </p>
                            )}
                            <iframe
                                src={url}
                                title="Talk to Aria"
                                onLoad={() => setLoaded(true)}
                                /*
                                  Without `microphone` a cross-origin frame is
                                  denied the mic and fails silently: the panel
                                  loads, looks right, and never hears a word.
                                  `autoplay` is what lets Aria speak first.
                                */
                                allow="microphone; autoplay; clipboard-write"
                                className="h-full w-full border-0 bg-surface-base"
                            />
                        </div>
                    </motion.aside>
                )}
            </AnimatePresence>
        </>
    );
}
