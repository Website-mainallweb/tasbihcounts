/**
 * Every value here was read off the live WordPress site (Rank Math editor
 * store plus the rendered <head>) so the migrated pages emit byte-identical
 * SEO. Change SITE_URL to the real domain and nothing else needs touching.
 */

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://tasbihcounts.com"
).replace(/\/$/, "");

export const SITE_NAME = "Tasbih Counts";
export const SITE_TAGLINE = "Digital Tasbih Counter";
export const LOCALE = "en_US";
export const LANG = "en-US";
export const TITLE_SEPARATOR = "-";

export const PRIVACY_EMAIL = "contact@tasbihcounts.com";

/**
 * The one address the legal pages give for support, refunds and privacy
 * grievances. Built from the site's own domain rather than written out, so a
 * preview or staging build names its own domain and the address cannot drift
 * from the canonical one.
 */
export const SUPPORT_EMAIL = `contact@${new URL(SITE_URL).hostname.replace(/^www\./, "")}`;

/**
 * The site's social profiles. Empty until Tasbih Counts has them: the footer
 * and the schema.org sameAs list show only the ones filled in.
 */
export const SOCIAL: { instagram: string; facebook: string } = {
  instagram: "",
  facebook: "",
};

// TODO(Tasbih Counts): still the Bhakti Nam Jap GA4 tag. Replace with the
// Tasbih Counts property's tag before launch, or its visits land in the wrong
// property. Analytics only runs on the live domain (app/(site)/layout.tsx).
export const GOOGLE_TAG_ID = "GT-5R7TVL64";

/**
 * A window property that runs analytics away from the live domain. Only the
 * end-to-end suite sets it, so the CSP is still checked against the real tag —
 * and the suite answers the tag's hits itself, so none of them reach Google.
 */
export const ANALYTICS_OVERRIDE = "__njcForceAnalytics";

/**
 * The publisher this site belongs to, and the id in public/ads.txt. The first
 * account was registered as an organization when it had to be an individual,
 * so it was closed and this one replaces it. The old id — pub-6952798071579220
 * — is dead; nothing should refer to it again.
 */
export const ADSENSE_ACCOUNT = "ca-pub-1966021383086490";

/**
 * One slot id per position on the page. Empty means "do not ask for an ad
 * here": AdSlot renders nothing, so a position can wait for its unit without
 * anything else changing.
 *
 * Every id is empty right now because the units belonged to the closed
 * account, and a slot id is only valid for the publisher that created it. The
 * new account is still in review; once it is approved, create the units and
 * fill these in. The layout, the spacing and the formats each position expects
 * are all still here and were built against the ids below:
 *
 *   mobileContent   4751183621   display
 *   tabletRail      5893864587   display
 *   desktopRail     9641537908   display
 *   milestone       8010208687   display
 *   articleInline   6675473538   in-article
 *   articleEnd      6477635163   multiplex
 *
 * There is deliberately no in-feed unit: that format needs a list of posts to
 * sit between, and the blog has none yet.
 */
export const AD_SLOTS = {
  /** Below the counter, above the article. Phones and tablets. */
  mobileContent: "",
  /** The 286px column beside the counter at tablet widths. Not sticky. */
  tabletRail: "",
  /** The right rail at desktop widths. Sticky, and never wider than 300px. */
  desktopRail: "",
  /** Inside the milestone card, kept clear of its buttons. */
  milestone: "",
  /**
   * In-article, for the prose itself. Google asks for it two paragraphs into
   * the article and never in a sidebar, so it is only used inside .prose.
   */
  articleInline: "",
  /** Multiplex, the grid that closes out an article. */
  articleEnd: "",
};

/**
 * Two lock-ups of the same mark: the wordmark is black ink in one and white in
 * the other, so the header can follow the counter's light and dark themes.
 * LOGO.src is the schema.org logo and stays the original WordPress asset.
 */
/**
 * The schema logo and the social card keep the exact URLs the WordPress site
 * published, files and all, so every value in the head is unchanged.
 */
export const LOGO = {
  src: "/images/tasbih-counts-logo.png",
  width: 1200,
  height: 285,
  alt: SITE_NAME,
  light: { src: "/images/tc-logo-light.png", width: 632, height: 150 },
  dark: { src: "/images/tc-logo-dark.png", width: 632, height: 150 },
};

export const SOCIAL_IMAGE = {
  src: "/images/tasbih-counts-social.png",
  width: 1200,
  height: 630,
  alt: "Tasbih Counts — online tasbih counter",
  type: "image/png",
};

/**
 * Rank Math emitted its max-* directives inside the one robots meta tag.
 * Next's structured `robots` field splits those onto a googlebot tag, so the
 * string is written out verbatim through `other` instead.
 */
// Directive order copied from the old head as well as the directives.
export const ROBOTS_CONTENT =
  "follow, index, max-snippet:-1, max-video-preview:-1, max-image-preview:large";

export const NAV = [
  { label: "Tasbih Counter", href: "/" },
  { label: "About Us", href: "/about-us/" },
  { label: "Contact Us", href: "/contact-us/" },
  { label: "Privacy Policy", href: "/privacy-policy/" },
  { label: "Terms of Service", href: "/terms/" },
  { label: "Refund Policy", href: "/refund-policy/" },
];

/**
 * Page-level SEO.
 * dateModified (B71): the last real change to the page's copy; move it with the copy.
 */
