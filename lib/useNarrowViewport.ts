'use client';

import { useEffect, useState } from 'react';

/**
 * Whether the window is too narrow to carry every dock at once.
 *
 * The studio has five columns when everything is open: the activity bar, the
 * side bar, the editor, the report rail and sometimes a tool panel. At a
 * comfortable width that is fine. On a small laptop the editor is squeezed to
 * its three hundred and twenty pixel floor, which is not enough to read a line
 * of Solidity without wrapping, and the thing the studio exists to show becomes
 * the thing with least room.
 *
 * So the right dock stands down below this width. Not removed: a toggle still
 * opens it, and opening it is a deliberate choice to trade the editor for the
 * report. What changes is the default, which should favour the code.
 *
 * Rendered false on the server and corrected after mount, because guessing a
 * viewport during SSR is how a layout arrives wrong and then jumps.
 */
const NARROW_BELOW = 1100;

export function useNarrowViewport(breakpoint: number = NARROW_BELOW): boolean {
    const [narrow, setNarrow] = useState(false);

    useEffect(() => {
        const query = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
        const apply = () => setNarrow(query.matches);

        apply();
        query.addEventListener('change', apply);
        return () => query.removeEventListener('change', apply);
    }, [breakpoint]);

    return narrow;
}
