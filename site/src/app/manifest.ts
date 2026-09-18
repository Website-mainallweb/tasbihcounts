import type { MetadataRoute } from "next";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

/** Replaces the PWA for WP manifest so the site stays installable. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} – ${SITE_TAGLINE}`,
    short_name: SITE_NAME,
    description:
      "An online Nam Jap counter to track daily mantra chanting, mala rounds and streaks.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // No orientation lock (#32): the counter has a layout for a phone on its side.
    background_color: "#fdf8f0",
    theme_color: "#fdf8f0",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
