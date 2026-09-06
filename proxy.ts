import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

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
 */

const isProtected = createRouteMatcher(["/admin(.*)", "/api/admin(.*)"]);

export default clerkMiddleware(async (auth, request) => {
    if (isProtected(request)) {
        await auth.protect();
    }
});

export const config = {
    matcher: [
        // Everything except static assets and Next internals.
        "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp4)).*)",
        "/(api|trpc)(.*)",
        "/__clerk/:path*",
    ],
};
