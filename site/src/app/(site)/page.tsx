import type { Metadata } from "next";
import AdSlot from "@/components/AdSlot";
import ArticleFrame from "@/components/ArticleFrame";
import NamJapCounter from "@/components/NamJapCounter";
import ProseWithAds from "@/components/ProseWithAds";
import { home } from "@/content/pages";
import { libraryBootstrap, libraryNames } from "@/lib/counter/library";
import { JsonLdScript, jsonLd, pageMetadata } from "@/lib/seo";
import { AD_SLOTS } from "@/lib/site";

export const metadata: Metadata = pageMetadata("home");

/**
 * Regenerated at most once a minute, so an edit to the name library in the admin
 * panel reaches visitors without a deploy (docs/ADMIN.md §3.9).
 *
 * The page is still a static file served from the edge — this is not a dynamic
 * render. Between regenerations every visitor gets the same prebuilt HTML, which
 * is what keeps the counter instant and keeps an ad reviewer looking at a fast
 * page. If the database cannot be reached during a regeneration, the build
 * inlines the bundled list instead and nothing breaks (lib/counter/library.ts).
 */
export const revalidate = 60;

export default async function HomePage() {
  const names = await libraryNames();

  return (
    <>
      <JsonLdScript data={jsonLd("home")} />

      {/* Runs before the engine starts, so the counter boots with the current
          library rather than swapping lists a moment after first paint. */}
      <script
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: libraryBootstrap(names) }}
      />

      {/* The WordPress home page carried its H1 and sub-line inside the old
          counter widget. The new counter has no heading of its own, so the
          same two lines sit above it and the H1 stays exactly as it was. */}
      <section className="counter-slot" aria-label="Nam Jap Counter">
        <div className="counter-head">
          {/* lang="hi" so a screen reader uses a Hindi voice for it (#37). */}
          <h1 className="dev" lang="hi">
            नाम जप काउंटर
          </h1>
          <p>Spiritual Name Chanting Counter</p>
        </div>
        <NamJapCounter />
      </section>

      <div className="wrap home-article">
        {/* Nothing sits above or beside the counter: the tool is what the page
            is for, and an ad next to a surface this tap-heavy is what gets an
            account closed. This is the first one, a clear 150px below it. */}
        <AdSlot slot={AD_SLOTS.mobileContent} className="ad-after-counter" />

        <ArticleFrame
          aside={
            /* Sticky with the side column, and desktop only: AdSense allows a
               fixed ad on a desktop layout but not on a phone or a tablet. Below
               1024px it is not rendered at all, so no unseen impression is
               requested. */
            <AdSlot slot={AD_SLOTS.desktopRail} minHeight={600} minWidth={1024} />
          }
        >
          {/* Seventeen paragraphs, so the in-article unit sits deep enough to
              be a break in the reading rather than a second ad in a row. */}
          <ProseWithAds html={home} after={6} />
        </ArticleFrame>
      </div>
    </>
  );
}
