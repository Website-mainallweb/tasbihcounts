import type { Metadata } from "next";

import { Sidebar } from "@/components/admin/Sidebar";
import { resolveAdmin } from "@/lib/admin";
import "./admin.css";

/**
 * The back-office, served at the admin subdomain by this same application
 * (docs/ADMIN.md §1).
 *
 * It renders under the root layout's <html> and nothing else: the header, the
 * promo bar, the footer, the ad loader and the analytics tag all live in
 * app/(site)/layout.tsx, which this is deliberately not inside.
 *
 * The navigation is here rather than on each page, so a screen cannot be added
 * that quietly has no way out of itself.
 *
 * resolveAdmin(), not requireAdmin(): the sign-in page is inside this layout, and
 * a layout that redirected an anonymous visitor would redirect the sign-in page
 * to itself for ever. So the shell appears once there is somebody to show it to,
 * and the sign-in renders bare. This is not the access check — every page and
 * action still calls requireAdmin() itself — and the call is memoised per
 * request, so asking twice costs nothing.
 *
 * Every response here is dynamic and uncached. A cached admin page is somebody's
 * account data sitting in a proxy; next.config.mjs sends `no-store` for the same
 * reason.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin" },
  // Belt and braces with robots.ts and the X-Robots-Tag header. This panel must
  // not turn up in a search result, ever.
  robots: { index: false, follow: false, nocache: true, noarchive: true, nosnippet: true },
  // `other` replaces the root layout's wholesale rather than merging, which is
  // what stops the site-wide robots line from re-enabling indexing here.
  other: { robots: "noindex, nofollow, noarchive, nosnippet" },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const state = await resolveAdmin();

  if (!state.ok) return <div className="admin-root">{children}</div>;

  return (
    <div className="admin-root">
      <div className="admin-shell">
        {/* The content comes first in the document and the rail second, so a
            screen reader and the tab key reach the page before the menu. CSS
            puts the rail back on the left, and on a narrow screen on top, where
            a thumb expects a menu. */}
        <main className="admin-main" id="content">
          {children}
        </main>
        <Sidebar email={state.admin.email} />
      </div>
    </div>
  );
}
