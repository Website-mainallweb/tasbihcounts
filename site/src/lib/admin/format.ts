/**
 * How the panel writes numbers, money and times.
 *
 * All of it in IST, because the operator is in India and every other timestamp
 * in this project already is. A panel that disagreed with the payment screens
 * about what "yesterday" means would cause exactly the kind of mistake it exists
 * to prevent.
 */

export const when = (iso: string | null | undefined): string =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

export const day = (iso: string | null | undefined): string =>
  iso
    ? new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium" })
    : "—";

/** Paise to rupees. Razorpay works in the smallest unit and so does the database. */
export const money = (paise: number, currency = "INR"): string =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(paise / 100);

export const count = (n: number | string): string =>
  new Intl.NumberFormat("en-IN").format(Number(n));

/** Minutes after local midnight, as the reminder table stores them. 1260 is 9 PM. */
export const clock = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h < 12 ? "AM" : "PM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
};

/** "3 days ago", for the columns where the exact minute is not the point. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return "—";
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 90) return "just now";
  const units: [number, string][] = [
    [60, "minute"],
    [3600, "hour"],
    [86400, "day"],
    [604800, "week"],
    [2592000, "month"],
  ];
  let value = seconds;
  let label = "second";
  for (const [size, name] of units) {
    if (seconds < size) break;
    value = seconds / size;
    label = name;
  }
  const n = Math.floor(value);
  return `${n} ${label}${n === 1 ? "" : "s"} ago`;
}
