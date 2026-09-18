import AdSlot from "./AdSlot";
import { AD_SLOTS } from "@/lib/site";

/**
 * Splits the stored HTML after the given number of closing </p> tags. The copy
 * is flat prose — paragraphs, headings and lists as siblings — so a cut on a
 * paragraph boundary always lands between two top-level elements.
 *
 * If the article is shorter than that, everything stays in the first half and
 * the in-article unit is simply not rendered.
 */
function splitAfterParagraphs(html: string, count: number): [string, string] {
  let from = 0;
  for (let i = 0; i < count; i++) {
    const at = html.indexOf("</p>", from);
    if (at === -1) return [html, ""];
    from = at + 4;
  }
  return [html.slice(0, from), html.slice(from)];
}

type Props = {
  html: string;
  /**
   * Google's own guidance for the in-article unit is two paragraphs below the
   * start of the article, which is where it reads as a break rather than an
   * interruption.
   */
  after?: number;
};

/**
 * The article body with its two article-format ads: in-article between the
 * paragraphs, and the multiplex grid closing the piece out. Both are omitted
 * when there is not enough copy around them to carry an ad.
 *
 * The halves are wrapped in `display: contents` elements so .prose's own
 * spacing and list styling apply exactly as they do without the ads.
 */
export default function ProseWithAds({ html, after = 2 }: Props) {
  const [head, tail] = splitAfterParagraphs(html, after);

  return (
    <article className="prose" lang="en">
      <div className="prose-part" dangerouslySetInnerHTML={{ __html: head }} />
      {tail && (
        <>
          <AdSlot
            slot={AD_SLOTS.articleInline}
            format="in-article"
            minHeight={250}
          />
          <div className="prose-part" dangerouslySetInnerHTML={{ __html: tail }} />
        </>
      )}
      <AdSlot
        slot={AD_SLOTS.articleEnd}
        format="multiplex"
        minHeight={320}
        className="ad-end"
      />
    </article>
  );
}
