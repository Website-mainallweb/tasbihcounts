/**
 * Every destination on the site, in two groups.
 *
 * One navigation, in the header. From 1024 up the app's own destinations sit in
 * the header row beside the logo and the marketing pages are under More; below
 * 1024 both groups are in the side drawer behind the menu button, where the
 * icons and hints are shown.
 */

export type AppDestination = {
  /** A route, or a `#hash` handled by the counter widget. */
  href: string;
  label: string;
  /** Shown under the label on the widest layout. */
  hint: string;
  /** 24x24 path data, stroked. */
  icon: string;
  /**
   * True for the two that open a sheet inside the counter rather than
   * navigating. They land on the counter page first when opened from elsewhere.
   */
  sheet?: boolean;
};

export const APP_NAV: AppDestination[] = [
  {
    href: "/",
    label: "Counter",
    hint: "Chant and count",
    icon: "M12 3a9 9 0 100 18 9 9 0 000-18zm0 4v5l3 2",
  },
  {
    href: "/streak/",
    label: "Streak",
    hint: "Day by day",
    icon: "M12 3s5 4.5 5 9a5 5 0 01-10 0c0-1.7.8-3.2 1.7-4.4C9.6 6.4 12 3 12 3z",
  },
  {
    href: "/stats/",
    label: "Stats",
    hint: "Your practice",
    icon: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  },
  {
    href: "/#library",
    label: "Library",
    hint: "Names and mantras",
    icon: "M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3V4zm0 13a3 3 0 013-3h11",
    sheet: true,
  },
  {
    href: "/#settings",
    label: "Settings",
    hint: "Theme, target, backup",
    icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM4 12h1m14 0h1M12 4v1m0 14v1M6.3 6.3l.7.7m10 10l.7.7m0-11.4l-.7.7m-10 10l-.7.7",
    sheet: true,
  },
];

/**
 * A sheet destination is a plain anchor, never a next/link.
 *
 * next/link navigates with history.pushState, and pushState does not fire
 * hashchange — so the URL would gain its #library and the counter would never
 * hear about it. A real anchor fires the event on the same page, and performs an
 * ordinary navigation from any other, where the engine reads the hash at boot.
 */
export const isSheet = (href: string): boolean => href.includes("#");

/** The hash fragments the counter knows how to open. */
export const SHEET_HASHES: Record<string, string> = {
  "#library": "library",
  "#settings": "settings",
};

/** Whether a destination is the page currently being viewed. */
export function isCurrent(href: string, pathname: string): boolean {
  if (href.includes("#")) return false; // a sheet is never "the page"
  const here = pathname.endsWith("/") ? pathname : `${pathname}/`;
  return here === href;
}

/**
 * The marketing pages, given icons so they can sit in the same column as the
 * app's own destinations. `NAV` in site.ts stays the list the wide header used
 * to render; this adds only what a sidebar needs.
 */
export const MORE_NAV: AppDestination[] = [
  {
    href: "/about-us/",
    label: "About Us",
    hint: "Who this is for",
    icon: "M12 12a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 0114 0",
  },
  {
    href: "/contact-us/",
    label: "Contact Us",
    hint: "Get in touch",
    icon: "M4 6h16v12H4zM4 7l8 6 8-6",
  },
  {
    href: "/privacy-policy/",
    label: "Privacy Policy",
    hint: "What is stored",
    icon: "M12 3l7 3v6c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6l7-3z",
  },
  {
    href: "/terms/",
    label: "Terms of Service",
    hint: "Using the site and Premium",
    icon: "M7 3h7l5 5v13H7V3zm7 0v5h5M10 13h6M10 17h6",
  },
  {
    href: "/refund-policy/",
    label: "Refund Policy",
    hint: "Payments and refunds",
    icon: "M4 12a8 8 0 102.3-5.7M4 4v4h4",
  },
];

/** Premium and Log in are the header's two buttons, not menu entries. The crown is
    drawn filled (a solid shape reads as "Pro" at 16px; an outline did not). */
export const PREMIUM_ICON = "M2.5 7.2l5 4.3L12 4l4.5 7.5 5-4.3-2 11.3H4.5L2.5 7.2zM4.5 20h15v1.6h-15z";
export const LOGIN_ICON = "M10 17l5-5-5-5M15 12H3M14 4h5a2 2 0 012 2v12a2 2 0 01-2 2h-5";
