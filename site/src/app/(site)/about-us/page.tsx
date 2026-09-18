import type { Metadata } from "next";
import ArticleFrame from "@/components/ArticleFrame";
import ProseWithAds from "@/components/ProseWithAds";
import { aboutUs } from "@/content/pages";
import { JsonLdScript, jsonLd, pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("about");

export default function AboutPage() {
  return (
    <>
      <JsonLdScript data={jsonLd("about", "About Us")} />
      <div className="page-glow" aria-hidden="true" />
      <div className="wrap page">
        <ArticleFrame>
          {/* Eleven paragraphs: enough for the two article units, not enough for
              a rail as well. Contact and the privacy policy carry no ads at all —
              they are too short to hold one without the ad outweighing the copy. */}
          <ProseWithAds html={aboutUs} after={3} />
        </ArticleFrame>
      </div>
    </>
  );
}
