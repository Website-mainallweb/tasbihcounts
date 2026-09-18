/**
 * Flat config. The rules here are not style preferences — each one is a guard
 * from docs/SECURITY.md that would otherwise only exist as an intention.
 */
import next from "eslint-config-next";
import nextTs from "eslint-config-next/typescript";

const config = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "node_modules/**",
      "next-env.d.ts",
      // Generated from content/ at the repo root. Edit the source, not this.
      "src/content/pages.ts",
    ],
  },

  ...next,
  ...nextTs,

  {
    rules: {
      // The counter engine escapes its own interpolation through esc(); a second
      // path into innerHTML is how that discipline gets quietly lost. The CSP
      // carries 'unsafe-inline' for AdSense, so an XSS here would be cheap to
      // exploit.
      "react/no-danger": "error",

      // docs/SECURITY.md §1–§3. `server-only` already makes a client import of
      // these a build error; this also stops server code reaching around the
      // data access layer. Routes and actions get their user from lib/dal.ts.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/env.server", "@/lib/env.server"],
              message:
                "Server secrets. Only lib/supabase/* reads them; routes and actions go through lib/dal.ts.",
            },
            {
              group: ["**/supabase/admin", "@/lib/supabase/admin"],
              message:
                "The service role client bypasses row-level security. Only the Razorpay webhook and scheduled jobs may use it (docs/SECURITY.md §2).",
            },
          ],
        },
      ],
    },
  },

  {
    // The existing uses, each injecting first-party build-time content and never
    // anything a visitor supplied: page copy generated from content/, JSON-LD,
    // the inline theme bootstrap and gtag init, and the counter's own markup
    // constant. Listed one file at a time on purpose — the rule still fires on
    // any NEW file, which is the whole point of keeping it.
    files: [
      "src/app/layout.tsx",
      // The AdSense bootstrap and loader, moved here so the admin panel does not
      // inherit them (docs/ADMIN.md §1). Same first-party strings as before.
      "src/app/(site)/layout.tsx",
      "src/app/(site)/contact-us/page.tsx",
      "src/app/(site)/privacy-policy/page.tsx",
      // The two legal pages added for Premium: the same static copy from
      // content/, with only the SUPPORT_EMAIL constant filled in.
      "src/app/(site)/terms/page.tsx",
      "src/app/(site)/refund-policy/page.tsx",
      "src/components/NamJapCounter.tsx",
      "src/components/ProseWithAds.tsx",
      "src/lib/seo.tsx",
      // The home page inlines the name library as window.__njcNames
      // (lib/counter/library.ts). Not visitor content: the rows come from
      // public.names, which only the admin panel's service role can write, and
      // the string is JSON.stringify with `<` escaped so it cannot close the
      // tag. The counter reads it back through a validating library() that falls
      // back to the bundled list rather than trusting what it finds.
      "src/app/(site)/page.tsx",
    ],
    rules: { "react/no-danger": "off" },
  },

  {
    // The clients are where the keys are read. Listed by file so a new module
    // under lib/ does not inherit the exemption. The Razorpay webhook joins this
    // list in Phase 9, and nothing else should.
    files: [
      "src/lib/supabase/server.ts",
      "src/lib/supabase/admin.ts",
      // Phase 9: the purchase store (service role; a webhook has no user session)
      // and the Razorpay client (the only reader of Razorpay's secrets).
      "src/lib/payments/store.ts",
      "src/lib/payments/razorpay.ts",
      // Phase 11: the reminder store (service role; the scheduler has no user),
      // the FCM sender and the cron secret (the only readers of those secrets).
      "src/lib/push/store.ts",
      "src/lib/push/fcm.ts",
      "src/lib/push/cron-secret.ts",
      // The admin gate reads ADMIN_EMAILS and the optional IP allowlist.
      "src/lib/admin.ts",
      // The admin panel (docs/ADMIN.md §1). Reading across accounts is the whole
      // point of a back office, so the restriction that protects the site would
      // only be worked around here. What replaces it: every page and action under
      // src/app/admin calls requireAdmin() itself, and scripts/check-admin-guards.mjs
      // fails the build on any that does not.
      "src/lib/admin/db.ts",
      "src/lib/admin/audit.ts",
    ],
    rules: { "no-restricted-imports": "off" },
  },

  {
    files: ["tests/**/*.{ts,tsx}", "**/*.test.{ts,tsx}", "scripts/**/*.mjs"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];

export default config;