export const PAGE_SEO = {
  home: {
    path: "/",
    title: "Tasbih Counter Online – Free Digital Tasbeeh & Dhikr Counter",
    description:
      "Free online tasbih counter and digital tasbeeh for dhikr. Tap to count, set 33, 99 or 100, after-salah 33-33-34, 99 Names, Tawaf. Works offline, no signup.",
    keywords: [
      "tasbih counter",
      "online tasbih counter",
      "digital tasbih",
      "digital tasbih counter",
      "tasbih online",
      "tasbeeh counter",
      "digital tasbeeh",
      "online tasbeeh counter",
      "dhikr counter",
      "online dhikr counter",
      "zikr counter",
      "digital zikr counter",
      "digital misbaha",
      "misbaha counter",
      "electronic tasbih",
      "e tasbih",
      "tasbih clicker",
      "tally counter tasbih",
      "tasbih counter for mobile",
      "free tasbih counter",
      "tasbih counter app",
      "tasbih counter no ads",
      "zikirmatik",
      "dijital tesbih",
      "tasbih digital",
      "penghitung tasbih",
      "compteur tasbih",
      "subhanallah counter",
      "astaghfirullah counter",
      "istighfar counter",
      "durood counter",
      "salawat counter",
      "tahlil counter",
      "kalima counter",
      "99 names of allah counter",
      "asma ul husna counter",
      "33 33 34 dhikr counter",
      "after salah tasbih counter",
      "tasbih fatima counter",
      "wazifa counter",
      "tawaf counter",
      "sai counter",
      "umrah counter",
      "ramadan dhikr counter",
      "تسبيح",
      "عداد التسبيح",
      "مسبحة إلكترونية",
      "تسبیح کاؤنٹر",
      "तस्बीह काउंटर",
      "তাসবিহ কাউন্টার",
    ],
    ogType: "website" as const,
    datePublished: "2026-09-18T12:00:00+05:30",
    dateModified: "2026-09-20T12:00:00+05:30",
  },
  about: {
    path: "/about-us/",
    title: `About Us ${TITLE_SEPARATOR} ${SITE_NAME}`,
    description:
      "Why Tasbih Counts exists: a calm, free online tasbih counter that opens straight into counting, works offline and keeps your dhikr private.",
    keywords: ["Tasbih Counts", "Tasbih Counter", "Dhikr Counter"],
    ogType: "article" as const,
    datePublished: "2026-09-18T12:00:00+05:30",
    dateModified: "2026-09-18T12:00:00+05:30",
  },
  contact: {
    path: "/contact-us/",
    title: `Contact Us ${TITLE_SEPARATOR} ${SITE_NAME}`,
    description:
      "Get in touch with Tasbih Counts for support, feedback or a correction to the religious content. We reply within 24–48 hours.",
    keywords: ["Tasbih Counts", "Tasbih Counter", "Dhikr"],
    ogType: "article" as const,
    datePublished: "2026-09-18T12:00:00+05:30",
    dateModified: "2026-09-18T12:00:00+05:30",
  },
  privacy: {
    path: "/privacy-policy/",
    title: `Privacy Policy ${TITLE_SEPARATOR} ${SITE_NAME}`,
    // Rewritten with the policy itself: the old line promised "anonymous" and
    // said nothing of ads, analytics or the Premium plan.
    description:
      "How Tasbih Counts handles your data: your counts stay on your device, what ads and analytics use, and what the optional Premium plan needs.",
    keywords: ["Tasbih Counts", "Tasbih Counter", "Dhikr"],
    ogType: "article" as const,
    datePublished: "2026-09-18T12:00:00+05:30",
    dateModified: "2026-09-18T12:00:00+05:30",
  },
  terms: {
    path: "/terms/",
    title: `Terms of Service ${TITLE_SEPARATOR} ${SITE_NAME}`,
    description:
      "The terms for using Tasbih Counts, the free online tasbih counter, and its one-time ₹200 lifetime Premium plan.",
    keywords: ["Tasbih Counts", "Tasbih Counter"],
    ogType: "article" as const,
    datePublished: "2026-09-18T12:00:00+05:30",
    dateModified: "2026-09-18T12:00:00+05:30",
  },
  refund: {
    path: "/refund-policy/",
    title: `Refund & Cancellation Policy ${TITLE_SEPARATOR} ${SITE_NAME}`,
    description:
      "Tasbih Counts Premium is a one-time ₹200 lifetime payment. How delivery works, why there is nothing to cancel, and when a refund is given.",
    keywords: ["Tasbih Counts", "Tasbih Counter"],
    ogType: "article" as const,
    datePublished: "2026-09-18T12:00:00+05:30",
    dateModified: "2026-09-18T12:00:00+05:30",
  },
  premium: {
    path: "/premium/",
    title: `Premium ${TITLE_SEPARATOR} ${SITE_NAME}`,
    description:
      "Tasbih Counts Premium: one payment of ₹200 for life — no ads, your practice on every device, and daily reminders.",
    keywords: ["Tasbih Counts", "Tasbih Counter", "Premium"],
    ogType: "article" as const,
    datePublished: "2026-09-18T12:00:00+05:30",
    dateModified: "2026-09-18T12:00:00+05:30",
  },
  blog: {
    path: "/blog/",
    title: `Blog ${TITLE_SEPARATOR} ${SITE_NAME}`,
    // Rank Math had no description on this page; leaving it absent keeps the
    // <head> the same as the WordPress output.
    description: undefined as string | undefined,
    keywords: [] as string[],
    ogType: "website" as const,
    datePublished: "2026-09-18T12:00:00+05:30",
    dateModified: "2026-09-18T12:00:00+05:30",
  },
};
