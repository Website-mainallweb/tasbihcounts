/**
 * Plain JS, not TypeScript, on purpose. The host builds on a machine whose
 * glibc is too old for Next's native SWC binary, so Next falls back to the
 * WASM build, and that fallback cannot compile a `next.config.ts` — the build
 * dies loading the config before it reaches any page. A .mjs config needs no
 * compile step at all.
 */
/**
 * Every page is prerendered and the counter keeps its state in the visitor's own
 * browser, so today these headers are about what a browser may do with the page
 * rather than about protecting a session.
 *
 * That changes with the premium tier. Accounts, Razorpay and Supabase all need
 * origins this policy does not yet name, and the failure is silent — a checkout
 * button that does nothing. docs/ARCHITECTURE.md lists them; the Playwright
 * suite fails on any CSP refusal that is not in its short, documented list of
 * blocks we chose.
 *
 * The policy lists only what the site actually loads today: Google's tag for
 * analytics, and everything else from this origin. next/font self-hosts the
 * font files, so no font CDN is needed. 'unsafe-inline' is present for scripts
 * because the theme bootstrap and the gtag init are inline and a static export
 * has no request to hang a nonce off.
 *
 * AdSense is now one of those things, and it is the reason for the ad hosts
 * below. Google's own advice is a nonce with 'strict-dynamic' rather than an
 * allowlist, because their ad domains change without notice — but a
 * prerendered page has no request to mint a nonce on, which is the same reason
 * 'unsafe-inline' is here. So this is an allowlist, and the failure mode to
 * watch for is ads that stop filling with a CSP error in the console naming a
 * host that is not listed here.
 */
/**
 * Supabase Auth, for the sign-in page: the browser asks it for a Google redirect
 * or a sign-in email. Read from the build's own environment, so the policy names
 * exactly the project this build talks to. A build without Supabase configured
 * names nothing, and sign-in there fails closed.
 */
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
  : "";

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "FRAME_ANCESTORS_SLOT",
  "form-action 'self'",
  // Only the hosts GA4 actually reaches. A narrower list looked right and
  // silently blocked every hit: the tag posts to a regional
  // google-analytics subdomain, falls back to analytics.google.com, and pings
  // www.google.com. Note that "*.analytics.google.com" does NOT cover the bare
  // analytics.google.com, so it is listed on its own.
  //
  // Google Signals also fires a remarketing pixel at google.<country tld>,
  // which follows the visitor's country and so cannot be enumerated. That one
  // stays blocked. It is ad remarketing, not measurement, and no report
  // depends on it.
  //
  // 'unsafe-eval' is here for the ads and nothing else: Google's own reference
  // policy for AdSense grants it, and a creative that needs it fails silently
  // otherwise — an empty slot with no error anyone would notice.
  // cdn.razorpay.com: checkout.js pulls its own risk-detection bundle from there,
  // and the browser refused it on /premium/ until it was listed.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://cdn.razorpay.com https://*.googletagmanager.com https://pagead2.googlesyndication.com https://tpc.googlesyndication.com https://partner.googleadservices.com https://www.googleadservices.com https://www.googletagservices.com https://adservice.google.com https://googleads.g.doubleclick.net https://*.adtrafficquality.google",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.razorpay.com https://*.google-analytics.com https://*.googletagmanager.com https://www.google.com https://*.googlesyndication.com https://*.doubleclick.net https://*.googleadservices.com https://*.adtrafficquality.google",
  "font-src 'self' data:",
  // csi.gstatic.com is Google's client-side instrumentation: the ad tag
  // reporting on its own performance. Blocking it does not stop an ad rendering,
  // but it does mean AdSense sees its telemetry refused by this site — not what
  // you want a review looking at. Named exactly, not the whole of gstatic.com.
  `connect-src 'self' ${supabaseOrigin} https://api.razorpay.com https://lumberjack.razorpay.com https://fcmregistrations.googleapis.com https://firebaseinstallations.googleapis.com https://*.google-analytics.com https://analytics.google.com https://*.analytics.google.com https://*.googletagmanager.com https://www.google.com https://*.googlesyndication.com https://*.doubleclick.net https://*.googleadservices.com https://*.adtrafficquality.google https://csi.gstatic.com`,
  // The creative itself renders in a cross-origin frame, and default-src would
  // otherwise refuse it. Each of these is a frame AdSense actually opens.
  "frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://googleads.g.doubleclick.net https://tpc.googlesyndication.com https://*.safeframe.googlesyndication.com https://www.google.com https://*.adtrafficquality.google",
  "manifest-src 'self'",
  // Dropped only for the end-to-end server, which speaks plain HTTP.
  //
  // WebKit applies upgrade-insecure-requests to localhost as well, unlike
  // Chromium, so every stylesheet and script on the test server is rewritten to
  // https and fails to connect. The page still renders its server HTML, which
  // meant the WebKit project was quietly testing a document with no CSS and no
  // JavaScript at all — and passing.
  //
  // In production every response is already https, so the directive has nothing
  // left to upgrade and its absence here changes nothing that is under test.
  //
  // Also dropped for the dev server and for a build served on the LAN (LAN=1):
  // a phone opening http://<this machine's IP>:3000 would otherwise ask for every
  // stylesheet, script and image over https, which that address does not serve,
  // and get a page with no CSS. Browsers exempt localhost, which is why the
  // desktop never showed it.
  ...(process.env.NJC_E2E === "1" || process.env.LAN === "1" || process.env.NODE_ENV !== "production"
    ? []
    : ["upgrade-insecure-requests"]),
].join("; ");

