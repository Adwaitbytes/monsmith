'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'framer-motion';
import { Check, LogOut, Moon, Sun, User, Wallet } from 'lucide-react';

import { AuthControls } from '../../AuthControls';

/**
 * Everything the top bar used to spend permanent width on.
 *
 * Theme, network, language and the wallet each had their own pill up there,
 * four of the seventeen controls that made the studio unreadable. They are all
 * settings: you choose them roughly once and then never look at them again,
 * which is exactly the profile that does not deserve a toolbar slot. An action
 * you take fifty times a session earns one; a switch you flip on your first day
 * does not.
 *
 * Mainnet is the one row that carries real weight, because picking it is the
 * difference between a free rehearsal and spending money that does not come
 * back. It is drawn with the caution colour only once selected. Painting the
 * normal case in warning colours would make the warning mean nothing.
 *
 * Signed-out state is Clerk's own controls rather than a second sign-in button
 * invented here, so there is one place in the app that knows what signing in
 * looks like.
 */

export type StudioTheme = 'light' | 'dark';
export type StudioNetwork = 'testnet' | 'mainnet';
export type StudioLanguage = 'solidity' | 'python';

export interface AccountMenuProps {
    theme: StudioTheme;
    onToggleTheme: () => void;
    network: StudioNetwork;
    onNetworkChange: (network: StudioNetwork) => void;
    language: StudioLanguage;
    onLanguageChange: (language: StudioLanguage) => void;
    /** Checksummed address, or null when no wallet is attached. */
    wallet: string | null;
    onConnectWallet: () => void;
    onDisconnectWallet: () => void;
}

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Marks the elements the menu's arrow keys walk between. Explicit opt-in, so
 *  focusable nodes inside Clerk's own controls do not join the rotation. */
const STOP = 'data-menu-stop';

interface SegmentOption<T extends string> {
    value: T;
    label: string;
    /** Drawn in the caution colour once chosen, for choices that cost money. */
    weighty?: boolean;
}

interface SegmentedProps<T extends string> {
    label: string;
    value: T;
    options: Array<SegmentOption<T>>;
    onChange: (value: T) => void;
}

/**
 * A two-way choice as a radio group with roving tabindex.
 *
 * Only the selected segment is a menu stop, so arrowing down the menu treats
 * the control as one row rather than two, and left/right moves inside it. That
 * is the behaviour the ARIA radio group pattern describes, and it is also the
 * one that keeps a menu of six settings six presses deep instead of ten.
 */
