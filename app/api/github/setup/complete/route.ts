import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse } from "next/server";

/**
 * Turning GitHub's one-time code into credentials on disk.
 *
 * GitHub hands back the app id, the slug and a freshly generated private key
 * exactly once, in the response to this exchange. The obvious thing to do with
 * them is print them on a page for copying, and that is the thing to avoid: a
 * private key rendered in a browser is a private key in a tab's history, in a
 * screenshot, and in whatever the user pastes it into next.
 *
 * So the credentials go straight from the API response into `.env.local` and
 * are never rendered. The page that comes back names the app and says what was
 * written, which is all a person needs to know to carry on.
 *
 * This is why the flow is development only. Writing secrets into a file beside
 * the source is correct on the machine that owns the source and wrong anywhere
 * else, and a serverless filesystem would lose them on the next request anyway.
 */

export const runtime = "nodejs";

interface Conversion {
    id: number;
    slug: string;
    name: string;
    pem: string;
    html_url: string;
    owner?: { login?: string };
}

function isConversion(value: unknown): value is Conversion {
    if (typeof value !== "object" || value === null) return false;
    const record = value as Record<string, unknown>;
    return (
        typeof record.id === "number" &&
        typeof record.slug === "string" &&
        typeof record.pem === "string" &&
        record.pem.includes("PRIVATE KEY")
    );
}

/**
 * Merges keys into `.env.local` without disturbing what is already there.
 *
 * Rewriting the file wholesale would be simpler and would also silently discard
 * the API keys and database URL already in it, so existing lines are replaced in
 * place and anything unknown is appended.
 */
async function mergeEnv(path: string, values: Record<string, string>): Promise<string[]> {
    let existing = "";
    try {
        existing = await readFile(path, "utf8");
    } catch {
        // No file yet is a normal first run, not a failure.
    }

    const lines = existing.length > 0 ? existing.split("\n") : [];
    const written: string[] = [];

    for (const [key, value] of Object.entries(values)) {
        // Newlines inside a PEM have to be escaped, since a dotenv file is line
        // oriented and the loader on the other side un-escapes them.
        const encoded = value.includes("\n") ? `"${value.replace(/\n/g, "\\n")}"` : value;
        const line = `${key}=${encoded}`;
        const at = lines.findIndex((entry) => entry.startsWith(`${key}=`));

        if (at === -1) lines.push(line);
        else lines[at] = line;
        written.push(key);
    }

    const body = lines.join("\n");
    await writeFile(path, body.endsWith("\n") ? body : `${body}\n`, "utf8");
    return written;
}

function page(title: string, body: string): NextResponse {
    return new NextResponse(
        `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         font:15px/1.6 ui-sans-serif, system-ui, sans-serif; background:#f7f7fa; color:#16161a; }
  @media (prefers-color-scheme: dark){ body{ background:#0a0a0f; color:#f2f2f5; } }
  main{ max-width:34rem; padding:2rem; }
  h1{ font-size:1.35rem; margin:0 0 .75rem; letter-spacing:-0.01em; }
  code{ font-family:ui-monospace, monospace; font-size:13px; opacity:.85; }
  a{ color:#7c5cff; }
</style></head>
<body><main>${body}</main></body></html>`,
        { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
    );
}

export async function GET(req: Request) {
    if (process.env.NODE_ENV === "production") {
        return NextResponse.json(
            { error: "This step writes credentials to a local file and does not run on a server." },
            { status: 403 },
        );
    }

    const code = new URL(req.url).searchParams.get("code");
    if (code === null || code.length === 0) {
        return page(
            "Nothing to convert",
            `<h1>Nothing to convert</h1><p>GitHub did not send a code. Start again at
             <a href="/api/github/setup">/api/github/setup</a>.</p>`,
        );
    }

    let conversion: unknown;
    try {
        const response = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
            method: "POST",
            headers: {
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "monsmith-setup",
            },
        });

        if (!response.ok) {
            // The code is single use and short lived, which is the usual cause.
            return page(
                "GitHub refused the exchange",
                `<h1>GitHub refused the exchange</h1>
                 <p>Status ${response.status}. The code is single use and expires quickly, so
                 start again at <a href="/api/github/setup">/api/github/setup</a>.</p>`,
            );
        }
        conversion = await response.json();
    } catch (error) {
        console.error("GitHub app manifest conversion failed:", error);
        return page(
            "Could not reach GitHub",
            `<h1>Could not reach GitHub</h1><p>Check the network and try again.</p>`,
        );
    }

    if (!isConversion(conversion)) {
        console.error("GitHub app manifest conversion returned an unexpected shape");
        return page(
            "Unexpected response",
            `<h1>Unexpected response</h1><p>GitHub's reply did not contain an app id and a key.</p>`,
        );
    }

    let written: string[];
    try {
        written = await mergeEnv(join(process.cwd(), ".env.local"), {
            GITHUB_APP_ID: String(conversion.id),
            GITHUB_APP_SLUG: conversion.slug,
            GITHUB_APP_PRIVATE_KEY: conversion.pem,
        });
    } catch (error) {
        console.error("Could not write .env.local:", error);
        return page(
            "Could not write .env.local",
            `<h1>Could not write .env.local</h1>
             <p>The app was created on GitHub but its credentials could not be saved. Generate a
             new private key from the app's settings page and set the variables by hand.</p>`,
        );
    }

    // The id and slug are not secret; the key is, and is deliberately absent.
    return page(
        "GitHub App registered",
        `<h1>GitHub App registered</h1>
         <p><strong>${conversion.name}</strong> now exists on your account.</p>
         <p>Written to <code>.env.local</code>: ${written.join(", ")}. The private key was saved
            straight to the file and is not shown here.</p>
         <p>Next: install it on the account whose repositories you want to audit, at
            <a href="https://github.com/apps/${conversion.slug}/installations/new">
            github.com/apps/${conversion.slug}</a>, then restart the dev server.</p>`,
    );
}
