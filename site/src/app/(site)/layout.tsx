import Script from "next/script";

import AuthHost from "@/components/AuthHost";
import InAppBrowserNotice from "@/components/InAppBrowserNotice";
import OfflineWorker from "@/components/OfflineWorker";
import PromoBar from "@/components/PromoBar";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { flags } from "@/lib/flags";
import { adsOffBootstrap, premiumBootstrap } from "@/lib/premium-flag";
import { ADSENSE_ACCOUNT, ANALYTICS_OVERRIDE, GOOGLE_TAG_ID, SITE_URL, SUPPORT_EMAIL } from "@/lib/site";

/**
 * Everything a visitor sees around a page: the promo bar, the header, the
 * footer, the sign-in host, the offline worker, analytics.
 *
 * It lives in a route group rather than in the root layout because the admin
 * panel is now part of this application (docs/ADMIN.md §1) and renders under the
 * same <html>. A back-office screen has no business carrying a promo bar, a
 * "Get Premium" header or an analytics tag, and the group is how the App Router
 * expresses that. `(site)` is parentheses, so no URL changes: /about-us/ is
 * still /about-us/.
 */

/**
 * Analytics runs on the live domain and nowhere else. Every local build is a
 * production build too — the e2e server, `npm start`, the agent's preview — and
 * each of them used to send real hits into the same GA4 property, under a
 * localhost hostname. The page is prerendered, so the build cannot tell where it
 * will be served; the browser can, and it checks before the tag is fetched.
 *
 * admin.tasbihcounts.com is not on the list either, and this layout does not
 * render there at all — two reasons the panel is never measured.
 */
const siteHost = new URL(SITE_URL).hostname;
const analyticsHosts = JSON.stringify([siteHost, `www.${siteHost}`]);
const gtagInit = `(function(){if(${analyticsHosts}.indexOf(location.hostname)<0&&!window.${ANALYTICS_OVERRIDE})return;window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}window.gtag=gtag;gtag('js',new Date());gtag('config','${GOOGLE_TAG_ID}');var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id=${GOOGLE_TAG_ID}';document.head.appendChild(s)})()`;

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const switches = await flags();

  return (
    <>
      {/* AdSense lives here, not in the root layout, because the root layout is
          shared with the admin panel — and the loader does not only serve the
          slots AdSlot renders, it also runs Auto Ads, which place units of their
          own anywhere on the page. Setting pauseAdRequests before it was not
          enough: the loader replaces window.adsbygoogle with its own object and
          the flag went with it, and an ad appeared on the panel's sign-in page.
          The only reliable answer is not to load it there, and a route group is
          how this application says "there".

          React hoists an async <script src> into <head>, which is where AdSense
          wants it. The inline bootstrap before it pauses requests for a Premium
          browser and for the ads kill switch (lib/premium-flag.ts). */}
      <script
        dangerouslySetInnerHTML={{
          __html: switches.ads ? premiumBootstrap : [premiumBootstrap, adsOffBootstrap].join(";"),
        }}
      />
      {switches.ads && (
        <script
          async
          src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_ACCOUNT}`}
          crossOrigin="anonymous"
        />
      )}

      <a className="skip-link" href="#content">
        Skip to content
      </a>
      {switches.maintenance_mode && (
        <p className="maintenance" role="status">
          Accounts and sync are having a problem and are being worked on. Your counter keeps working
          as normal — nothing you count is lost.
        </p>
      )}
      {switches.promo_bar && <PromoBar />}
      <SiteHeader />
      <InAppBrowserNotice />
      <main id="content">{children}</main>
      <SiteFooter />
      <AuthHost supportEmail={SUPPORT_EMAIL} />
      <OfflineWorker />

      <Script id="gtag-init" strategy="afterInteractive">
        {gtagInit}
      </Script>
    </>
  );
}
