import type { Metadata } from "next";
import ArticleFrame from "@/components/ArticleFrame";
import { refundPolicy } from "@/content/pages";
import { withSupportEmail } from "@/lib/legal";
import { JsonLdScript, jsonLd, pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("refund");

/* No ads: a legal page is read to make a decision, and Razorpay's review reads
   it too. */
export default function RefundPolicyPage() {
  return (
    <>
      <JsonLdScript data={jsonLd("refund", "Refund & Cancellation Policy")} />
      <div className="page-glow" aria-hidden="true" />
      <div className="wrap page">
        <ArticleFrame>
          <article className="prose" dangerouslySetInnerHTML={{ __html: withSupportEmail(refundPolicy) }} />
        </ArticleFrame>
      </div>
    </>
  );
}
