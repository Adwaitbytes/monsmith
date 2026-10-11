import { NextResponse } from "next/server";
import { decodeJwt } from "jose";

import { privyConfigured, userFromIdentityToken } from "@/lib/auth/privy";
import { SESSION_COOKIE } from "@/lib/auth/session";

/**
 * Hands a Privy session to the server.
 *
 * After sign-in the browser posts its Privy identity token here; it is
 * verified before it is stored, and stored HttpOnly so page scripts cannot
 * read it. The cookie expires when the token does, and the browser posts a
 * fresh one as Privy refreshes it. DELETE ends the server side of a session.
 */

export const runtime = "nodejs";

export async function POST(req: Request) {
    if (!privyConfigured()) return NextResponse.json({ error: "Sign-in is not set up on this deployment." }, { status: 503 });

    let token: unknown;
    try {
        token = ((await req.json()) as { identityToken?: unknown }).identityToken;
    } catch {
        return NextResponse.json({ error: "Send { identityToken }." }, { status: 400 });
    }
    if (typeof token !== "string" || token.length === 0 || token.length > 16_384) {
        return NextResponse.json({ error: "Send { identityToken }." }, { status: 400 });
    }

    const user = await userFromIdentityToken(token);
    if (user === null) return NextResponse.json({ error: "That session could not be verified." }, { status: 401 });

    const expiresAt = decodeJwt(token).exp;
    const maxAge = typeof expiresAt === "number" ? Math.max(0, expiresAt - Math.floor(Date.now() / 1000)) : 3600;

    const response = NextResponse.json({ userId: user.id });
    response.cookies.set(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge,
    });
    return response;
}

export async function DELETE() {
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return response;
}
