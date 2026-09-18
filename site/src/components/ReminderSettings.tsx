"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { browserAccessToken } from "@/lib/counter/sync-client";
import {
  disableReminders,
  enableReminders,
  installationId,
  saveReminderTime,
  type EnableResult,
} from "@/lib/push/push-client";

/**
 * Reminders, on the account page. One reminder a day at a time the user picks,
 * skipped automatically once today's target is met (docs/SPEC.md §3).
 */

const TIMES = Array.from({ length: 48 }, (_, i) => i * 30);

function label(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  const suffix = h < 12 ? "AM" : "PM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

const MESSAGES: Record<Exclude<EnableResult, "enabled">, string> = {
  unsupported: "This browser cannot show reminders.",
  "needs-home-screen":
    "On iPhone and iPad, reminders work only after adding this site to your Home Screen (Share → Add to Home Screen), then opening it from there.",
  denied: "Notifications are blocked for this site. Allow them in your browser's site settings, then try again.",
  dismissed: "Allow notifications when your browser asks, to turn reminders on.",
  "not-signed-in": "Please log in again to change reminders.",
  failed: "Reminders could not be switched on just now. Please try again.",
};

export default function ReminderSettings() {
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  /* Whether the account has reminders on anywhere; kept as it is when only the time changes. */
  const [accountOn, setAccountOn] = useState<boolean | null>(null); // null: not known
  const [remindAt, setRemindAt] = useState(1260);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const id = installationId();
      setSourceId(id);
      const token = await browserAccessToken();
      if (!token) {
        if (!cancelled) setLoaded(true);
        return;
      }
      const query = id ? `?sourceId=${encodeURIComponent(id)}` : "";
      const res = await fetch(`/api/reminders/${query}`, { headers: { Authorization: `Bearer ${token}` } }).catch(
        () => null,
      );
      const data = res?.ok ? await res.json() : null;
      if (cancelled) return;
      if (data) {
        // On for this device: the account has reminders on AND this browser is registered.
        setEnabled(data.enabled === true && data.thisDevice === true);
        setAccountOn(data.enabled === true);
        setRemindAt(typeof data.remindAt === "number" ? data.remindAt : 1260);
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(next: boolean) {
    if (!sourceId) return;
    setBusy(true);
    setMessage(null);
    if (next) {
      const result = await enableReminders(sourceId, remindAt);
      if (result === "enabled") {
        setEnabled(true);
        setAccountOn(true);
      } else setMessage(MESSAGES[result]);
    } else {
      const ok = await disableReminders(sourceId);
      if (ok) setEnabled(false);
      else setMessage("Reminders could not be switched off just now. Please try again.");
    }
    setBusy(false);
  }

  async function changeTime(minute: number) {
    setRemindAt(minute);
    setMessage(null);
    setBusy(true);
    if (enabled && sourceId) {
      const result = await enableReminders(sourceId, minute);
      if (result !== "enabled") setMessage(MESSAGES[result]);
    } else if (accountOn !== null && !(await saveReminderTime(minute, accountOn))) {
      /* B43: saved while off too, so the time picked is the one that comes back. */
      setMessage("The time could not be saved just now. Please try again.");
    }
    setBusy(false);
  }

  /* B45: the card is drawn here, so no empty card shows while this loads. */
  if (!loaded) return null;

  return (
    <div className="panel-card">
      <section className="account-reminders" aria-labelledby="reminders-title">
        <h2 id="reminders-title">Reminders</h2>

        {!sourceId ? (
          <p className="account-note">
            Open the <Link href="/">counter</Link> once on this device, then come back here to switch reminders on.
          </p>
        ) : (
          <>
            <label className="reminder-toggle">
              <input type="checkbox" checked={enabled} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
              <span>Remind me on this device if I have not finished my target</span>
            </label>

            <label className="reminder-time">
              <span>At</span>
              <select value={remindAt} disabled={busy} onChange={(e) => changeTime(Number(e.target.value))}>
                {TIMES.map((m) => (
                  <option key={m} value={m}>
                    {label(m)}
                  </option>
                ))}
              </select>
            </label>
            <p className="account-note">The time is the same on every device where reminders are on.</p>
          </>
        )}

        {message && (
          <p className="auth-alert" role="alert">
            {message}
          </p>
        )}
      </section>
    </div>
  );
}
