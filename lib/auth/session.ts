/**
 * The cookie that carries a signed-in session to the server.
 *
 * It holds Privy's identity token, a JWT Privy signs with the user's id,
 * linked accounts and custom metadata. The server verifies it on every read
 * against Privy's published keys, so the cookie proves who is asking and what
 * they may do without a call to Privy per request. HttpOnly, so page scripts
 * cannot read or replace it.
 */
export const SESSION_COOKIE = "monsmith-session";
