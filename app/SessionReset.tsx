'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';

import { resetVisitorId } from '@/lib/visitor';
import { clearWorkspace } from '@/lib/workspace';

/**
 * Signing out takes the session's work with it.
 *
 * The studio keeps files in the browser so it works without an account, and
 * report history falls back to an anonymous id for the same reason. Neither
 * knew that a session had ended, so signing out left the tree full of whatever
 * had been imported — a private repository's contents, in the case that
 * prompted this — and the history still listing the reports of whoever had just
 * left. On a shared machine that is the next person's view of it.
 *
 * Nothing is deleted on the server. Those reports stay under that account and
 * come back when it signs in; this clears what this browser is holding.
 *
 * Only a real transition counts. A visitor who was never signed in is not
 * signing out, and wiping their files because Clerk resolved to "nobody" would
 * be the more destructive bug.
 */
export function SessionReset() {
    const { isLoaded, userId } = useAuth();
    const signedInAs = useRef<string | null>(null);

    useEffect(() => {
        if (!isLoaded) return;

        if (userId !== null && userId !== undefined) {
            signedInAs.current = userId;
            return;
        }

        if (signedInAs.current === null) return;
        signedInAs.current = null;

        clearWorkspace();
        resetVisitorId();

        /*
          Reload so nothing outlives the session in memory.

          Clearing the stores empties the file tree, but the panels around it
          hold their own copies of the same session: the compiled artifacts, the
          report on screen, the name of the repository in the title bar. A
          reload is the only thing that takes all of them, and the page it comes
          back on is the one a signed-out visitor should have been looking at.
        */
        window.location.reload();
    }, [isLoaded, userId]);

    return null;
}
