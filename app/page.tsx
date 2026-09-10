import LandingPage from "./landing/page";
import { JsonLd } from "./JsonLd";
import { faqJsonLd, jsonLdGraph, softwareJsonLd } from "@/lib/seo";

export default function Home() {
  return (
    <>
      <JsonLd data={jsonLdGraph(softwareJsonLd(), faqJsonLd())} />
      <LandingPage />
    </>
  );
}
