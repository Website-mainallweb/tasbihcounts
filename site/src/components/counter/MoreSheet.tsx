"use client";

/**
 * Modes, feedback, appearance, data, and the Lifetime Plus surface.
 * Specification sections 23, 24, 24C, 26, 27, 28, 30, 110, 117, 126, 128, 130.
 */

import { useRef, useState } from "react";
import { Sheet, SheetSection, Row, Switch } from "@/components/ui/Sheet";
import { ShareButton } from "@/components/site/ShareButton";
import { StorageNotice } from "@/components/site/StorageNotice";
import { useCounter } from "@/stores/counter-store";
import { useSettings } from "@/stores/settings-store";
import { canOfferPace, paceLabel, SPEEDS, tapsLearned, learnedIntervalMs, type Speed } from "@/core/autocount";
import { hasVibration, hasWakeLock, isIOS, ticker, TICK_SOUNDS } from "@/lib/feedback";
import { clearDeviceData } from "@/lib/storage";
import * as Ledger from "@/lib/counter/ledger";
import { currentAccount } from "@/lib/auth";
import { formatCount } from "@/core/format";
// PLANS is no longer read here: the price shown on this sheet moved to the
// pricing page, where the viewer's own currency is resolved (gap 30).
import type { ThemeChoice } from "@/core/types";

const TIMED = [60, 300, 600];

