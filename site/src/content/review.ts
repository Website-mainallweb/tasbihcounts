/**
 * Who checked the religious content, and when.
 * Specification sections 61, 62, 138, 139.
 *
 * WHY THIS FILE EXISTS
 * Google treats religious guidance as YMYL — "your money or your life" — and
 * judges it on experience, expertise, authoritativeness and trust. A page of
 * Arabic with no named reviewer and no visible citation reads, to a search
 * engine and to a careful human alike, as content nobody stands behind.
 *
 * The product already stored `sources[]` and a `reviewStatus` on every entry.
 * Neither was ever rendered, so the work was invisible to the two audiences it
 * was done for.
 *
 * HONESTY RULE, WHICH IS NOT NEGOTIABLE
 * The board below is EMPTY until a real qualified person has actually reviewed
 * the content. Inventing a scholar, or naming a willing friend without the
 * credentials, would be exactly the fabrication this product refuses everywhere
 * else — and on religious material it would be far worse than an empty list.
 *
 * While the board is empty the UI says, in as many words, that review is not
 * complete and that nothing here should be taken on our authority. That is a
 * true statement and it is better SEO than a false one.
 */

export interface Reviewer {
  /** Full name as they wish to be credited. */
  name: string;
  /** Qualification, in plain words. Not a title alone. */
  credentials: string;
  /** Institution or authority, where there is one. */
  affiliation?: string;
  /** A page a reader can check. */
  url?: string;
  /** ISO date of the review that is currently published. */
  reviewedOn: string;
  /** What they checked. Never implies more than was actually reviewed. */
  scope: string;
}

/**
 * Filled only when review has genuinely happened. See the honesty rule above.
 *
 * When the first reviewer is added, also set CONTENT_REVIEW_ENFORCED in
 * content/dhikr.ts, flip each entry to "approved", and add the Person and
 * reviewedBy nodes to the JSON-LD (see reviewSchema below).
 */
export const REVIEW_BOARD: Reviewer[] = [];

export const REVIEW_COMPLETE = REVIEW_BOARD.length > 0;

/** The most recent review date across the board, for display and for schema. */
export function lastReviewedOn(): string | null {
  if (REVIEW_BOARD.length === 0) return null;
  return REVIEW_BOARD.map((r) => r.reviewedOn).sort().at(-1) ?? null;
}

/**
 * The sentence shown wherever religious content appears. Two versions, and the
 * one that renders is decided by whether the work is actually done.
 */
export function reviewNotice(): string {
  if (!REVIEW_COMPLETE) {
    return (
      "This content has not yet been through independent scholarly review. " +
      "Every phrase, meaning, count and citation is version controlled and " +
      "carries a review status, and nothing here should be taken on our " +
      "authority. Please verify anything that matters with a qualified scholar."
    );
  }
  const names = REVIEW_BOARD.map((r) => r.name).join(", ");
  const on = lastReviewedOn();
  return `Reviewed by ${names}${on ? ` on ${on}` : ""}. Corrections are welcome and are checked against the sources.`;
}

/**
 * The schema.org nodes that carry provenance. Empty while the board is empty:
 * a `reviewedBy` claim with nobody behind it is structured misinformation, and
 * it is the kind a search engine can and does penalise.
 */
export function reviewSchema(): Record<string, unknown>[] {
  if (!REVIEW_COMPLETE) return [];
  return REVIEW_BOARD.map((r) => ({
    "@type": "Person",
    name: r.name,
    description: r.credentials,
    ...(r.affiliation ? { affiliation: { "@type": "Organization", name: r.affiliation } } : {}),
    ...(r.url ? { url: r.url } : {}),
  }));
}
