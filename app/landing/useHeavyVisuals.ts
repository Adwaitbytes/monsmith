'use client';

import { useEffect, useState } from 'react';

/**
 * Whether this visitor should be sent the WebGL hero at all.
 *
 * The scene is eight hundred and forty kilobytes of three.js for a background
 * that is masked to a fade behind the headline. It is already code split, so it
 * does not hold up the first paint, but it is still downloaded by everyone who
 * opens the landing page, and the landing page is the one whose job is to
 * convert someone who has not decided to care yet.
 *
 * Three groups get the lighter page. Someone who asked for reduced motion was
 * already being shown a frozen frame, so the download bought them nothing at
 * all. Someone on a metered connection has said, in the only way a browser lets
 * them, that bytes cost money. And a machine reporting very few cores will
 * render it badly if it renders it at all.
 *
 * Everyone else gets the scene. This is not a downgrade dressed up as a
 * feature: the blueprint grid and the accent wash underneath carry the hero on
 * their own, which is why it is safe to drop the layer above them.
 *
 * Starts false and turns on after mount. Guessing during render would mean
 * shipping the decision into the HTML, where it would be wrong for half of
 * whoever the cache served it to.
 */
export function useHeavyVisuals(): boolean {
    const [allowed, setAllowed] = useState(false);

    useEffect(() => {
        const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

        const decide = () => {
            if (motion.matches) {
                setAllowed(false);
                return;
            }

            // `connection` is not in every browser, and its absence is not a
            // signal either way, so it only ever takes the answer away.
            const connection = (
                navigator as Navigator & {
                    connection?: { saveData?: boolean; effectiveType?: string };
                }
            ).connection;

            if (connection?.saveData === true) {
                setAllowed(false);
                return;
            }
            if (
                connection?.effectiveType !== undefined &&
                /^(slow-2g|2g|3g)$/.test(connection.effectiveType)
            ) {
                setAllowed(false);
                return;
            }

            const cores = navigator.hardwareConcurrency;
            if (typeof cores === 'number' && cores > 0 && cores <= 2) {
                setAllowed(false);
                return;
            }

            setAllowed(true);
        };

        decide();
        motion.addEventListener('change', decide);
        return () => motion.removeEventListener('change', decide);
    }, []);

    return allowed;
}