export function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useCounter();
  const st = useSettings();
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearRefused, setClearRefused] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  // Read once per open; the header owns the live account state.
  const account = currentAccount();

  const learned = tapsLearned(s.learner);
  const interval = learnedIntervalMs(s.learner);
  const canAuto = canOfferPace(s.learner) && interval !== null;

  return (
    <Sheet open={open} onClose={onClose} title="More">
      {/* From lg up the right rail already shows the practice tiles, the mode
          switches and the feedback toggles. Repeating them inside a dialog
          that covers the rail showing them is noise, so those blocks are
          hidden here at that width and the rail is the one surface. The rows
          that are NOT on the rail — history, sequences, appearance, data,
          account — stay at every width. */}
      <div className="md:hidden">
      {/* ---------- stats ---------- */}
      <SheetSection label="Your practice">
        <div className="grid grid-cols-3 gap-2">
          <Tile label="Today" value={formatCount(s.today, st.locale, st.numerals)} />
          <Tile
            label="Streak"
            value={s.streak.current > 0 ? `${s.streak.current}d` : "—"}
          />
          <Tile label="Lifetime" value={formatCount(s.lifetime, st.locale, st.numerals)} />
        </div>

        {/* Gap 15: the only growth loop this product has that costs nobody
            anything and asks nothing of the reader. */}
        <ShareButton />
        <StorageNotice />

        <div className="mt-3 flex items-center justify-between gap-1 rounded-[var(--radius-sm)] border border-border bg-surface-sunken px-3 py-3">
          {s.streak.week.map((d) => (
            <div key={d.localDate} className="flex flex-1 flex-col items-center gap-1.5">
              <span className="text-[10px] font-medium uppercase text-fg-subtle">
                {d.label}
              </span>
              <span
                className={`grid h-6 w-6 place-items-center rounded-full text-[11px] ${
                  d.done
                    ? "bg-accent text-fg-on-accent"
                    : d.isToday
                      ? "border border-dashed border-border-strong text-fg-subtle"
                      : "border border-border text-fg-subtle"
                }`}
              >
                {d.done ? "✓" : ""}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 px-1 text-[12px] text-fg-subtle">
          Continue whenever you are ready.
        </p>
      </SheetSection>
      </div>

      {/* Always here: neither of these is on the rail. */}
      <SheetSection label="Your practice" quietLabel>
        <div>
          <Row
            label="Stats"
            hint="Totals, the last days, and the breakdown by dhikr"
            href="/stats/"
          />
          <Row
            label="Streak"
            hint="Your practice day by day"
            href="/streak/"
          />
        </div>
      </SheetSection>

      <div className="md:hidden">
      {/* ---------- modes ---------- */}
      <SheetSection label="Modes">
        <Row
          label="Countdown"
          hint="Count down to zero instead of up"
          right={
            <Switch
              label="Countdown"
              checked={st.countdown}
              onChange={() => st.toggle("countdown")}
            />
          }
        />

        <div className="px-3 py-2">
          <p className="mb-2 text-[13px] text-fg-muted">Timed session</p>
          <div className="grid grid-cols-3 gap-2">
            {TIMED.map((sec) => (
              <button
                key={sec}
                type="button"
                onClick={() => {
                  s.startTimed(sec);
                  onClose();
                }}
                className="min-h-[44px] rounded-[var(--radius-sm)] border border-border px-2 py-2.5 text-[13px] font-medium text-fg-muted hover:border-border-strong hover:text-fg"
              >
                {sec / 60} min
              </button>
            ))}
          </div>
          {/* Starting a timer used to be one way. There was no control anywhere
              that stopped it short of letting it run out. */}
          {s.state.timerSeconds !== null ? (
            <button
              type="button"
              onClick={() => {
                s.stopTimed();
                onClose();
              }}
              className="mt-2 min-h-[44px] w-full rounded-[var(--radius-sm)] border border-border px-2 text-[13px] font-medium text-fg-muted hover:border-border-strong hover:text-fg"
            >
              Stop the timer
            </button>
          ) : null}
        </div>

        {/* Section 24C */}
        <div className="mt-1 rounded-[var(--radius-sm)] border border-border bg-surface-sunken p-3">
          <p className="text-[14px] font-medium">Auto count</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
            Tap at your own pace about ten times, then let the counter keep that
            pace so your hands are free. It is a convenience, nothing more.
          </p>

          {canAuto ? (
            <>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-[12px] text-fg-subtle">
                  {paceLabel(
                    Math.round((interval ?? 1000) / s.autoSpeed),
                    st.locale,
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => (s.autoRunning ? s.stopAuto() : s.startAuto())}
                  className={`rounded-full px-4 py-2 text-[13px] font-medium ${
                    s.autoRunning
                      ? "border border-border text-fg-muted"
                      : "bg-accent text-fg-on-accent"
                  }`}
                >
                  {s.autoRunning ? "Stop" : "Start"}
                </button>
              </div>
              <div className="mt-2 flex gap-1.5">
                {SPEEDS.map((sp) => (
                  <button
                    key={sp}
                    type="button"
                    onClick={() => s.setAutoSpeed(sp as Speed)}
                    className={`min-h-[44px] flex-1 rounded-full border px-1 text-[11.5px] font-medium ${
                      s.autoSpeed === sp
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-border text-fg-subtle"
                    }`}
                  >
                    {sp}x
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-2 text-[12px] text-fg-subtle">
              {learned} of 10 taps learned.
            </p>
          )}
        </div>
      </SheetSection>

      {/* ---------- feedback ---------- */}
      {/* Gap 8: the one way back into the app, and deliberately the quietest
          one available — local only, no server, no push endpoint. */}
      <SheetSection label="Reminder">
        <Row
          label="Daily reminder"
          hint={account ? "Choose the time on your account page" : "A Premium feature: a gentle nudge at the time you choose"}
          href={account ? "/account/" : "/premium/"}
        />
      </SheetSection>

      <SheetSection label="Sound">
        {/* Gap 12: one tone, heard several thousand times in a sitting, meant
            "I do not like it" became "I count in silence". */}
        <div className="flex flex-wrap gap-1.5">
          {TICK_SOUNDS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => {
                st.set("tickSound", t.value);
                // Play it, so the choice is made by ear rather than by name.
                if (t.value !== "none") {
                  ticker.unlock();
                  ticker.setSound(t.value);
                  ticker.play("tap", true);
                }
              }}
              aria-pressed={st.tickSound === t.value}
              title={t.hint}
              className={`min-h-[44px] rounded-full border px-3.5 text-[13px] font-medium ${
                st.tickSound === t.value
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border text-fg-muted"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <label className="mt-3 block px-1">
          <span className="text-[12.5px] font-medium text-fg-muted">Volume</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(st.volume * 100)}
            onChange={(e) => {
              const next = Number(e.target.value) / 100;
              st.set("volume", next);
              ticker.setVolume(next);
            }}
            onPointerUp={() => {
              ticker.unlock();
              ticker.play("tap", st.sound);
            }}
            className="mt-1.5 w-full accent-[var(--accent)]"
            aria-label="Tick volume"
          />
        </label>
      </SheetSection>

      <SheetSection label="Feedback">
        <Row
          label="Sound"
          hint="A quiet tick on each count"
          right={
            <Switch label="Sound" checked={st.sound} onChange={() => st.toggle("sound")} />
          }
        />
        {hasVibration() ? (
          <Row
            label="Vibration"
            hint="Strong enough to feel with your eyes closed"
            right={
              <Switch
                label="Vibration"
                checked={st.vibration}
                onChange={() => st.toggle("vibration")}
              />
            }
          />
        ) : (
          <Row
            label="Vibration"
            hint={
              isIOS()
                ? "Not available in Safari on iPhone or iPad. Use sound instead."
                : "Not supported by this browser."
            }
            right={<Switch label="Vibration" checked={false} onChange={() => {}} disabled />}
          />
        )}
        {hasWakeLock() ? (
          <Row
            label="Keep screen awake"
            hint="While you are counting"
            right={
              <Switch
                label="Keep screen awake"
                checked={st.wakeLock}
                onChange={() => st.toggle("wakeLock")}
              />
            }
          />
        ) : null}
      </SheetSection>
      </div>

      {/* ---------- appearance ---------- */}
      <SheetSection label="Appearance">
        {/* Gap 11: the ring is the brand mark and the right default, but a lot
            of people want the strand they already hold in their hand. */}
        <div className="mb-3">
          <span className="mb-1.5 block px-1 text-[12.5px] font-medium text-fg-muted">
            Counter face
          </span>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["ring", "Bead ring"],
                ["beads", "Strand"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => st.set("skin", v)}
                aria-pressed={st.skin === v}
                className={`min-h-[44px] rounded-[var(--radius-sm)] border px-2 text-[13px] font-medium ${
                  st.skin === v
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-border text-fg-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["system", "System"],
              ["light", "Light"],
              ["dark", "Dark"],
            ] as [ThemeChoice, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => st.setTheme(v)}
              className={`rounded-[var(--radius-sm)] border px-2 py-2.5 text-[13px] font-medium min-h-[44px] ${
                st.theme === v
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border text-fg-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <p className="mt-3 mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">
          Premium themes
        </p>
        <div className="grid grid-cols-2 gap-2">
          <ThemePreview
            name="Midnight Noor"
            swatch={["#050607", "#0c0e10", "#cfa15f"]}
            active={st.theme === "noor"}
            onPreview={() => st.setTheme("noor")}
          />
          <ThemePreview
            name="Emerald Heritage"
            swatch={["#0a1f1a", "#0f2a23", "#d8c9a8"]}
            active={st.theme === "heritage"}
            onPreview={() => st.setTheme("heritage")}
          />
        </div>
        <p className="mt-2 px-1 text-[12px] leading-relaxed text-fg-subtle">
          Try either one now — they are not hidden behind a lock.
        </p>

        <Row
          label="Numerals"
          hint="Latin or Eastern Arabic digits"
          right={
            <div className="flex gap-1.5">
              {(
                [
                  ["latin", "123"],
                  ["arabic-indic", "١٢٣"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => st.set("numerals", v)}
                  className={`min-h-[44px] rounded-full border px-3 text-[13px] ${
                    st.numerals === v
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border text-fg-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          }
        />
      </SheetSection>

      {/* ---------- Premium ---------- */}
      <SheetSection label="Premium">
        <div className="rounded-[var(--radius-md)] border border-accent-line bg-accent-soft p-4">
          <p className="font-display text-[17px] font-semibold">
            Keep your practice, on every device
          </p>
          <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-fg-muted">
            <li>Your practice on all your devices</li>
            <li>Safe in your account if a device is lost</li>
            <li>Daily reminders</li>
            <li>No advertisements, ever</li>
          </ul>
          <p className="mt-3 text-[13px] font-medium">
            One payment, for life.
          </p>
          <a
            href="/premium/"
            className="mt-3 inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-accent px-4 text-[14px] font-medium text-fg-on-accent transition-colors hover:bg-accent-hover"
          >
            See Premium
          </a>
        </div>
      </SheetSection>

      {/* ---------- data (section 117) ---------- */}
      <SheetSection label="Your data">
        <p className="mb-2 px-1 text-[12.5px] leading-relaxed text-fg-muted">
          {account
            ? "You are signed in. What you count syncs to your account, so it survives this device."
            : "Everything you count stays in this browser. Keep a backup file somewhere safe."}
        </p>
        <Row
          label="Back up"
          hint="Download your practice as a file"
          onClick={() => Ledger.exportBackup()}
        />
        <Row
          label="Restore"
          hint="Add the counts from a backup file. Nothing is removed."
          onClick={() => file.current?.click()}
        />
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) {
              Ledger.importBackup(f);
              onClose();
            }
          }}
        />
        {confirmClear ? (
          <div className="rounded-[var(--radius-sm)] border border-danger bg-danger-soft p-3">
            <p className="text-[13.5px] leading-relaxed text-fg">
              This permanently deletes every count, session and custom dhikr on
              this device. It cannot be undone.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  // The ledger refuses once anything has reached the account:
                  // the next sync would bring it straight back.
                  const r = Ledger.eraseAll();
                  if (!r.ok) {
                    setConfirmClear(false);
                    setClearRefused(r.reason ?? null);
                    return;
                  }
                  await clearDeviceData();
                  location.reload();
                }}
                className="flex-1 rounded-full bg-danger px-4 py-2.5 text-[13px] font-medium text-white"
              >
                Delete everything
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="rounded-full border border-border px-4 py-2.5 text-[13px] text-fg-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : clearRefused ? (
          <p className="rounded-[var(--radius-sm)] border border-border bg-surface-sunken p-3 text-[13px] leading-relaxed text-fg-muted">
            {clearRefused}
          </p>
        ) : (
          <Row
            label="Clear data from this device"
            danger
            onClick={() => setConfirmClear(true)}
          />
        )}

        {/* Anything that belongs to the ACCOUNT rather than to this device —
            the profile, sync, the plan, deletion — lives on the account screen
            (section 117). This sheet stays about the counter and this device. */}
        {account ? (
          <Row
            label="Account settings"
            hint="Sync, reminders, password and your plan."
            href="/account/"
          />
        ) : null}
      </SheetSection>

      <SheetSection label="Keyboard">
        <p className="px-1 text-[12.5px] leading-relaxed text-fg-muted">
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[11px]">Space</kbd>{" "}
          count ·{" "}
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[11px]">Z</kbd>{" "}
          undo ·{" "}
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[11px]">Esc</kbd>{" "}
          close
        </p>
      </SheetSection>
    </Sheet>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-border bg-surface-sunken px-2 py-3 text-center">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">
        {label}
      </div>
      <div className="tabular mt-1 font-display text-[19px] leading-none">{value}</div>
    </div>
  );
}

function ThemePreview({
  name,
  swatch,
  active,
  onPreview,
}: {
  name: string;
  swatch: [string, string, string];
  active: boolean;
  onPreview: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPreview}
      className={`overflow-hidden rounded-[var(--radius-sm)] border text-left transition-all ${
        active ? "border-accent" : "border-border hover:border-border-strong"
      }`}
    >
      <span
        className="flex h-16 items-center justify-center"
        style={{ background: swatch[0] }}
      >
        <span
          className="grid h-9 w-9 place-items-center rounded-full"
          style={{ background: swatch[1] }}
        >
          <span
            className="block h-2.5 w-2.5 rounded-full"
            style={{ background: swatch[2] }}
          />
        </span>
      </span>
      <span className="flex items-center justify-between gap-1 px-2.5 py-2">
        <span className="text-[12.5px] font-medium">{name}</span>
        <span className="rounded-full bg-warm-soft px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-warm">
          Plus
        </span>
      </span>
    </button>
  );
}
