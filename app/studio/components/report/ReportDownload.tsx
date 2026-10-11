'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, FileDown, FileText, KeyRound, Loader2 } from 'lucide-react';

import { useAuthState } from '@/lib/auth/client';
import { reportFileName, reportToMarkdown } from '@/lib/report/markdown';
import { explainSealError, sealWithPasskey } from '@/lib/seal/sealedReport';
import type { RepoReport } from '@/lib/report/types';

/**
 * Download, in the two formats people ask for.
 *
 * PDF for sending to someone, produced by the browser's own print-to-PDF so it
 * is exactly the report on screen with every finding opened. Markdown for doing
 * something with it: a pull request, an issue, a doc in the repository.
 * Sealed for an audit of private code: the Markdown encrypted to the reader's
 * passkey with Mera, so the file is safe to keep anywhere and opens only at
 * /open with that passkey.
 */

export interface ReportDownloadProps {
    report: RepoReport;
    /** Produces the PDF; the host decides whether that is printing here or opening the report page. */
    onPdf: () => void;
}

const ITEM =
    'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-surface-sunken focus-visible:bg-surface-sunken';

export function ReportDownload({ report, onPdf }: ReportDownloadProps) {
    const [open, setOpen] = useState(false);
    const [sealing, setSealing] = useState(false);
    const [sealError, setSealError] = useState<string | null>(null);
    const { email } = useAuthState();
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onPointer = (event: PointerEvent) => {
            if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false);
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        window.addEventListener('pointerdown', onPointer);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('pointerdown', onPointer);
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const save = (blob: Blob, name: string) => {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = name;
        anchor.click();
        URL.revokeObjectURL(url);
    };

    const markdown = () => reportToMarkdown(report, `${window.location.origin}/report/${report.reportId}`);

    const downloadMarkdown = () => {
        save(new Blob([markdown()], { type: 'text/markdown' }), reportFileName(report, 'md'));
        setOpen(false);
    };

    const downloadSealed = async () => {
        setSealing(true);
        setSealError(null);
        try {
            const title = reportFileName(report, 'md').replace(/\.md$/, '');
            const sealed = await sealWithPasskey({ reportId: report.reportId, title, markdown: markdown() }, email);
            save(new Blob([JSON.stringify(sealed, null, 2)], { type: 'application/json' }), `${title}.sealed.json`);
            setOpen(false);
        } catch (error) {
            setSealError(explainSealError(error));
        } finally {
            setSealing(false);
        }
    };

    return (
        <div ref={rootRef} className="relative print:hidden">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                aria-haspopup="menu"
                aria-expanded={open}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border-subtle px-2.5 py-1 text-[11.5px] font-medium text-text-secondary outline-none ring-accent-line transition-colors hover:border-border-strong hover:text-text-primary focus-visible:ring-2"
            >
                <Download size={12} aria-hidden />
                Download
            </button>
            {open && (
                <div
                    role="menu"
                    className="absolute right-0 top-full z-30 mt-1.5 w-72 rounded-xl border border-border-subtle bg-surface-raised p-1 shadow-[var(--shadow-panel)]"
                >
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                            setOpen(false);
                            onPdf();
                        }}
                        className={ITEM}
                    >
                        <FileDown size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                        <span>
                            <span className="block text-[12.5px] font-medium text-text-primary">PDF</span>
                            <span className="block text-[11px] text-text-muted">The full report, every finding open</span>
                        </span>
                    </button>
                    <button type="button" role="menuitem" onClick={downloadMarkdown} className={ITEM}>
                        <FileText size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                        <span>
                            <span className="block text-[12.5px] font-medium text-text-primary">Markdown</span>
                            <span className="block text-[11px] text-text-muted">For a pull request, issue or repo doc</span>
                        </span>
                    </button>
                    <button type="button" role="menuitem" onClick={() => void downloadSealed()} disabled={sealing} className={`${ITEM} disabled:cursor-wait`}>
                        {sealing ? (
                            <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin text-accent motion-reduce:animate-none" aria-hidden />
                        ) : (
                            <KeyRound size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                        )}
                        <span>
                            <span className="block text-[12.5px] font-medium text-text-primary">Sealed to your passkey</span>
                            <span className="block text-[11px] text-text-muted">Encrypted in this browser; opens only with your passkey at monsmith.com/open</span>
                        </span>
                    </button>
                    {sealError !== null && (
                        <p role="alert" className="mx-1 mb-1 rounded-lg bg-red-500/[0.08] px-2.5 py-2 text-[11px] leading-relaxed text-red-700 dark:text-red-300">
                            {sealError}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
