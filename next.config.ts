import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // solc is 24 MB of Emscripten output and is loaded through `require` at
  // runtime. Bundling it is both pointless and slow.
  serverExternalPackages: ["solc"],

  typescript: {
    ignoreBuildErrors: true,
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
