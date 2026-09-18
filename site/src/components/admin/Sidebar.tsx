import { signOut } from "@/app/admin/login/actions";
import { SideNav } from "@/components/admin/SideNav";

/**
 * The rail down the left-hand side (Rajan, 2026-09-15).
 *
 * Rendered once by app/admin/layout.tsx rather than by each page, so a screen
 * cannot be built that quietly has no way out of itself.
 *
 * Below 900px it stops being a rail — a full-height column on a 375px screen
 * would leave the tables no room — and becomes a bar across the top whose links
 * scroll sideways.
 */
export function Sidebar({ email }: { email: string }) {
  const initial = email.trim().charAt(0).toUpperCase() || "?";

  return (
    <aside className="admin-side">
      <div className="side-brand">
        <span className="side-mark" aria-hidden="true">
          ۞
        </span>
        <span className="side-name">
          Tasbih Counts
          <small>Admin</small>
        </span>
      </div>

      <SideNav />

      <div className="side-foot">
        <span className="side-avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="side-who" title={email}>
          {email}
        </span>
        <form action={signOut}>
          <button type="submit" className="btn-quiet side-out">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}

/**
 * The mode banner.
 *
 * Shown on every screen that talks about money, because the single most
 * expensive mistake available in this panel is reading a test-mode number as a
 * real one — or refunding a real payment believing it is a test.
 */
export function ModeBanner({ mode }: { mode: "test" | "live" }) {
  if (mode === "live") return null;
  return (
    <p className="banner banner-warn">
      <strong>Test mode.</strong> Every figure below counts test-mode payments only, and no
      entitlement granted now will survive going live.
    </p>
  );
}
