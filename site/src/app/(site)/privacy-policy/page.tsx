import type { Metadata } from "next";
import ArticleFrame from "@/components/ArticleFrame";
import { privacyPolicy } from "@/content/pages";
import { withSupportEmail } from "@/lib/legal";
import { JsonLdScript, jsonLd, pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("privacy");

export default function PrivacyPage() {
  return (
    <>
      <JsonLdScript data={jsonLd("privacy", "Privacy Policy")} />
      <div className="page-glow" aria-hidden="true" />
      <div className="wrap page">
        <ArticleFrame>
          <article className="prose" dangerouslySetInnerHTML={{ __html: withSupportEmail(privacyPolicy) }} />
        </ArticleFrame>
      </div>
    </>
  );
}
