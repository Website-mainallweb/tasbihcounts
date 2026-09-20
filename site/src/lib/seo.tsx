import type { Metadata } from "next";
import { home as homeHtml } from "@/content/pages";
import {
  ADSENSE_ACCOUNT,
  LOCALE,
  LOGO,
  PAGE_SEO,
  SITE_NAME,
  SITE_URL,
  SOCIAL,
  SOCIAL_IMAGE,
  TITLE_SEPARATOR,
} from "./site";

type PageKey = keyof typeof PAGE_SEO;

/** Builds the same <head> Rank Math produced, page by page. */
export function pageMetadata(key: PageKey): Metadata {
  const page = PAGE_SEO[key];
  const url = SITE_URL + page.path;
  const image = {
    url: SITE_URL + SOCIAL_IMAGE.src,
    width: SOCIAL_IMAGE.width,
    height: SOCIAL_IMAGE.height,
    alt: SOCIAL_IMAGE.alt,
    type: SOCIAL_IMAGE.type,
  };

  return {
    title: page.title,
    description: page.description,
    // Google ignores the keywords meta; Bing and smaller engines still read it.
    // The home page carries its full set, the rest none.
    ...(key === "home" ? { keywords: page.keywords } : {}),
    alternates: { canonical: url },
    openGraph: {
      type: page.ogType,
      locale: LOCALE,
      title: page.title,
      description: page.description,
      url,
      siteName: SITE_NAME,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
      images: [image.url],
    },
  };
}

const personId = `${SITE_URL}/#person`;
const websiteId = `${SITE_URL}/#website`;
const logoId = `${SITE_URL}/#logo`;

const logoObject = {
  "@type": "ImageObject",
  "@id": logoId,
  url: SITE_URL + LOGO.src,
  contentUrl: SITE_URL + LOGO.src,
  caption: SITE_NAME,
  inLanguage: LOCALE.replace("_", "-"),
  width: String(LOGO.width),
  height: String(LOGO.height),
};

/**
 * Rank Math emitted one @graph per page: the Person/Organization knowledge
 * graph, the WebSite, a BreadcrumbList, the WebPage and an Article. This
 * rebuilds that graph with the same @id wiring.
 */
export function jsonLd(key: PageKey, breadcrumbName?: string) {
  const page = PAGE_SEO[key];
  const url = SITE_URL + page.path;
  const isHome = page.path === "/";

  const graph: Record<string, unknown>[] = [
    {
      "@type": ["Person", "Organization"],
      "@id": personId,
      name: SITE_NAME,
      logo: logoObject,
      image: logoObject,
      ...(SOCIAL.instagram || SOCIAL.facebook
        ? { sameAs: [SOCIAL.instagram, SOCIAL.facebook].filter(Boolean) }
        : {}),
    },
    {
      "@type": "WebSite",
      "@id": websiteId,
      url: SITE_URL,
      name: SITE_NAME,
      publisher: { "@id": personId },
      inLanguage: LOCALE.replace("_", "-"),
      // B60: no SearchAction. The site has no search; ?s= only returned the home page.
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${url}#breadcrumb`,
      itemListElement: isHome
        ? [{ "@type": "ListItem", position: 1, name: "Home" }]
        : [
            { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
            { "@type": "ListItem", position: 2, name: breadcrumbName ?? page.title },
          ],
    },
    {
      "@type": key === "blog" ? "CollectionPage" : "WebPage",
      "@id": url,
      url,
      name: page.title,
      datePublished: page.datePublished,
      dateModified: page.dateModified,
      about: { "@id": personId },
      isPartOf: { "@id": websiteId },
      breadcrumb: { "@id": `${url}#breadcrumb` },
      primaryImageOfPage: { "@id": `${SITE_URL}/#primaryimage` },
      inLanguage: LOCALE.replace("_", "-"),
      ...(page.description ? { description: page.description } : {}),
    },
    {
      "@type": "ImageObject",
      "@id": `${SITE_URL}/#primaryimage`,
      url: SITE_URL + SOCIAL_IMAGE.src,
      width: SOCIAL_IMAGE.width,
      height: SOCIAL_IMAGE.height,
      inLanguage: LOCALE.replace("_", "-"),
    },
  ];

  if (isHome) {
    graph.push(
      {
        "@type": "WebApplication",
        "@id": `${url}#app`,
        name: `${SITE_NAME} - Online Tasbih Counter`,
        alternateName: ["Digital Tasbih", "Tasbeeh Counter", "Dhikr Counter", "Zikr Counter", "Digital Misbaha"],
        url,
        description: page.description,
        applicationCategory: "LifestyleApplication",
        operatingSystem: "Any (web browser)",
        browserRequirements: "Requires JavaScript",
        inLanguage: LOCALE.replace("_", "-"),
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        featureList: [
          "Tap anywhere to count",
          "Targets of 33, 99, 100 or any number",
          "After-salah 33-33-34 guided routine",
          "99 Names of Allah counter",
          "Tawaf and Sa'i counter",
          "Works offline",
          "Streaks and totals",
          "Full screen, dark mode and nine languages",
        ],
        publisher: { "@id": personId },
      },
      { "@type": "FAQPage", "@id": `${url}#faq`, mainEntity: homeFaq() },
    );
  }

  if (key !== "blog") {
    graph.push({
      "@type": "Article",
      "@id": `${url}#article`,
      headline: page.title,
      description: page.description,
      keywords: page.keywords.join(", "),
      datePublished: page.datePublished,
      dateModified: page.dateModified,
      author: { "@id": personId, name: SITE_NAME },
      publisher: { "@id": personId },
      mainEntityOfPage: { "@id": url },
      isPartOf: { "@id": url },
      image: { "@id": `${SITE_URL}/#primaryimage` },
      name: page.title,
      inLanguage: LOCALE.replace("_", "-"),
    });
  }

  return { "@context": "https://schema.org", "@graph": graph };
}

const decode = (x: string) =>
  x
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&rsquo;|&#8217;/g, "’")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

/** The visible FAQ on the home page, as schema.org questions. Read from the copy itself so the two cannot drift. */
function homeFaq() {
  const faq = homeHtml.slice(homeHtml.indexOf('id="faq"'));
  const out: Record<string, unknown>[] = [];
  for (const m of faq.matchAll(/<h3>(.*?)<\/h3>\s*<p>(.*?)<\/p>/gs)) {
    out.push({
      "@type": "Question",
      name: decode(m[1]),
      acceptedAnswer: { "@type": "Answer", text: decode(m[2]) },
    });
  }
  return out;
}

export function JsonLdScript({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

/**
 * Metadata for an app page — Streak, Stats and whatever follows.
 *
 * These carry one person's own practice and no copy a crawler could use, so
 * they are noindex. Getting there needs care: the root layout puts the site-wide
 * robots line inside `other`, and Next replaces `other` wholesale rather than
 * merging it. Setting only the `robots` field emits a second, contradictory tag
 * beside the layout's; setting `other` from scratch drops the AdSense and iOS
 * lines with it. So the layout's block is rebuilt here with robots swapped.
 */
export function appPageMetadata(title: string, description: string): Metadata {
  return {
    title: `${title} ${TITLE_SEPARATOR} ${SITE_NAME}`,
    description,
    other: {
      robots: "noindex, follow",
      "apple-mobile-web-app-capable": "yes",
      "apple-touch-fullscreen": "yes",
      "google-adsense-account": ADSENSE_ACCOUNT,
    },
  };
}
