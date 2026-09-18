import type { Metadata } from "next";
import Link from "next/link";
import { JsonLdScript, appPageMetadata, jsonLd, pageMetadata } from "@/lib/seo";

/* Noindex until the first post (#33): an empty page in search results, or in
   front of the AdSense reviewer, reads as thin content. It is also out of the
   menus and the sitemap. The rest of its head is unchanged. */
export const metadata: Metadata = {
  ...pageMetadata("blog"),
  other: appPageMetadata("Blog", "").other,
};

/**
 * The WordPress posts page rendered nothing: no heading, no copy, no posts.
 * Shipping a bare page would look broken, so this is the same empty state with
 * a way back to the counter. No indexable copy has been invented for it.
 */
export default function BlogPage() {
  return (
    <>
      <JsonLdScript data={jsonLd("blog", "Blog")} />
      <div className="page-glow" aria-hidden="true" />
      <div className="wrap">
        <div className="empty">
          {/* Every page needs one h1. The empty state has no visible heading of
              its own, so it is named for screen readers without changing the look. */}
          <h1 className="sr-only">Blog</h1>
          <p className="om" aria-hidden="true">
            ۞
          </p>
          <p>No posts have been published yet. New writing on dhikr and daily remembrance will appear here.</p>
          <Link className="btn" href="/">
            Open the Tasbih Counter
          </Link>
        </div>
      </div>
    </>
  );
}
