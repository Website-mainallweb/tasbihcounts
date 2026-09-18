"use client";

import { useEffect } from "react";

import { writePremiumFlag } from "@/lib/premium-flag";

/**
 * Records, in this browser, the Premium status the server just confirmed — so
 * the static pages can keep ads off. Renders nothing.
 */
export default function PremiumFlag({ active }: { active: boolean }) {
  useEffect(() => {
    writePremiumFlag(active);
  }, [active]);
  return null;
}
