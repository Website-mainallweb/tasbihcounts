import type { MetadataRoute } from "next";
import { PAGE_SEO, SITE_URL } from "@/lib/site";

/**
 * The five URLs Rank Math's page-sitemap.xml listed, in the same order, then the
 * two legal pages added for the Premium plan.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const order: (keyof typeof PAGE_SEO)[] = [
    "home",
    "about",
    "contact",
    // The blog is left out until it has a post: an empty page in the sitemap is
    // a thin page for search engines and for the AdSense review (#33).
    "privacy",
    "terms",
    "refund",
    "premium",
  ];

  return order.map((key) => ({
    url: SITE_URL + PAGE_SEO[key].path,
    lastModified: new Date(PAGE_SEO[key].dateModified),
    changeFrequency: key === "home" ? "weekly" : "monthly",
    priority: key === "home" ? 1 : 0.8,
  }));
}
