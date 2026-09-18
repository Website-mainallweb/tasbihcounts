import type { Metadata } from "next";

import PremiumCard from "@/components/PremiumCard";
import StatsView from "@/components/StatsView";
import { appPageMetadata } from "@/lib/seo";

/** Noindex, for the same reason as the streak page. */
export const metadata: Metadata = appPageMetadata(
  "Stats",
  "Your dhikr totals, day by day, month by month.",
);

export default function StatsPage() {
  return (
    <>
      <div className="page-glow" aria-hidden="true" />
      <div className="wrap app-shell">
        <StatsView />
        <PremiumCard variant="inline" />
      </div>
    </>
  );
}
