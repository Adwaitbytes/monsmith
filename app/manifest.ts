import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from "@/lib/seo";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} · ${SITE_TAGLINE}`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0f",
    theme_color: "#7c3aed",
    categories: ["developer tools", "productivity", "finance"],
    icons: [{ src: "/monsmith-logo.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
