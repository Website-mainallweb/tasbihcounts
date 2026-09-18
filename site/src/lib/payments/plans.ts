/**
 * What can be bought. One plan today.
 *
 * The price is written here once and copied onto every purchase row when the
 * order is created (ARCHITECTURE M10). The webhook checks a payment against
 * that row, never against this file — so a later plan can cost something else
 * without touching anyone who already bought.
 */

export type Plan = {
  id: "premium_lifetime_v1";
  name: string;
  /** In the smallest unit, paise, as Razorpay expects. */
  amount: number;
  currency: "INR";
  /** How the price is shown to people. */
  display: string;
};

export const CURRENT_PLAN: Plan = {
  id: "premium_lifetime_v1",
  name: "Bhakti Nam Jap Premium — lifetime",
  amount: 20000,
  currency: "INR",
  display: "₹200",
};
