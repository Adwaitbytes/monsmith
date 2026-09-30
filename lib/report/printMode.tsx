'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

/**
 * Whether the report is being printed, so everything collapsible opens.
 *
 * A PDF of a report with its findings folded shut is a PDF of titles. The
 * browser announces printing with `beforeprint`, and the state is flushed
 * synchronously there so the expanded layout exists before the browser takes
 * its snapshot; an ordinary state update would land after it.
 */

const PrintModeContext = createContext(false);

export function PrintModeProvider({ children }: { children: React.ReactNode }) {
    const [printing, setPrinting] = useState(false);

    useEffect(() => {
        const before = () => flushSync(() => setPrinting(true));
        const after = () => setPrinting(false);
        window.addEventListener('beforeprint', before);
        window.addEventListener('afterprint', after);
        return () => {
            window.removeEventListener('beforeprint', before);
            window.removeEventListener('afterprint', after);
        };
    }, []);

    return <PrintModeContext.Provider value={printing}>{children}</PrintModeContext.Provider>;
}

export function usePrinting(): boolean {
    return useContext(PrintModeContext);
}
