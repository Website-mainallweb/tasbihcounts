/**
 * Compares the built site's <head> and content against what the WordPress site
 * actually served. Run against a running server:
 *   node scripts/verify-seo.mjs http://localhost:3000
 */

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://bhaktinamjap.com";

const expected = {
  "/": {
    title: "Bhakti Nam Jap – Digital Nam Jap Counter",
    description:
      "Bhakti Nam Jap is an online Nam Jap counter to track daily mantra chanting. Stay focused, deepen devotion, and grow spiritually with ease.",
    ogType: "website",
    keywords: [
      "Bhakti Nam Jap",
      "Nam Jap Counter",
      "Online Nam Jap Counter",
      "नाम जप काउंटर",
    ],
    h1: ["नाम जप काउंटर"],
    h2: [
      "Bhakti Nam Jap Counter – Digital Online Nam Jap Counter",
      // Four headings edited for grammar on 2026-09-11 (UX walkthrough #20).
      "What Is Bhakti Nam Jap?",
      "How to Use the Bhakti Nam Jap Counter",
      "Key Features of Bhakti Nam Jap Counter",
      "What Is a Mala in the Nam Jap Counter?",
      "Understanding the Counter Stats",
      "Why Use Bhakti Nam Jap – Digital Online Nam Jap Counter",
      "Benefits of Daily Chanting with Bhakti Nam Jap",
      "Bhakti Nam Jap Counter Full Screen",
      "Using the Count and Reset Buttons",
      "Tips for Using Nam Jap Counter",
      "Follow Bhakti Nam Jap Counter on Social Media",
    ],
  },
  "/about-us/": {
    title: "About Us - Bhakti Nam Jap",
    description:
      "Discover the purpose behind Bhakti Nam Jap Counter — a free spiritual tool for mantra chanting, meditation, and devotion, made for seekers worldwide.",
    ogType: "article",
    keywords: ["Bhakti Nam Jap", "Nam jap", "Nam Jap Counter"],
    h1: ["About Us"],
    // The page headings, given real levels in the 2026-09-11 accessibility pass.
    h2: ["Our Spiritual Mission"],
  },
  "/contact-us/": {
    title: "Contact Us - Bhakti Nam Jap",
    description:
      "Get in touch with Bhakti Nam Jap Counter for support, feedback, or guidance. Connect with us to enhance your daily mantra chanting experience.",
    ogType: "article",
    keywords: ["Bhakti Nam Jap", "Nam Jap Counter", "Nam Jap"],
    h1: ["Contact Us"],
    h2: ["Get In Touch"],
  },
  "/privacy-policy/": {
    title: "Privacy Policy - Bhakti Nam Jap",
    description:
      "How Bhakti Nam Jap handles your data: your counts stay on your device, what ads and analytics use, and what the optional Premium plan needs.",
    ogType: "article",
    keywords: ["Bhakti Nam Jap", "Nam Jap Counter", "Nam Jap"],
    h1: ["Privacy Policy"],
    h2: ["Our Commitment to Your Privacy"],
  },
  "/terms/": {
    title: "Terms of Service - Bhakti Nam Jap",
    description:
      "The terms for using Bhakti Nam Jap, the free online nam jap counter, and its one-time ₹200 lifetime Premium plan.",
    ogType: "article",
    keywords: ["Bhakti Nam Jap", "Nam Jap Counter"],
    h1: ["Terms of Service"],
    h2: ["About These Terms"],
  },
  "/refund-policy/": {
    title: "Refund & Cancellation Policy - Bhakti Nam Jap",
    description:
      "Bhakti Nam Jap Premium is a one-time ₹200 lifetime payment. How delivery works, why there is nothing to cancel, and when a refund is given.",
    ogType: "article",
    keywords: ["Bhakti Nam Jap", "Nam Jap Counter"],
    h1: ["Refund & Cancellation Policy"],
    h2: ["What You Are Buying"],
  },
  "/premium/": {
    title: "Premium - Bhakti Nam Jap",
    description:
      "Bhakti Nam Jap Premium: one payment of ₹200 for life — no ads, your practice on every device, and daily reminders.",
    ogType: "article",
    keywords: ["Bhakti Nam Jap", "Nam Jap Counter", "Premium"],
    h1: ["Bhakti Nam Jap Premium"],
    h2: ["What you get", "What stays free", "How it works"],
  },
  "/blog/": {
    // Noindex and out of the sitemap until it has a post (UX walkthrough #33).
    robots: "noindex, follow",
    title: "Blog - Bhakti Nam Jap",
    description: null,
    ogType: "website",
    keywords: [],
    // A screen-reader-only h1: every page needs one, and the empty state has no
    // visible heading of its own.
    h1: ["Blog"],
    h2: [],
  },
};

const ROBOTS =
  "follow, index, max-snippet:-1, max-video-preview:-1, max-image-preview:large";

let failures = 0;
let checks = 0;

function check(label, actual, want) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(want);
  if (!ok) {
    failures += 1;
    console.log(`  FAIL ${label}`);
    console.log(`       want: ${JSON.stringify(want)}`);
    console.log(`       got:  ${JSON.stringify(actual)}`);
  }
  return ok;
}

