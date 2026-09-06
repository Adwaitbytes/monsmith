'use client';

import { useEffect, useState } from 'react';

import { ANONYMOUS, type Viewer } from './roles';

/**
 * The current viewer, for client components.
 *
 * Starts anonymous and upgrades once the server answers, which is the correct
 * default: every surface has to render for a signed-out visitor anyway, so
 * there is no loading state worth showing and no layout shift beyond the
 * account button appearing.
 */
export function useViewer(): { viewer: Viewer; loading: boolean } {
    const [viewer, setViewer] = useState<Viewer>(ANONYMOUS);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;

        fetch('/api/me')
            .then((response) => (response.ok ? response.json() : null))
            .then((data) => {
                if (cancelled || data === null) return;
                setViewer(data as Viewer);
            })
            .catch(() => {
                // Staying anonymous is the right failure mode.
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    return { viewer, loading };
}
