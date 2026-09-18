"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The panel's sections, with the one you are on marked.
 *
 * A client component only for `usePathname`. Knowing where you are is not
 * decoration in a tool with nine screens that all look similar at a glance —
 * without it, the commonest mistake is acting on the right row of the wrong
 * page.
 *
 * The icons are inline paths rather than an icon font or a package: nine glyphs
 * are not worth a dependency, a network request, or a flash of missing symbols
 * before a font arrives.
 */

const SECTIONS = [
  {
    href: "/admin/",
    label: "Overview",
    d: "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z",
  },
  {
    href: "/admin/users/",
    label: "Users",
    d: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
  },
  {
    href: "/admin/payments/",
    label: "Payments",
    d: "M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z",
  },
  {
    href: "/admin/webhooks/",
    label: "Webhooks",
    d: "M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21z",
  },
  {
    href: "/admin/switches/",
    label: "Switches",
    d: "M17 7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h10c2.76 0 5-2.24 5-5s-2.24-5-5-5zm0 8c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z",
  },
  {
    href: "/admin/names/",
    label: "Names",
    d: "M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z",
  },
  {
    href: "/admin/analytics/",
    label: "Analytics",
    d: "M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z",
  },
  {
    href: "/admin/system/",
    label: "System",
    d: "M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z",
  },
  {
    href: "/admin/audit/",
    label: "Audit",
    d: "M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z",
  },
] as const;

export function SideNav() {
  const path = usePathname();

  /* "/admin/" would otherwise be the prefix of every other section, so the
     overview matches exactly and the rest match their own subtree — which is
     what keeps Users highlighted while you are inside one user. */
  const isHere = (href: string) =>
    href === "/admin/" ? path === "/admin" || path === "/admin/" : path.startsWith(href.slice(0, -1));

  return (
    <nav className="side-nav" aria-label="Sections">
      {SECTIONS.map(({ href, label, d }) => {
        const here = isHere(href);
        return (
          <Link key={href} href={href} aria-current={here ? "page" : undefined}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d={d} fill="currentColor" />
            </svg>
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
