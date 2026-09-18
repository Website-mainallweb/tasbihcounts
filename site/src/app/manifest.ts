import type { MetadataRoute } from "next";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

/** Keeps the site installable, with shortcuts straight into a dhikr or routine. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} – ${SITE_TAGLINE}`,
    short_name: SITE_NAME,
    description:
      "A free online tasbih counter for daily dhikr: targets, guided 33-33-34 after salah, the 99 Names, streaks. Works offline.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // No orientation lock (#32): the counter has a layout for a phone on its side.
    background_color: "#faf8f4",
    theme_color: "#faf8f4",
    shortcuts: [
      { name: "SubhanAllah", url: "/?d=subhanallah" },
      { name: "After Salah 33-33-34", url: "/?r=after-salah-33-33-34" },
      { name: "Astaghfirullah", url: "/?d=astaghfirullah" },
    ],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
