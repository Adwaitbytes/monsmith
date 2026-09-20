import { NextResponse } from "next/server";

/**
 * One-click registration of the GitHub App.
 *
 * Registering a GitHub App normally means a ten field form, a private key that
 * downloads as a file, and three secrets copied by hand into an environment.
 * Every one of those steps is a chance to mistype a permission or to leave a
 * key sitting in a Downloads folder, and the permissions are the part that
 * matters most here: this app asks for read access to repository contents and
 * must never ask for more.
 *
 * GitHub's app manifest flow exists for exactly this. The manifest below states
 * the permissions, the URLs and the webhook setting as data, GitHub shows the
 * user one confirmation screen, and the credentials come back over the wire
 * rather than through a browser download. The settings cannot drift from what
 * was intended, because they are declared here and reviewed on GitHub's own
 * screen before anything is created.
 *
 * Development only. The conversion step writes real secrets to a local file,
 * which is right on a developer's machine and wrong on a server, so both halves
 * of this flow refuse to run in production.
 */

export const runtime = "nodejs";

/** The exact app being asked for. Nothing here is negotiable at runtime. */
function manifest(origin: string, productionUrl: string) {
    return {
        name: "Monsmith Contract Audit",
        url: productionUrl,
        description:
            "Imports Solidity from your repositories so Monsmith can audit it. Reads repository contents and nothing else.",
        // Where GitHub returns the one-time conversion code.
        redirect_url: `${origin}/api/github/setup/complete`,
        // Where a user lands after installing the app on an account. This is
        // the deployed site rather than the local one, because installs happen
        // against production even when the app was registered from a laptop.
        setup_url: `${productionUrl}/api/github/callback`,
        setup_on_update: true,
        hook_attributes: { active: false },
        public: true,
        default_events: [],
        // The whole point of choosing an App over an OAuth App. `contents:read`
        // on repositories the user individually selects, rather than read and
        // write across every private repository they can see.
        default_permissions: {
            contents: "read",
            metadata: "read",
        },
        request_oauth_on_install: false,
    };
}

export async function GET(req: Request) {
    if (process.env.NODE_ENV === "production") {
        return NextResponse.json(
            {
                error:
                    "App registration runs on a development machine, because it writes credentials to a local file. Run it against localhost.",
            },
            { status: 403 },
        );
    }

    const origin = new URL(req.url).origin;
    const productionUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.monsmith.com").replace(
        /\/$/,
        "",
    );

    const payload = JSON.stringify(manifest(origin, productionUrl));

    // A form POST is the only way in: GitHub reads the manifest from a form
    // field, not from a query string, so this page exists to submit one.
    const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Register the Monsmith GitHub App</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         font: 15px/1.6 ui-sans-serif, system-ui, sans-serif; background: #f7f7fa; color: #16161a; }
  @media (prefers-color-scheme: dark) { body { background: #0a0a0f; color: #f2f2f5; } }
  main { max-width: 32rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.35rem; margin: 0 0 .75rem; letter-spacing: -0.01em; }
  p { margin: 0 0 1.5rem; opacity: .75; }
  button { font: inherit; font-weight: 600; padding: .7rem 1.4rem; border: 0; border-radius: .6rem;
           background: #7c5cff; color: #fff; cursor: pointer; }
  ul { text-align: left; opacity: .75; font-size: 13.5px; }
</style>
</head>
<body>
<main>
  <h1>Register the Monsmith GitHub App</h1>
  <p>GitHub will show you a confirmation screen. The app asks for read access to
     repository contents, nothing else, and you choose which repositories it can see.</p>
  <ul>
    <li>Permissions: Contents (read), Metadata (read)</li>
    <li>Webhooks: off</li>
    <li>Install target: ${productionUrl}</li>
  </ul>
  <form id="f" method="post" action="https://github.com/settings/apps/new">
    <input type="hidden" name="manifest" id="manifest">
    <button type="submit">Continue to GitHub</button>
  </form>
  <script>
    document.getElementById('manifest').value = ${JSON.stringify(payload)};
  </script>
</main>
</body>
</html>`;

    return new NextResponse(page, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
}