/* Who may put this site in an iframe.
 *
 * AdSense opens the live site inside its Ad Settings Preview on
 * adsense.google.com; with framing refused outright, that pane can only show
 * the browser's error page. Since 2026-09-12 the two are separated: the public
 * pages may be framed by that preview, and every surface with a session or a
 * price on it — account, sign-in, admin, premium, the API — refuses framing
 * outright, which is stricter than the SAMEORIGIN they had before.
 */
const PUBLIC_ANCESTORS =
  "frame-ancestors 'self' https://adsense.google.com https://www.google.com";
const PRIVATE_ANCESTORS = "frame-ancestors 'none'";

const cspFor = (ancestors) => csp.replace("FRAME_ANCESTORS_SLOT", ancestors);

const securityHeaders = [
  { key: "Content-Security-Policy", value: cspFor(PUBLIC_ANCESTORS) },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // No X-Frame-Options on the public pages: it cannot name a third party, and
  // frame-ancestors above says exactly who may frame them. The guarded routes
  // below carry DENY as well as frame-ancestors 'none'.
  // Razorpay opens bank and UPI windows that report back to the checkout; a
  // strict same-origin opener policy cuts that line and the payment hangs.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  {
    key: "Permissions-Policy",
    // The counter asks for vibration and a wake lock, and Razorpay's checkout
    // may use the Payment Request API — for this site and Razorpay's own frames
    // only. Single-quoted: the header syntax needs double quotes around origins.
    value:
      'camera=(), microphone=(), geolocation=(), payment=(self "https://api.razorpay.com" "https://checkout.razorpay.com"), usb=(), interest-cohort=()',
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Dev server only: lets a phone on the same Wi-Fi open the LAN address.
  allowedDevOrigins: ["10.225.42.250", "10.208.116.250", "192.168.*.*", "10.*.*.*"],
  // The WordPress site served every page with a trailing slash. Keeping that
  // shape means the live URLs Google already has do not move.
  trailingSlash: true,
  async headers() {
    /* Anything a signed-in person or a payment touches. */
    const guarded = ["account", "login", "admin", "premium", "auth", "api"];
    const privateHeaders = [
      ...securityHeaders.filter((h) => h.key !== "Content-Security-Policy"),
      { key: "Content-Security-Policy", value: cspFor(PRIVATE_ANCESTORS) },
      { key: "X-Frame-Options", value: "DENY" },
    ];

    /*
     * The admin panel, stricter again (docs/ADMIN.md §2).
     *
     * A cached admin page is somebody's account data sitting in a proxy, and the
     * panel is the one surface where a search engine finding a URL would be a
     * real problem rather than an untidy one. `noindex` is also set in the
     * panel's own metadata and in robots.txt; a header is the layer that holds
     * for a response nothing rendered, like a CSV download.
     *
     * Listed before the general `guarded` entries below, because Next applies
     * the first matching source.
     */
    const adminHeaders = [
      ...privateHeaders,
      { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, private" },
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" },
    ];

    return [
      { source: "/admin", headers: adminHeaders },
      { source: "/admin/:rest*", headers: adminHeaders },
      ...guarded.flatMap((path) => [
        { source: "/" + path, headers: privateHeaders },
        { source: "/" + path + "/:rest*", headers: privateHeaders },
      ]),
      {
        source: "/:path((?!" + guarded.join("|") + ").*)",
        headers: securityHeaders,
      },
      { source: "/", headers: securityHeaders },
    ];
  },
};

export default nextConfig;
