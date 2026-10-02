"use client";

/**
 * A stable id for this browser.
 *
 * Without one, an anonymous visitor counts as a new user on every page load and
 * the totals become meaningless. It is random and carries no personal data; a
 * wallet address is attached separately only once the user connects one.
 *
 * Its own module, away from the analytics client that first needed it, because
 * report history is looked up by this id too. Reaching it through `lib/track`
 * meant anything that only wanted to read or rotate the id — sign-out, a
 * history request — pulled the whole analytics bundle in behind it.
 */

const VISITOR_KEY = "monsmith.visitor";

/*
  Mirrored into a cookie because the server renders shared report pages and
  cannot read localStorage. Without it, opening your own report in a new tab,
  which is what Download does, showed it locked as if to a stranger.
*/
function writeCookie(id: string): void {
  if (typeof document === "undefined") return;
  try {
    document.cookie = `${VISITOR_KEY}=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax${
      window.location.protocol === "https:" ? "; secure" : ""
    }`;
  } catch {
    // A blocked cookie only costs the server-rendered view of a locked report.
  }
}

function cookieHas(id: string): boolean {
  try {
    return typeof document !== "undefined" && document.cookie.includes(`${VISITOR_KEY}=${encodeURIComponent(id)}`);
  } catch {
    return false;
  }
}

export function visitorId(): string {
  if (typeof window === "undefined") return "";

  let id = window.localStorage.getItem(VISITOR_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(VISITOR_KEY, id);
  }
  if (!cookieHas(id)) writeCookie(id);
  return id;
}

/**
 * Starts a new anonymous identity, on sign-out.
 *
 * Report history is looked up by account when there is one and by this id when
 * there is not, so a browser that kept the same id after sign-out went on
 * listing the reports of whoever had just left. The reports themselves are not
 * touched: they stay under that account and come back when it signs in. This
 * only stops the next person at this keyboard from being handed them.
 */
export function resetVisitorId(): string {
  if (typeof window === "undefined") return "";

  const id = crypto.randomUUID();
  try {
    window.localStorage.setItem(VISITOR_KEY, id);
  } catch {
    // An unwritable store means the old id is already gone from this session.
  }
  writeCookie(id);
  return id;
}
