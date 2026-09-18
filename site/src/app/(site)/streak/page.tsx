import type { Metadata } from "next";

import PremiumCard from "@/components/PremiumCard";
import StreakView from "@/components/StreakView";
import { appPageMetadata } from "@/lib/seo";

/**
 * Deliberately noindex. This page shows one person's own practice and holds no
 * copy a search engine could use; letting it be crawled would add a thin page to
 * the site for no gain.
 */
export const metadata: Metadata = appPageMetadata(
  "Streak",
  "Your day-by-day nam jap streak.",
);

export default function StreakPage() {
  return (
    <>
      <div className="page-glow" aria-hidden="true" />
      <div className="wrap app-shell">
        <StreakView />
        <PremiumCard variant="inline" />
      </div>
    </>
  );
}
