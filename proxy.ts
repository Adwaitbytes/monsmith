import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/lib/auth/session";

/**
 * Request proxy.
 *
 * Everything is public by default and only the admin surface is protected.
 * That is a product decision rather than an omission: /compare is the argument
 * we want people to read without an account, /embed has to render inside
 * someone else's documentation, /share exists so a link works for a person who
 * has never heard of us, and the studio is worth more as something you can try
 * than as something you must sign up for. Signing in adds capability; it is
 * never the price of entry.
 *
 * This only turns away requests to the admin surface that carry no session at
 * all. Whether the session is valid, and whether it belongs to an admin, is
 * decided by the page and route themselves, next to the data they guard.
 */

export function proxy(request: NextRequest) {
    if (request.cookies.get(SESSION_COOKIE) === undefined) {
        if (request.nextUrl.pathname.startsWith("/api/")) {
            return NextResponse.json({ error: "Sign in first." }, { status: 401 });
        }
        return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
}

export const config = {
    matcher: ["/admin/:path*", "/api/admin/:path*"],
};
