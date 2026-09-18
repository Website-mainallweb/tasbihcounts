import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * The Hostinger temp domain shipped a robots.txt with "User-agent: Googlebot /
 * Disallow: /", which blocked Google outright. This replaces it with an open
 * policy so the real domain can be crawled.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    /* /admin is the back-office (docs/ADMIN.md §2). It 404s on this domain
       anyway and every page inside it carries noindex and a guard, so this line
       is the polite layer rather than the enforcing one. It is here because a
       crawler that reads robots.txt should not spend requests finding that out. */
    rules: [{ userAgent: "*", allow: "/", disallow: "/admin" }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    // B61: no Host line. Only Yandex read it, and it takes a bare host name.
  };
}
