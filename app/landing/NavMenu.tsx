'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';

/**
 * The secondary half of the navigation, folded into one item.
 *
 * Seven links sat across the top and every one of them was weighted the same,
 * which is the same mistake the studio toolbar was making: with nothing
 * emphasised, a first visitor has no idea which one answers their question.
 *
 * Three stay out: what the product is, the measurement it is known for, and the
 * way in. The rest are reading material, wanted occasionally and by people who
 * already know they want them, so they cost nothing behind one word.
 *
 * Opens on hover for a pointer and on click or Enter for everything else, with
 * a close delay so crossing the gap between the trigger and the panel does not
 * dismiss it. That gap is the classic way a hover menu becomes unusable.
 */

export interface NavMenuItem {
    label: string;
    href: string;
    hint: string;
}

export interface NavMenuProps {
    label: string;
    items: readonly NavMenuItem[];
}

export function NavMenu({ label, items }: NavMenuProps) {
    const [open, setOpen] = useState(false);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const menuId = useId();

    const cancelClose = () => {
        if (closeTimer.current !== null) {
            clearTimeout(closeTimer.current);
            closeTimer.current = null;
        }
    };

    // The delay is what makes the diagonal move from trigger to panel survive.
    const scheduleClose = () => {
        cancelClose();
        closeTimer.current = setTimeout(() => setOpen(false), 160);
    };

    useEffect(() => cancelClose, []);

    useEffect(() => {
        if (!open) return;

        const onPointerDown = (event: MouseEvent) => {
            if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };

        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    return (
        <div
            ref={wrapRef}
            className="relative"
            onMouseEnter={() => {
                cancelClose();
                setOpen(true);
            }}
            onMouseLeave={scheduleClose}
        >
            <button
                type="button"
                aria-expanded={open}
                aria-haspopup="true"
                aria-controls={menuId}
                onClick={() => setOpen((current) => !current)}
                className="group relative flex items-center gap-1 text-sm text-text-secondary outline-none transition-colors hover:text-text-primary focus-visible:text-text-primary"
            >
                {label}
                <ChevronDown
                    size={14}
                    aria-hidden
                    className={`transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
                />
                <span className="absolute -bottom-1.5 left-0 h-px w-0 bg-accent transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:w-full motion-reduce:transition-none" />
            </button>

            {open && (
                <div
                    id={menuId}
                    // The padded wrapper is the bridge across the gap; without
                    // it the pointer leaves the trigger before reaching a link.
                    className="absolute left-1/2 top-full z-50 -translate-x-1/2 pt-3"
                >
                    <div className="w-64 overflow-hidden rounded-xl border border-border-subtle bg-surface-raised p-1.5 shadow-[var(--shadow-panel)]">
                        {items.map((item) => (
                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setOpen(false)}
                                className="block rounded-lg px-3 py-2.5 outline-none transition-colors hover:bg-accent-soft focus-visible:bg-accent-soft"
                            >
                                <span className="block text-[13.5px] font-medium text-text-primary">
                                    {item.label}
                                </span>
                                <span className="mt-0.5 block text-[12px] leading-snug text-text-muted">
                                    {item.hint}
                                </span>
                            </Link>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
