import Image from "next/image";
import Link from "next/link";
import { LOGO, SITE_NAME } from "@/lib/site";

/**
 * Both lock-ups ship in the markup and CSS reveals the one that suits the
 * active theme. Swapping in JS would flash the wrong ink on first paint.
 *
 * Neither is preloaded. `priority` — and, in this Next.js, `loading="eager"` —
 * put a <link rel=preload> in the head for BOTH lock-ups while the theme only
 * ever shows one, so every page warned "preloaded but not used" and fetched a
 * logo it never painted. The logo is a few KB and never the page's largest
 * paint; the default loading brings the visible one in with the header.
 *
 * Width is derived from the requested height so next/image requests a file
 * sized for the header rather than the full-resolution source.
 */
export default function BrandMark({ height = 32 }: { height?: number }) {
  const box = (l: { width: number; height: number }) => ({
    width: Math.round((l.width / l.height) * height),
    height,
  });

  const light = box(LOGO.light);
  const dark = box(LOGO.dark);

  return (
    <Link href="/" className="brand" aria-label={SITE_NAME}>
      <Image
        className="logo-light"
        src={LOGO.light.src}
        alt={LOGO.alt}
        width={light.width}
        height={light.height}
      />
      <Image
        className="logo-dark"
        src={LOGO.dark.src}
        alt=""
        aria-hidden="true"
        width={dark.width}
        height={dark.height}
      />
    </Link>
  );
}
