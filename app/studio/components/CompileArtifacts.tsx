'use client';

import React, { useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';

/**
 * What a compile produced, in a form you can take away.
 *
 * Remix puts the ABI and the bytecode one click from a successful compile, and
 * that is not a small convenience: the ABI is what every frontend, script and
 * verification step needs next, and a studio that compiles but will not hand it
 * over sends you to a terminal to do the compile again somewhere useful.
 *
 * Copy and download both, because the two have different destinations. Copy is
 * for pasting into a script that is already open; download is for the file a
 * deploy pipeline expects to find on disk. Offering only one of them means half
 * the people have to do the conversion themselves.
 *
 * Shown only after a compile succeeds, because the compile is what produces
 * them. Deploying adds an address on a chain; it does not add an ABI, and a
 * panel that appeared at deploy time would teach the opposite.
 *
 * Renders rows only. The heading, the chevron and the collapsed state belong to
 * the side panel, which has three of these to keep looking like one thing.
 */

export interface CompileArtifactsProps {
    contractName: string;
    abi: unknown[] | null;
    bytecode: string | null;
    /** Runtime bytecode, which is what an explorer compares against. */
    deployedBytecode?: string | null;
    onNotify?: (message: string) => void;
}

function download(filename: string, contents: string, type: string): void {
    const blob = new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
}

function Row({
    label,
    hint,
    onCopy,
    onDownload,
    copied,
}: {
    label: string;
    hint: string;
    onCopy: () => void;
    onDownload: () => void;
    copied: boolean;
}) {
    /*
      Two lines, not one.

      Written as a single row — label on the left, Copy and Download on the
      right — the two buttons are about 150px of unshrinkable content, and this
      column is a resizable 260. The label had nowhere left to go and printed
      itself over the buttons. Stacking gives the actions the full width at any
      panel size, and the pair reads as one control rather than two crowded ones.
    */
    return (
        <div className="rounded-lg border border-border-subtle bg-surface-sunken p-2.5">
            <div className="flex items-baseline justify-between gap-2">
                <p className="shrink-0 text-[12px] font-medium text-text-primary">{label}</p>
                <p className="truncate font-mono text-[10px] text-text-muted">{hint}</p>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
                <button
                    onClick={onCopy}
                    className="flex items-center justify-center gap-1.5 rounded-md border border-border-subtle bg-surface-base px-2 py-1.5 text-[11.5px] text-text-secondary outline-none ring-accent-line transition-colors hover:border-border-strong hover:text-text-primary focus-visible:ring-2"
                >
                    {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                    {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                    onClick={onDownload}
                    className="flex items-center justify-center gap-1.5 rounded-md border border-border-subtle bg-surface-base px-2 py-1.5 text-[11.5px] text-text-secondary outline-none ring-accent-line transition-colors hover:border-border-strong hover:text-text-primary focus-visible:ring-2"
                >
                    <Download size={12} />
                    Download
                </button>
            </div>
        </div>
    );
}

export function CompileArtifacts({
    contractName,
    abi,
    bytecode,
    deployedBytecode,
    onNotify,
}: CompileArtifactsProps) {
    const [copied, setCopied] = useState<string | null>(null);

    if (abi === null && bytecode === null) return null;

    const mark = (what: string) => {
        setCopied(what);
        // Reverting the label is what tells you the click registered, so it has
        // to happen even if nothing else on the page changes.
        window.setTimeout(() => setCopied((current) => (current === what ? null : current)), 1600);
    };

    const abiText = abi === null ? '' : JSON.stringify(abi, null, 2);
    const functions = abi === null ? 0 : abi.filter((entry) => {
        return typeof entry === 'object' && entry !== null && (entry as { type?: string }).type === 'function';
    }).length;

    return (
        <div className="space-y-2 px-3 pb-3">
            {abi !== null && (
                <Row
                    label="ABI"
                    hint={`${functions} fn${functions === 1 ? '' : 's'} · ${(abiText.length / 1024).toFixed(1)} KB`}
                    copied={copied === 'abi'}
                    onCopy={() => {
                        void navigator.clipboard.writeText(abiText);
                        mark('abi');
                        onNotify?.('ABI copied.');
                    }}
                    onDownload={() => {
                        download(`${contractName}.abi.json`, abiText, 'application/json');
                        onNotify?.(`Downloaded ${contractName}.abi.json`);
                    }}
                />
            )}

            {bytecode !== null && bytecode.length > 0 && (
                <Row
                    label="Bytecode"
                    hint={`Creation · ${(bytecode.length / 2 / 1024).toFixed(1)} KB`}
                    copied={copied === 'bytecode'}
                    onCopy={() => {
                        void navigator.clipboard.writeText(bytecode);
                        mark('bytecode');
                        onNotify?.('Bytecode copied.');
                    }}
                    onDownload={() => {
                        download(`${contractName}.bin`, bytecode, 'text/plain');
                        onNotify?.(`Downloaded ${contractName}.bin`);
                    }}
                />
            )}

            {deployedBytecode !== null && deployedBytecode !== undefined && deployedBytecode.length > 0 && (
                <Row
                    label="Runtime bytecode"
                    hint={`Runtime · ${(deployedBytecode.length / 2 / 1024).toFixed(1)} KB`}
                    copied={copied === 'runtime'}
                    onCopy={() => {
                        void navigator.clipboard.writeText(deployedBytecode);
                        mark('runtime');
                        onNotify?.('Runtime bytecode copied.');
                    }}
                    onDownload={() => {
                        download(`${contractName}.runtime.bin`, deployedBytecode, 'text/plain');
                        onNotify?.(`Downloaded ${contractName}.runtime.bin`);
                    }}
                />
            )}

            {/* One file with everything, which is what a deploy script expects. */}
            {abi !== null && bytecode !== null && (
                <button
                    onClick={() => {
                        download(
                            `${contractName}.json`,
                            JSON.stringify(
                                { contractName, abi, bytecode, deployedBytecode: deployedBytecode ?? null },
                                null,
                                2,
                            ),
                            'application/json',
                        );
                        onNotify?.(`Downloaded ${contractName}.json`);
                    }}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border-subtle px-3 py-2 text-[12px] font-medium text-text-secondary outline-none ring-accent-line transition-colors hover:border-border-strong hover:text-text-primary focus-visible:ring-2"
                >
                    <Download size={12} />
                    Download full artifact
                </button>
            )}
        </div>
    );
}