function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
    const move = (direction: 1 | -1) => {
        const index = options.findIndex((option) => option.value === value);
        const next = options[(index + direction + options.length) % options.length];
        onChange(next.value);
    };

    return (
        <div
            role="radiogroup"
            aria-label={label}
            onKeyDown={(event) => {
                if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    move(1);
                } else if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    move(-1);
                }
            }}
            className="flex items-center gap-0.5 rounded-lg border border-border-subtle bg-surface-sunken p-0.5"
        >
            {options.map((option) => {
                const selected = option.value === value;
                const caution = selected && option.weighty === true;

                return (
                    <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        tabIndex={selected ? 0 : -1}
                        {...(selected ? { [STOP]: '' } : {})}
                        onClick={() => onChange(option.value)}
                        className={`rounded-[7px] px-2.5 py-1 text-[11.5px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                            caution
                                ? 'border border-[var(--contention-conditional-line)] bg-[var(--contention-conditional-soft)] text-[var(--contention-conditional)]'
                                : selected
                                  ? 'bg-surface-raised text-text-primary shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
                                  : 'text-text-muted hover:text-text-secondary'
                        }`}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-4 px-3 py-2">
            <span className="text-[12.5px] text-text-secondary">{label}</span>
            {children}
        </div>
    );
}

export function AccountMenu({
    theme,
    onToggleTheme,
    network,
    onNetworkChange,
    language,
    onLanguageChange,
    wallet,
    onConnectWallet,
    onDisconnectWallet,
}: AccountMenuProps) {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const panelId = useId();

    const reduce = useReducedMotion();
    const transition: Transition = reduce ? { duration: 0 } : { duration: 0.15, ease: EASE };

    const close = useCallback(
        (returnFocus: boolean) => {
            setOpen(false);
            if (returnFocus) triggerRef.current?.focus();
        },
        [],
    );

    useEffect(() => {
        if (!open) return;

        const onPointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (menuRef.current?.contains(target) === true) return;
            if (triggerRef.current?.contains(target) === true) return;
            // Dismissing by clicking elsewhere leaves focus where the click
            // landed, so the trigger deliberately does not take it back.
            setOpen(false);
        };

        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [open]);

    const stops = (): HTMLElement[] =>
        menuRef.current === null
            ? []
            : Array.from(menuRef.current.querySelectorAll<HTMLElement>(`[${STOP}]`));

    const step = (direction: 1 | -1) => {
        const items = stops();
        if (items.length === 0) return;
        const at = items.findIndex((item) => item === document.activeElement);
        const next = at === -1 ? (direction === 1 ? 0 : items.length - 1) : (at + direction + items.length) % items.length;
        items[next].focus();
    };

    const focusFirst = () => window.requestAnimationFrame(() => stops()[0]?.focus());

    const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            close(true);
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            step(1);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            step(-1);
        }
    };

    const short = wallet === null ? null : `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;

    return (
        <div className="relative">
            <button
                ref={triggerRef}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={open ? panelId : undefined}
                aria-label="Account and settings"
                onClick={() => {
                    const next = !open;
                    setOpen(next);
                    if (next) focusFirst();
                }}
                onKeyDown={(event) => {
                    // Enter and Space already activate a button. ArrowDown is the
                    // extra affordance that opens the menu and lands on row one.
                    if (event.key !== 'ArrowDown') return;
                    event.preventDefault();
                    setOpen(true);
                    focusFirst();
                }}
                className={`relative flex h-8 w-8 items-center justify-center rounded-full border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised ${
                    open
                        ? 'border-accent-line bg-accent-soft text-accent'
                        : 'border-border-subtle bg-surface-sunken text-text-secondary hover:border-border-strong hover:text-text-primary'
                }`}
            >
                <User size={15} aria-hidden />
                {wallet !== null && (
                    <span
                        aria-hidden
                        className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface-raised bg-[var(--contention-parallel)]"
                    />
                )}
            </button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        ref={menuRef}
                        id={panelId}
                        role="dialog"
                        aria-label="Account and settings"
                        onKeyDown={onMenuKeyDown}
                        initial={reduce ? false : { opacity: 0, y: -4, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
                        transition={transition}
                        style={{ transformOrigin: 'top right' }}
                        className="panel-surface absolute right-0 top-full z-50 mt-2 w-[19rem] overflow-hidden rounded-xl border border-border-strong shadow-[var(--shadow-panel)]"
                    >
                        <div className="py-1.5">
                            <p className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                                Workspace
                            </p>

                            <Row label="Appearance">
                                <button
                                    type="button"
                                    {...{ [STOP]: '' }}
                                    onClick={onToggleTheme}
                                    aria-pressed={theme === 'dark'}
                                    className="flex items-center gap-1.5 rounded-lg border border-border-subtle bg-surface-sunken px-2.5 py-1 text-[11.5px] font-medium text-text-secondary transition-colors duration-150 hover:border-border-strong hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                >
                                    {theme === 'dark' ? (
                                        <Moon size={12} aria-hidden />
                                    ) : (
                                        <Sun size={12} aria-hidden />
                                    )}
                                    {theme === 'dark' ? 'Dark' : 'Light'}
                                </button>
                            </Row>

                            <Row label="Language">
                                <Segmented<StudioLanguage>
                                    label="Editor language"
                                    value={language}
                                    onChange={onLanguageChange}
                                    options={[
                                        { value: 'solidity', label: 'Solidity' },
                                        { value: 'python', label: 'Python' },
                                    ]}
                                />
                            </Row>

                            <Row label="Network">
                                <Segmented<StudioNetwork>
                                    label="Deployment network"
                                    value={network}
                                    onChange={onNetworkChange}
                                    options={[
                                        { value: 'testnet', label: 'Testnet' },
                                        { value: 'mainnet', label: 'Mainnet', weighty: true },
                                    ]}
                                />
                            </Row>

                            {network === 'mainnet' && (
                                <p className="mx-3 mb-1 rounded-lg border border-[var(--contention-conditional-line)] bg-[var(--contention-conditional-soft)] px-2.5 py-2 text-[11.5px] leading-relaxed text-[var(--contention-conditional)]">
                                    Mainnet spends real MON. Deploys and transactions are permanent.
                                </p>
                            )}
                        </div>

                        <div className="border-t border-border-subtle py-1.5">
                            <p className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                                Wallet
                            </p>

                            {wallet === null ? (
                                <div className="px-3 pb-2 pt-0.5">
                                    <button
                                        type="button"
                                        {...{ [STOP]: '' }}
                                        onClick={() => {
                                            close(false);
                                            onConnectWallet();
                                        }}
                                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-text-primary px-3 py-1.5 text-[12px] font-semibold text-background transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                                    >
                                        <Wallet size={13} aria-hidden />
                                        Connect wallet
                                    </button>
                                    <p className="pt-1.5 text-[11px] leading-relaxed text-text-muted">
                                        Only needed to deploy or send a transaction.
                                    </p>
                                </div>
                            ) : (
                                <div className="flex items-center justify-between gap-2 px-3 py-1.5">
                                    <span className="flex min-w-0 items-center gap-2">
                                        <Check
                                            size={13}
                                            aria-hidden
                                            className="shrink-0 text-[var(--contention-parallel)]"
                                        />
                                        <span
                                            title={wallet}
                                            className="truncate font-mono text-[12px] text-text-primary"
                                        >
                                            {short}
                                        </span>
                                    </span>
                                    <button
                                        type="button"
                                        {...{ [STOP]: '' }}
                                        onClick={onDisconnectWallet}
                                        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border-subtle px-2 py-1 text-[11.5px] font-medium text-text-muted transition-colors duration-150 hover:border-[var(--contention-serial-line)] hover:text-[var(--contention-serial)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                    >
                                        <LogOut size={12} aria-hidden />
                                        Disconnect
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="flex items-center justify-between gap-3 border-t border-border-subtle bg-surface-sunken px-3 py-2.5">
                            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                                Account
                            </span>
                            <AuthControls compact />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