/* Decoded the same way as allTags: an "&" in a title is correctly served as
   "&amp;", and comparing the raw markup failed the Refund & Cancellation page. */
const decode = (s) =>
  s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const attr = (html, re) => {
  const m = html.match(re);
  return m ? decode(m[1]) : null;
};

const allTags = (html, tag) =>
  [...html.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map(
    (m) =>
      m[1]
        .replace(/<[^>]+>/g, "")
        .replace(/&#x27;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
  );

for (const [path, want] of Object.entries(expected)) {
  const res = await fetch(BASE + path);
  const html = await res.text();
  console.log(`\n${path}  (HTTP ${res.status})`);
  check("status", res.status, 200);

  check(
    "title",
    attr(html, /<title[^>]*>([\s\S]*?)<\/title>/)?.replace(/&#x27;/g, "'"),
    want.title,
  );
  check(
    "meta description",
    attr(html, /<meta name="description" content="([^"]*)"/),
    want.description,
  );
  check("robots", attr(html, /<meta name="robots" content="([^"]*)"/), want.robots ?? ROBOTS);
  check(
    "canonical",
    attr(html, /<link rel="canonical" href="([^"]*)"/),
    SITE + path,
  );
  check(
    "og:type",
    attr(html, /<meta property="og:type" content="([^"]*)"/),
    want.ogType,
  );
  check(
    "og:url",
    attr(html, /<meta property="og:url" content="([^"]*)"/),
    SITE + path,
  );
  check(
    "og:site_name",
    attr(html, /<meta property="og:site_name" content="([^"]*)"/),
    "Bhakti Nam Jap",
  );
  check(
    "og:image",
    attr(html, /<meta property="og:image" content="([^"]*)"/),
    SITE + "/wp-content/uploads/2025/10/BhaktiNamJap-Social-Image.png",
  );
  check(
    "twitter:card",
    attr(html, /<meta name="twitter:card" content="([^"]*)"/),
    "summary_large_image",
  );

  // Rank Math printed no keywords meta, so neither do we. The focus keywords
  // are asserted in the Article schema instead.
  const kwMeta = attr(html, /<meta name="keywords" content="([^"]*)"/);
  check("no keywords meta (matches the old head)", kwMeta, null);

  check("h1", allTags(html, "h1"), want.h1);
  check("h2", allTags(html, "h2"), want.h2);

  const ld = html.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
  );
  checks += 1;
  if (!ld) {
    failures += 1;
    console.log("  FAIL json-ld missing");
  } else {
    const graph = JSON.parse(ld[1])["@graph"];
    const types = graph.map((n) => n["@type"]).flat();
    const wantTypes =
      path === "/blog/"
        ? [
            "Person",
            "Organization",
            "WebSite",
            "BreadcrumbList",
            "CollectionPage",
            "ImageObject",
          ]
        : [
            "Person",
            "Organization",
            "WebSite",
            "BreadcrumbList",
            "WebPage",
            "ImageObject",
            "Article",
          ];
    check("json-ld @types", types, wantTypes);

    // The focus keywords live here, exactly where Rank Math put them.
    const article = graph.find((n) => n["@type"] === "Article");
    check(
      "article keywords",
      article ? article.keywords.split(", ") : [],
      want.keywords,
    );
  }
  // Tags the WordPress site printed on every page.
  check(
    "apple web app title",
    attr(html, /<meta name="apple-mobile-web-app-title" content="([^"]*)"/),
    "Bhakti Nam Jap",
  );
  check(
    "mobile web app capable",
    attr(html, /<meta name="mobile-web-app-capable" content="([^"]*)"/),
    "yes",
  );
  check(
    "adsense account",
    attr(html, /<meta name="google-adsense-account" content="([^"]*)"/),
    // The new publisher, from the commit that moved the site to it.
    "ca-pub-1966021383086490",
  );
}

// ads.txt has to be served from the document root, same as before.
const adsTxt = await fetch(BASE + "/ads.txt");
checks += 1;
const adsBody = adsTxt.ok ? (await adsTxt.text()).trim() : "";
if (adsBody !== "google.com, pub-1966021383086490, DIRECT, f08c47fec0942fa0") {
  failures += 1;
  console.log("\n  FAIL ads.txt", adsTxt.status, JSON.stringify(adsBody));
}

// robots.txt must not carry the Googlebot block the temp domain shipped.
const robotsTxt = await (await fetch(BASE + "/robots.txt")).text();
checks += 1;
if (/Googlebot[\s\S]*?Disallow: \//.test(robotsTxt)) {
  failures += 1;
  console.log("\n  FAIL robots.txt still blocks Googlebot");
}

const sitemap = await (await fetch(BASE + "/sitemap.xml")).text();
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
console.log("\n/sitemap.xml");
check("sitemap urls", locs, [
  SITE + "/",
  SITE + "/about-us/",
  SITE + "/contact-us/",
  SITE + "/privacy-policy/",
  SITE + "/terms/",
  SITE + "/refund-policy/",
  SITE + "/premium/",
]);

console.log(
  `\n${checks - failures}/${checks} checks passed, ${failures} failed`,
);
process.exit(failures ? 1 : 0);
