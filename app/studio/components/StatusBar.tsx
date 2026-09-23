'use client';

import React from 'react';
import { AlertTriangle, Check, Circle, Loader2, Wallet, XCircle } from 'lucide-react';

/**
 * The bottom strip, in the VS Code sense.
 *
 * Network and wallet were put in a dropdown when the toolbar was cut, which was
 * the wrong home for them. They are not actions, they are state, and state you
 * have to open a menu to read is state you will get wrong. A deploy that went
 * to mainnet because nobody remembered which network was selected is exactly
 * the class of mistake this strip exists to prevent.
 *
 * Twenty-two pixels, always visible, never in the way. It costs almost no space
 * because it carries no chrome: no borders around each item, no buttons that
 * look like buttons, just readable state with the two entries that can change
 * something behaving as controls when you reach for them.
 *
 * Mainnet is the one thing here allowed to shout. Everything else stays quiet.
 */

export interface StatusBarProps {
    network: 'testnet' | 'mainnet';
    onNetworkClick: () => void;
    wallet: string | null;
    onWalletClick: () => void;
    /** Formatted MON on the selected network. Null while unknown. */
    balance?: string | null;
    /** True when the wallet is connected to a different chain than selected. */
    wrongNetwork?: boolean;
    /** Errors and warnings from the last compile, and findings from the audit. */
    problems: { errors: number; warnings: number };
    onProblemsClick: () => void;
    compileState: 'idle' | 'working' | 'ok' | 'failed';
    /** Compiler the pragma resolved to, which people do check. */
    solcVersion?: string;
    language: 'solidity' | 'python';
    /** Where the caret is. Absent until the editor reports one. */
    cursor?: { line: number; column: number };
}

function Item({
    children,
    onClick,
    title,
    tone = 'plain',
}: {
    children: React.ReactNode;
    onClick?: () => void;
    title?: string;
    tone?: 'plain' | 'alert';
}) {
    const base =
        'flex h-full items-center gap-1.5 px-2.5 text-[11.5px] transition-colors outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent';
    const tones = {
        plain: 'text-text-secondary hover:bg-border-subtle/70 hover:text-text-primary',
        // Red on the whole item rather than a red dot beside grey text: the
        // point is that mainnet should be impossible to miss at a glance.
        alert: 'bg-red-500/15 text-red-700 hover:bg-red-500/25 dark:text-red-300',
    } as const;

    if (onClick === undefined) {
        return (
            <span className={`${base} ${tones[tone]}`} title={title}>
                {children}
            </span>
        );
    }
    return (
        <button onClick={onClick} className={`${base} ${tones[tone]}`} title={title}>
            {children}
        </button>
    );
}

const COMPILE_VIEW = {
    idle: { icon: <Circle size={11} />, text: 'Not compiled' },
    working: {
        icon: <Loader2 size={11} className="animate-spin motion-reduce:animate-none" />,
        text: 'Compiling',
    },
    ok: { icon: <Check size={11} />, text: 'Compiled' },
    failed: { icon: <XCircle size={11} />, text: 'Compile failed' },
} as const;

export function StatusBar({
    network,
    onNetworkClick,
    wallet,
    onWalletClick,
    balance,
    wrongNetwork = false,
    problems,
    onProblemsClick,
    compileState,
    solcVersion,
    language,
    cursor,
}: StatusBarProps) {
    const compile = COMPILE_VIEW[compileState];

    return (
        <footer
            aria-label="Status"
            className="flex h-[22px] shrink-0 items-stretch justify-between border-t border-border-subtle bg-surface-raised"
        >
            <div className="flex items-stretch">
                <Item
                    onClick={onNetworkClick}
                    tone={network === 'mainnet' ? 'alert' : 'plain'}
                    title="Change network"
                >
                    <span
                        aria-hidden
                        className={`h-1.5 w-1.5 rounded-full ${
                            network === 'mainnet' ? 'bg-red-500' : 'bg-emerald-500'
                        }`}
                    />
                    Monad {network}
                </Item>

                <Item
                    onClick={onProblemsClick}
                    title="Errors and warnings"
                >
                    <XCircle size={11} />
                    <span className="tabular-nums">{problems.errors}</span>
                    <AlertTriangle size={11} className="ml-1" />
                    <span className="tabular-nums">{problems.warnings}</span>
                </Item>

                <Item title="Last compile">
                    {compile.icon}
                    {compile.text}
                </Item>
            </div>

            <div className="flex items-stretch">
                {cursor !== undefined && (
                    <Item title="Cursor position">
                        Ln {cursor.line}, Col {cursor.column}
                    </Item>
                )}

                <Item title="Language">{language === 'python' ? 'Python' : 'Solidity'}</Item>

                {solcVersion !== undefined && solcVersion.length > 0 && (
                    <Item title="Compiler resolved from the pragma">solc {solcVersion}</Item>
                )}

                {/*
                  The balance sits next to the address because the question is
                  always "can this wallet pay for what I am about to do", and
                  answering it after the signing dialog fails is too late.
                */}
                {wallet !== null && (wrongNetwork || balance !== null) && (
                    <Item
                        title={
                            wrongNetwork
                                ? 'Your wallet is on a different network than the studio is set to'
                                : 'Balance on the selected network'
                        }
                        tone={wrongNetwork ? 'alert' : 'plain'}
                    >
                        {wrongNetwork ? 'Wrong network' : `${balance} MON`}
                    </Item>
                )}

                <Item
                    onClick={onWalletClick}
                    title={wallet === null ? 'Connect a wallet' : 'Wallet'}
                >
                    <Wallet size={11} />
                    {wallet === null ? (
                        'No wallet'
                    ) : (
                        <span className="font-mono">
                            {wallet.slice(0, 6)}…{wallet.slice(-4)}
                        </span>
                    )}
                </Item>
            </div>
        </footer>
    );
}
