import type { Metadata } from "next";

import { toggleFlag } from "./actions";
import { requireAdmin } from "@/lib/admin";
import { listFlags } from "@/lib/admin/db";
import { when } from "@/lib/admin/format";

export const metadata: Metadata = { title: "Switches" };

type Props = { searchParams: Promise<{ m?: string }> };

/** Plain names for the keys, in the order it is useful to see them. */
const LABELS: Record<string, string> = {
  payments: "Payments",
  google_login: "Google sign-in",
  cloud_sync: "Cloud sync",
  reminders: "Reminders",
  ads: "Ads",
  promo_bar: "Announcement bar",
  maintenance_mode: "Maintenance notice",
};

const ORDER = [
  "payments",
  "google_login",
  "cloud_sync",
  "reminders",
  "ads",
  "promo_bar",
  "maintenance_mode",
];

/**
 * The kill switches (docs/ADMIN.md §3.8).
 *
 * Every one of these can be off at the same time and the counter still counts,
 * still saves, still shows the streak. That is the product's promise and it is
 * kept by the database, not by this page: the `key` column is a closed list that
 * does not contain the counter, so a switch for it cannot be created — not by a
 * future screen, not by hand, not in a hurry.
 *
 * Maintenance mode reads backwards from the others: it is off in normal
 * operation, and turning it *on* is the disruptive act. The button says what
 * will happen rather than showing a state, so the direction cannot be misread.
 */
export default async function SwitchesPage({ searchParams }: Props) {
  await requireAdmin();
  const { m } = await searchParams;
  const flags = await listFlags();

  const sorted = [...flags].sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));

  return (
    <>
      <div className="wrap">
        <p className="eyebrow">Read by the site within a minute</p>
        <h1>Switches</h1>
        <p className="lede">
          Turning one of these off stops that system and nothing else. Each change is recorded with
          who made it.
        </p>

        <div aria-live="polite">{m && <p className="banner">{m}</p>}</div>

        <section className="card">
          {sorted.map((flag) => {
            const inverted = flag.key === "maintenance_mode";
            const on = flag.enabled;
            const willBe = !on;
            return (
              <div className="switch" key={flag.key}>
                <div className="switch-text">
                  <h3>
                    {LABELS[flag.key] ?? flag.key}{" "}
                    <span className={`pill ${on === !inverted ? "pill-good" : "pill-bad"}`}>
                      {inverted ? (on ? "showing" : "off") : on ? "on" : "off"}
                    </span>
                  </h3>
                  <p>{flag.note}</p>
                  <p className="pending">Last changed {when(flag.updated_at)}</p>
                </div>
                <form action={toggleFlag}>
                  <input type="hidden" name="key" value={flag.key} />
                  <input type="hidden" name="enabled" value={willBe ? "yes" : "no"} />
                  <button type="submit" className={willBe === !inverted ? "quiet" : "danger"}>
                    {inverted
                      ? willBe
                        ? "Show the notice"
                        : "Hide the notice"
                      : willBe
                        ? "Turn on"
                        : "Turn off"}
                  </button>
                </form>
              </div>
            );
          })}
        </section>

        <p className="protected">
          <strong>The counter is not on this list, and cannot be added to it.</strong> Every switch
          above can be off at once and a visitor can still open the site, count, save, and see their
          streak. The database refuses to store a switch by any other name, so no future screen can
          quietly introduce one.
        </p>
      </div>
    </>
  );
}
