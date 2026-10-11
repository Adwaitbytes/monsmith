import type { NextConfig } from "next";

import { BUILDER_GUIDE_PATH, BUILDER_GUIDE_URL } from "./lib/builderGuide";

const nextConfig: NextConfig = {
  // solc is 24 MB of Emscripten output and is loaded through `require` at
  // runtime. Bundling it is both pointless and slow.
  // The Dynamic wallet SDK signs through MPC code compiled to WebAssembly,
  // which the bundler cannot place; Node loads it as it ships.
  // See lib/stubs/stripe-js.js.
  turbopack: { resolveAlias: { "@stripe/stripe-js": "./lib/stubs/stripe-js.js" } },

  serverExternalPackages: ["solc", "@dynamic-labs-wallet/node-evm", "@dynamic-labs-wallet/node", "@evervault/wasm-attestation-bindings"],

  async redirects() {
    return [
      {
        // One canonical host. Search engines must never see two copies of the site.
        source: "/:path*",
        has: [{ type: "host", value: "monsmith.com" }],
        destination: "https://www.monsmith.com/:path*",
        permanent: true,
      },
      { source: "/blog", destination: "/learn", permanent: true },
      { source: "/blog/:slug", destination: "/learn/:slug", permanent: true },
      { source: "/guides", destination: "/learn", permanent: true },
      { source: "/guides/:slug", destination: "/learn/:slug", permanent: true },
      { source: "/docs", destination: "/learn", permanent: true },
      { source: "/ide", destination: "/studio", permanent: true },
      { source: "/app", destination: "/studio", permanent: true },
      { source: "/faq", destination: "/#faq", permanent: true },
      { source: "/team", destination: "/about", permanent: true },
      // The builder guide is a Notion page. Temporary on purpose: the short
      // path is the stable one and the destination may move.
      { source: BUILDER_GUIDE_PATH, destination: BUILDER_GUIDE_URL, permanent: false },
    ];
  },

  async headers() {
    return [
      {
        // The embed exists to be framed. Everything else keeps the default,
        // which is to be framed by nobody.
        source: "/embed/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
      {
        // The live matrix is useful to anyone building their own comparison,
        // and publishing it is cheaper than being scraped.
        source: "/api/chains",
        headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
      },
    ];
  },
};

export default nextConfig;
