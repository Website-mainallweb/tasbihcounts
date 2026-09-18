import type { ReactNode } from "react";

import PremiumCard from "./PremiumCard";

/**
 * The frame every reading page shares: the article in a card that takes the
 * whole width the side column leaves, and the side column itself — the Premium
 * card, and on the home page the desktop ad rail.
 *
 * The aside comes AFTER the article in the markup, so a reader, a screen reader
 * and a crawler all meet the page's own copy first.
 */
export default function ArticleFrame({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="page-grid">
      <div className="page-main article-card">{children}</div>
      <div className="page-aside">
        <PremiumCard />
        {aside}
      </div>
    </div>
  );
}
