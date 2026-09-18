import type { Metadata, Viewport } from "next";
import { Inter, Literata, Noto_Naskh_Arabic } from "next/font/google";

import { promoBootstrap } from "@/lib/promo";
import { THEME_BOOTSTRAP } from "@/lib/theme-bootstrap";
import { ADSENSE_ACCOUNT, LANG, ROBOTS_CONTENT, SITE_NAME, SITE_URL } from "@/lib/site";
import "./globals.css";
import "./counter.css";
import "./njc.css";

/**
 * The document itself: <html>, the fonts, the metadata, and the few scripts that
 * must run before anything paints.
 *
 * The site's own furniture — header, footer, promo bar, analytics — moved to
 * app/(site)/layout.tsx when the admin panel joined this application
 * (docs/ADMIN.md §1). The panel is served from admin.tasbihcounts.com, rendered
 * by the same Next app, and it must not inherit a visitor's header, a promo bar
 * or an ad. A route group is how the App Router says "this layout applies to
 * these routes and not those" without changing a single URL.
 */

const literata = Literata({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--f-literata",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--f-inter",
  display: "swap",
});

/* The Arabic of every dhikr. Naskh, because it is what a reader sees in print. */
const naskh = Noto_Naskh_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600"],
  variable: "--font-naskh",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  // The PWA plugin printed these on every WordPress page and they are what
  // makes "Add to Home Screen" open without browser chrome on iOS.
  appleWebApp: {
    capable: true,
    title: SITE_NAME,
    statusBarStyle: "default",
  },
  // `other` is replaced wholesale by a page that sets it, not merged, so the
  // robots line lives here too. Every page carried the same one anyway.
  other: {
    robots: ROBOTS_CONTENT,
    // appleWebApp.capable above emits the modern mobile-web-app-capable.
    // Older iOS reads the apple- prefixed one, which is what the plugin sent.
    "apple-mobile-web-app-capable": "yes",
    "apple-touch-fullscreen": "yes",
    // The publisher id from the ads.txt the site already served.
    "google-adsense-account": ADSENSE_ACCOUNT,
  },
  icons: {
    icon: [
      { url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192" }],
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8f4" },
    { media: "(prefers-color-scheme: dark)", color: "#121211" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The on-screen keyboard shrinks the page rather than floating over it, so a
  // field at the foot of a bottom sheet (a custom mantra, the target, search) or
  // of a form stays above the keyboard instead of hiding behind it. Chrome and
  // Firefox honour this.
  interactiveWidget: "resizes-content",
};

/**
 * The counter keeps its theme in its settings (stores/settings-store.ts). Reading
 * it before paint stops a light flash on a dark theme.
 */
const themeBootstrap = THEME_BOOTSTRAP;

/**
 * The password-reset link carries a one-time token in its query string. This is
 * the first script on the page — before AdSense or analytics can read the
 * address — and it moves the token into memory and wipes it from the address bar.
 * ResetPasswordForm reads it from there.
 */
const resetTokenGuard = `(function(){try{if(location.pathname==='/auth/reset/'&&location.search){window.__njcReset=location.search;history.replaceState(null,'',location.pathname)}}catch(e){}})();`;

/**
 * Regenerated at most once a minute, so a kill switch thrown in the admin panel
 * takes effect across the whole site while the operator is still looking at the
 * screen (docs/ADMIN.md §3.8). Pages stay prebuilt files between regenerations —
 * this is not a per-request render.
 */
export const revalidate = 60;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const fontVars = `${literata.variable} ${inter.variable} ${naskh.variable}`;

  return (
    <html
      lang={LANG}
      className={fontVars}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: [resetTokenGuard, themeBootstrap, promoBootstrap].join(";"),
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
