'use client';

import React, { useRef, useState } from 'react';
import { Download, FileLock2, KeyRound, Loader2, LockOpen, Upload } from 'lucide-react';

import { explainSealError, openWithPasskey, parseSealed, type SealedContent, type SealedFile } from '@/lib/seal/sealedReport';

/**
 * Opening a sealed report.
 *
 * The file is read and decrypted entirely in the browser: the passkey derives
 * the key through WebAuthn PRF, Mera decrypts the vault, and nothing about the
 * file or its contents is sent anywhere.
 */

type State =
    | { kind: 'empty' }
    | { kind: 'loaded'; file: SealedFile }
    | { kind: 'opening'; file: SealedFile }
    | { kind: 'open'; file: SealedFile; content: SealedContent }
    | { kind: 'error'; message: string; file?: SealedFile };

export function OpenSealed() {
    const [state, setState] = useState<State>({ kind: 'empty' });
    const [dragging, setDragging] = useState(false);
    const input = useRef<HTMLInputElement>(null);

    const load = async (blob: File) => {
        try {
            setState({ kind: 'loaded', file: parseSealed(await blob.text()) });
        } catch (error) {
            setState({ kind: 'error', message: error instanceof Error ? error.message : 'Could not read that file.' });
        }
    };

    const unlock = async (file: SealedFile) => {
        setState({ kind: 'opening', file });
        try {
            setState({ kind: 'open', file, content: await openWithPasskey(file) });
        } catch (error) {
            setState({ kind: 'error', message: explainSealError(error), file });
        }
    };

    const downloadMarkdown = (content: SealedContent) => {
        const url = URL.createObjectURL(new Blob([content.markdown], { type: 'text/markdown' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${content.title}.md`;
        anchor.click();
        URL.revokeObjectURL(url);
    };

    const file = state.kind === 'empty' ? null : state.kind === 'error' ? (state.file ?? null) : state.file;

    return (
        <main className="mx-auto max-w-2xl px-6 py-14 sm:py-20">
            <p className="inline-flex items-center gap-1.5 rounded-full border border-accent-line bg-accent-soft px-2.5 py-1 text-[11.5px] font-medium text-accent">
                <KeyRound size={12} aria-hidden />
                Sealed with your passkey
            </p>
            <h1 className="mt-5 text-balance font-display text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[42px]">
                Open a sealed report.
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-text-secondary">
                An audit of private code says where that code breaks. A sealed report is encrypted to the passkey that sealed it, using a key
                derived from it with Mera, so the file is safe to keep anywhere. It is opened here, in your browser; neither the file nor the key
                is sent anywhere.
            </p>

            {state.kind !== 'open' && (
                <div
                    onDragOver={(event) => {
                        event.preventDefault();
                        setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(event) => {
                        event.preventDefault();
                        setDragging(false);
                        const dropped = event.dataTransfer.files[0];
                        if (dropped !== undefined) void load(dropped);
                    }}
                    className={`mt-8 rounded-2xl border border-dashed p-8 text-center transition-colors ${dragging ? 'border-accent bg-accent-soft' : 'border-border-strong bg-surface-raised'}`}
                >
                    {file === null ? (
                        <>
                            <Upload size={22} className="mx-auto text-text-muted" aria-hidden />
                            <p className="mt-3 text-[14px] font-medium">Drop a .sealed.json file here</p>
                            <button
                                type="button"
                                onClick={() => input.current?.click()}
                                className="mt-3 rounded-lg border border-border-subtle px-3.5 py-1.5 text-[13px] font-medium text-text-secondary outline-none ring-accent-line hover:text-text-primary focus-visible:ring-2"
                            >
                                Choose a file
                            </button>
                        </>
                    ) : (
                        <>
                            <FileLock2 size={22} className="mx-auto text-accent" aria-hidden />
                            <p className="mt-3 text-[14px] font-medium">{file.title}</p>
                            <p className="mt-1 text-[12px] text-text-muted">Sealed {new Date(file.sealedAt).toUTCString()}</p>
                            <button
                                type="button"
                                onClick={() => void unlock(file)}
                                disabled={state.kind === 'opening'}
                                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white outline-none ring-accent-line ring-offset-2 ring-offset-surface-raised transition-opacity hover:opacity-90 focus-visible:ring-2 disabled:opacity-70"
                            >
                                {state.kind === 'opening' ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <LockOpen size={14} aria-hidden />}
                                Open with my passkey
                            </button>
                        </>
                    )}
                    <input
                        ref={input}
                        type="file"
                        accept=".json,application/json"
                        className="hidden"
                        onChange={(event) => {
                            const chosen = event.target.files?.[0];
                            if (chosen !== undefined) void load(chosen);
                        }}
                    />
                </div>
            )}

            <div aria-live="polite">
                {state.kind === 'error' && (
                    <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/[0.08] px-4 py-3 text-[13px] text-text-secondary">{state.message}</p>
                )}
            </div>

            {state.kind === 'open' && (
                <section className="mt-8 overflow-hidden rounded-2xl border border-border-subtle bg-surface-raised shadow-[var(--shadow-panel)]">
                    <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-5 py-3">
                        <p className="flex items-center gap-2 text-[13px] font-medium">
                            <LockOpen size={14} className="text-emerald-600 dark:text-emerald-400" aria-hidden />
                            {state.content.title}
                        </p>
                        <button
                            type="button"
                            onClick={() => downloadMarkdown(state.content)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-2.5 py-1 text-[12px] font-medium text-text-secondary outline-none ring-accent-line hover:text-text-primary focus-visible:ring-2"
                        >
                            <Download size={12} aria-hidden />
                            Markdown
                        </button>
                    </div>
                    <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words px-5 py-4 font-mono text-[12.5px] leading-relaxed text-text-secondary">
                        {state.content.markdown}
                    </pre>
                </section>
            )}
        </main>
    );
}
