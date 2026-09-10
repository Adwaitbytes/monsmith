import { ImageResponse } from "next/og";
import { FOUNDER, SITE_NAME, SITE_TAGLINE } from "@/lib/seo";

export const runtime = "nodejs";
export const alt = `${SITE_NAME}: ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "linear-gradient(135deg, #0a0a0f 0%, #16112a 60%, #2a1560 100%)",
          color: "#f5f5fa",
          fontFamily: "Inter, Helvetica, Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "#7c3aed",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 34,
              fontWeight: 700,
            }}
          >
            M
          </div>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 600, letterSpacing: -0.5 }}>{SITE_NAME}</div>
          <div style={{ display: "flex", fontSize: 22, color: "#a78bfa", marginLeft: 12 }}>monsmith.com</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>
            {SITE_TAGLINE}
          </div>
          <div style={{ display: "flex", fontSize: 30, color: "#c4b5fd", maxWidth: 980, lineHeight: 1.3 }}>
            The AI-powered smart contract IDE for Monad. Write, audit, profile, and deploy in your browser.
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: "#9d9db0" }}>
          <div style={{ display: "flex" }}>Founded by {FOUNDER.name}</div>
          <div style={{ display: "flex" }}>{FOUNDER.socials.twitterHandle}</div>
        </div>
      </div>
    ),
    size,
  );
}
