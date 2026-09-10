import { ImageResponse } from "next/og";

import { GUIDES, getGuide } from "@/lib/content/guides";
import { FOUNDER, SITE_NAME } from "@/lib/seo";

export const runtime = "nodejs";
export const alt = "Monsmith developer guide";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const g = getGuide(slug);
  const title = g?.title ?? "Developer guide";
  const category = g?.category ?? "Guide";
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
          <div style={{ width: 48, height: 48, borderRadius: 12, background: "#7c3aed", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 700 }}>M</div>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 600 }}>{SITE_NAME}</div>
          <div style={{ display: "flex", fontSize: 20, color: "#a78bfa", marginLeft: 8 }}>Learn · {category}</div>
        </div>
        <div style={{ display: "flex", fontSize: title.length > 70 ? 50 : 60, fontWeight: 700, lineHeight: 1.1, letterSpacing: -1.5, maxWidth: 1050 }}>{title}</div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22, color: "#9d9db0" }}>
          <div style={{ display: "flex" }}>By {FOUNDER.name}, founder of Monsmith</div>
          <div style={{ display: "flex" }}>monsmith.com/learn</div>
        </div>
      </div>
    ),
    size,
  );
}
