import type { Metadata } from "next";
import ArticleFrame from "@/components/ArticleFrame";
import { contactUs } from "@/content/pages";
import { withSupportEmail } from "@/lib/legal";
import { JsonLdScript, jsonLd, pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("contact");

// One support address everywhere (lib/site.ts), the same one the legal pages,
// Premium and sign-in give. The page used to show a second, older address.
const html = withSupportEmail(contactUs);

export default function ContactPage() {
  return (
    <>
      <JsonLdScript data={jsonLd("contact", "Contact Us")} />
      <div className="page-glow" aria-hidden="true" />
      <div className="wrap page">
        <ArticleFrame>
          <article className="prose" dangerouslySetInnerHTML={{ __html: html }} />
        </ArticleFrame>
      </div>
    </>
  );
}
