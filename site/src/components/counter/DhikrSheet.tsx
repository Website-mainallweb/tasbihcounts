"use client";

/**
 * The one place a user chooses what to count.
 * Specification sections 31, 32, 33, 47, 49, 136.1.
 *
 * Everything selectable lives here so nothing has to be hunted for elsewhere:
 * guided routines, every dhikr, all 99 Names, and your own. A segmented
 * control switches between them, so each view is one screen rather than one
 * long scroll.
 *
 * Search matches Arabic, transliteration, English, spelling variants and the
 * dominant local term in each launch market, so "zikirmatik", "tesbih",
 * "darood" and "istegfar" all resolve.
 */

import { useMemo, useState } from "react";
import { Sheet, SheetSection } from "@/components/ui/Sheet";
import { SourceNote } from "@/components/seo/SourceNote";
import { visibleDhikr, getDhikr } from "@/content/dhikr";
import { routineTotal, visibleRoutines } from "@/content/routines";
import { ASMA, ASMA_ID_PREFIX, ASMA_TOTAL } from "@/content/asma";
import { RITE_DHIKR } from "@/content/rites";
import { RITES, RITE_LAPS, isRiteId } from "@/core/rites";
import { searchKey, normaliseTarget } from "@/core/format";
import { useCounter } from "@/stores/counter-store";
import type { Dhikr, DhikrCategory } from "@/core/types";

const CATEGORY_LABEL: Partial<Record<DhikrCategory, string>> = {
  tasbih: "Tasbih",
  istighfar: "Istighfar",
  tahlil: "Tahlil",
  durood: "Durood & Salawat",
  recitation: "Recitation",
  "morning-evening": "Morning & Evening",
  // Talbiyah is a phrase, so it sits in the ordinary grid under its own
  // heading; Tawaf and Sa'i are trackers and have their own section above.
  hajj: "Hajj & Umrah",
  mine: "My Dhikr",
};

type View = "dhikr" | "asma" | "mine";

export function DhikrSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useCounter();
  const [q, setQ] = useState("");
  const selectedDhikr = getDhikr(s.state.dhikrId);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [view, setView] = useState<View>("dhikr");
  const [creating, setCreating] = useState(false);

  const query = searchKey(q);

  const dhikrList = useMemo(() => {
    const all = visibleDhikr();
    if (!query) return all;
    return all.filter((d) => {
      const hay = searchKey([d.name, d.transliteration, d.meaning, ...d.aliases].join(" "));
      return hay.includes(query) || d.arabic.includes(q.trim());
    });
  }, [query, q]);

  const routineList = useMemo(() => {
    const all = visibleRoutines();
    if (!query) return all;
    return all.filter((r) =>
      searchKey([r.title, r.description, ...r.aliases].join(" ")).includes(query),
    );
  }, [query]);

  /* Hajj and Umrah (sections 50 to 53).
   *
   * Tawaf and Sa'i are not members of DHIKR — they are not phrases, and a
   * custom sequence has no business taking "Tawaf" as a step — so they would
   * never reach the grid below. They get their own group, which is also where
   * the Master puts them, and they are searchable like everything else. */
  const riteList = useMemo(() => {
    if (!query) return RITE_DHIKR;
    return RITE_DHIKR.filter((d) =>
      searchKey([d.name, d.meaning, ...d.aliases].join(" ")).includes(query),
    );
  }, [query]);

  const asmaList = useMemo(() => {
    if (!query) return ASMA;
    return ASMA.filter(
      (a) =>
        searchKey(`${a.transliteration} ${a.meaning}`).includes(query) ||
        a.arabic.includes(q.trim()) ||
        String(a.index) === q.trim(),
    );
  }, [query, q]);

  const mineList = useMemo(() => {
    if (!query) return s.customDhikr;
    return s.customDhikr.filter((d) =>
      searchKey([d.name, d.meaning].join(" ")).includes(query),
    );
  }, [query, s.customDhikr]);

  const grouped = useMemo(() => {
    const map = new Map<DhikrCategory, Dhikr[]>();
    for (const d of dhikrList) map.set(d.category, [...(map.get(d.category) ?? []), d]);
    return [...map.entries()];
  }, [dhikrList]);

  const pick = (id: string) => {
    void s.selectDhikr(id);
    onClose();
  };

  const nothingFound =
    view === "dhikr"
      ? dhikrList.length === 0 && routineList.length === 0 && riteList.length === 0
      : view === "asma"
        ? asmaList.length === 0
        : mineList.length === 0 && !creating;

  return (
    <Sheet open={open} onClose={onClose} title="Choose Dhikr" maxHeight="92vh">
      {/* ---------- search and the three views, always visible ---------- */}
      <div className="sticky top-0 z-10 -mx-5 bg-surface px-5 pb-2 pt-1">
        <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-surface-sunken px-3">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
            <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search dhikr, zikr, tasbeeh, durood…"
            aria-label="Search dhikr"
            className="w-full bg-transparent py-2.5 text-[14px] outline-none placeholder:text-fg-subtle md:py-3 md:text-[15px]"
          />
        </div>

        <div className="mt-2 flex gap-1.5" role="tablist" aria-label="What to count">
          <ViewTab
            label="Dhikr"
            count={dhikrList.length + routineList.length + riteList.length}
            active={view === "dhikr"}
            onClick={() => setView("dhikr")}
          />
          <ViewTab
            label="99 Names"
            count={asmaList.length}
            active={view === "asma"}
            onClick={() => setView("asma")}
          />
          <ViewTab
            label="Mine"
            count={mineList.length}
            active={view === "mine"}
            onClick={() => setView("mine")}
          />
        </div>
      </div>

      {/* ================= DHIKR AND ROUTINES ================= */}
      {view === "dhikr" ? (
        <>
          {routineList.length > 0 ? (
            <SheetSection label="Guided routines" quietLabel>
              <ul className="grid grid-cols-2 gap-1 md:grid-cols-1">
                {routineList.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => {
                        void s.startRoutine(r.id);
                        onClose();
                      }}
                      className="flex h-full min-h-[46px] w-full flex-col items-start justify-center gap-1 rounded-[var(--radius-sm)] border border-border bg-surface px-2.5 py-1.5 text-left transition-colors hover:border-border-strong md:flex-row md:items-center md:border-transparent md:bg-transparent md:px-3 md:py-3 md:hover:bg-surface-sunken"
                    >
                      <span className="min-w-0">
                        <span className="block text-[11.5px] font-medium leading-tight md:text-[15px]">
                          {r.title}
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] leading-tight text-fg-muted md:text-[13px]">
                          {r.steps.map((st) => st.target).join(" · ")} = {routineTotal(r)}
                        </span>
                      </span>
                      <span className="hidden rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent md:inline">
                        Guided
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </SheetSection>
          ) : null}

          {riteList.length > 0 ? (
            <SheetSection label="Hajj & Umrah" quietLabel>
              <ul className="grid grid-cols-2 gap-1 md:grid-cols-1">
                {riteList.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => pick(d.id)}
                      aria-pressed={s.state.dhikrId === d.id}
                      className="flex h-full min-h-[46px] w-full flex-col items-start justify-center gap-1 rounded-[var(--radius-sm)] border border-border bg-surface px-2.5 py-1.5 text-left transition-colors hover:border-border-strong md:flex-row md:items-center md:border-transparent md:bg-transparent md:px-3 md:py-3 md:hover:bg-surface-sunken"
                    >
                      <span className="min-w-0">
                        <span className="block text-[11.5px] font-medium leading-tight md:text-[15px]">
                          {d.name}
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] leading-tight text-fg-muted md:text-[13px]">
                          {RITE_LAPS}{" "}
                          {isRiteId(d.id)
                            ? RITES[d.id].unitPlural.toLowerCase()
                            : ""}
                        </span>
                      </span>
                      <span className="hidden rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent md:inline">
                        Tracker
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </SheetSection>
          ) : null}

          {/* Phone: one flat grid, so no category leaves a half-empty row. */}
          <div className="py-1.5 md:hidden">
            <h3 className="sr-only">All dhikr</h3>
            <ul className="grid grid-cols-2 gap-1">
              {dhikrList.map((d) => (
                <li key={d.id}>
                  <PickTile
                    name={d.name}
                    arabic={d.arabic}
                    active={d.id === s.state.dhikrId}
                    onClick={() => pick(d.id)}
                  />
                </li>
              ))}
            </ul>
          </div>

          <div className="hidden md:block">
            {grouped.map(([cat, items]) => (
              <SheetSection key={cat} label={CATEGORY_LABEL[cat] ?? "Dhikr"} quietLabel>
                <ul className="grid grid-cols-1 gap-1">
                  {items.map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        onClick={() => pick(d.id)}
                        className={`flex w-full items-start justify-between gap-3 rounded-[var(--radius-sm)] border border-transparent px-3 py-3 text-left transition-colors ${
                          d.id === s.state.dhikrId
                            ? "border-accent bg-accent-soft"
                            : "hover:bg-surface-sunken"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block text-[15px] font-medium">{d.name}</span>
                          <span className="mt-0.5 block text-[13px] text-fg-muted">
                            {d.meaning}
                          </span>
                        </span>
                        <span
                          className="arabic-sm shrink-0 text-fg-muted"
          lang="ar"
          dir="rtl"
                          style={{ fontSize: 16, lineHeight: 1.6 }}
                        >
                          {d.arabic}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </SheetSection>
            ))}
          </div>
        </>
      ) : null}

      {/* ================= THE 99 NAMES ================= */}
      {view === "asma" ? (
        <SheetSection label="Asma ul-Husna" quietLabel>
          <p className="mb-2 px-0.5 text-[11.5px] leading-relaxed text-fg-subtle">
            Choose any Name and count it with a target of your own. No repetition
            count is prescribed here for any Name.
          </p>
          <ul className="grid grid-cols-2 gap-1 md:grid-cols-3">
            {asmaList.map((a) => {
              const id = `${ASMA_ID_PREFIX}${a.index}`;
              return (
                <li key={a.index}>
                  <button
                    type="button"
                    onClick={() => pick(id)}
                    className={`flex h-full w-full flex-col items-start gap-0 rounded-[var(--radius-sm)] border px-2.5 py-1.5 text-left transition-colors ${
                      id === s.state.dhikrId
                        ? "border-accent bg-accent-soft"
                        : "border-border bg-surface hover:border-border-strong"
                    }`}
                  >
                    <span className="flex w-full items-baseline gap-1">
                      <span className="tabular text-[9.5px] text-fg-subtle">{a.index}</span>
                      <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium leading-tight">
                        {a.transliteration}
                      </span>
                    </span>
                    <span
                      className="arabic-sm block w-full truncate text-fg-muted"
          lang="ar"
          dir="rtl"
                      style={{ fontSize: 14, lineHeight: 1.35 }}
                    >
                      {a.arabic}
                    </span>
                    <span className="hidden w-full truncate text-[11px] text-fg-subtle md:block">
                      {a.meaning}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 px-0.5 text-[11px] text-fg-subtle">
            {asmaList.length} of {ASMA_TOTAL} Names
          </p>
        </SheetSection>
      ) : null}

      {/* ================= YOUR OWN ================= */}
      {/* Gap 6: sources were stored on every entry and rendered nowhere, so
          section 62 was unmet and a reader had nothing to check. */}
      {view === "dhikr" && selectedDhikr ? (
        <SourceNote dhikr={selectedDhikr} compact />
      ) : null}

      {view === "mine" ? (
        <SheetSection label="My dhikr" quietLabel>
          {mineList.length > 0 ? (
            <ul className="mb-3 space-y-1">
              {mineList.map((d) =>
                editing === d.id ? (
                  /* Gap 12: a typo in your own Arabic used to be permanent.
                     The same form that creates one now edits it. */
                  <li key={d.id}>
                    <CustomForm
                      existing={d}
                      onCancel={() => setEditing(null)}
                      onCreate={(next) => {
                        void s.updateCustomDhikr(d.id, next);
                        setEditing(null);
                      }}
                      seed=""
                    />
                  </li>
                ) : (
                  <li key={d.id} className="flex items-stretch gap-1">
                    <div className="min-w-0 flex-1">
                      <PickTile
                        name={d.name}
                        arabic={d.arabic}
                        active={d.id === s.state.dhikrId}
                        onClick={() => pick(d.id)}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditing(d.id)}
                      aria-label={`Edit ${d.name}`}
                      className="grid w-11 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-border text-fg-subtle transition-colors hover:border-border-strong hover:text-fg"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M4 20h4L19 9a2.8 2.8 0 10-4-4L4 16v4z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleting(d.id)}
                      aria-label={`Delete ${d.name}`}
                      className="grid w-11 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-border text-fg-subtle transition-colors hover:border-danger hover:text-danger"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </li>
                ),
              )}
            </ul>
          ) : null}

          {deleting ? (
            <div className="mb-3 rounded-[var(--radius-sm)] border border-danger bg-danger-soft p-3">
              <p className="text-[13px] leading-relaxed text-fg">
                Delete &ldquo;{mineList.find((d) => d.id === deleting)?.name}&rdquo;?
                Everything you have already counted with it is kept — your totals
                and streak do not change. Only the entry goes.
              </p>
              <div className="mt-2.5 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void s.removeCustomDhikr(deleting);
                    setDeleting(null);
                  }}
                  className="min-h-[44px] rounded-full bg-danger px-4 text-[13px] font-medium text-fg-on-accent"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setDeleting(null)}
                  className="min-h-[44px] rounded-full border border-border px-4 text-[13px] text-fg-muted"
                >
                  Keep it
                </button>
              </div>
            </div>
          ) : null}

          {creating ? (
            <CustomForm
              onCancel={() => setCreating(false)}
              onCreate={(d) => {
                s.addCustomDhikr(d);
                setCreating(false);
                pick(d.id);
              }}
              seed={q}
            />
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="w-full rounded-[var(--radius-sm)] border border-dashed border-border-strong px-3 py-2.5 text-[13px] font-medium text-fg-muted transition-colors hover:border-accent hover:text-accent md:py-3 md:text-[14px]"
            >
              Create a custom dhikr
            </button>
          )}

          <p className="mt-2 px-1 text-[11.5px] leading-relaxed text-fg-subtle">
            Your own dhikr stays private on this device. Nothing you write is ever
            published or shared.
          </p>
        </SheetSection>
      ) : null}

      {nothingFound ? (
        <p className="px-3 py-8 text-center text-[14px] text-fg-muted">
          Nothing matches “{q}”.{" "}
          <button
            type="button"
            onClick={() => {
              setView("mine");
              setCreating(true);
            }}
            className="font-medium text-accent underline-offset-2 hover:underline"
          >
            Create it as your own
          </button>
          .
        </p>
      ) : null}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */

function ViewTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`min-h-[44px] flex-1 rounded-full border px-2 text-[11.5px] font-medium transition-colors ${
        active
          ? "border-accent bg-accent text-fg-on-accent"
          : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg"
      }`}
    >
      {label}
      <span className={`tabular ms-1 ${active ? "opacity-80" : "text-fg-subtle"}`}>
        {count}
      </span>
    </button>
  );
}

function PickTile({
  name,
  arabic,
  active,
  onClick,
}: {
  name: string;
  arabic: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-full min-h-[46px] w-full flex-col items-start justify-center gap-0 rounded-[var(--radius-sm)] border px-2.5 py-1.5 text-left transition-colors ${
        active
          ? "border-accent bg-accent-soft"
          : "border-border bg-surface hover:border-border-strong"
      }`}
    >
      <span className="block w-full truncate text-[12px] font-medium leading-tight">
        {name}
      </span>
      {arabic ? (
        <span
          className="arabic-sm block w-full truncate text-fg-muted"
          lang="ar"
          dir="rtl"
          style={{ fontSize: 14, lineHeight: 1.35 }}
        >
          {arabic}
        </span>
      ) : null}
    </button>
  );
}

/** Section 120: sensible length and numeric bounds on every field. */
function CustomForm({
  onCreate,
  onCancel,
  seed,
  existing,
}: {
  onCreate: (d: Dhikr) => void;
  onCancel: () => void;
  seed: string;
  /** When present the form edits this entry instead of creating one. */
  existing?: Dhikr;
}) {
  const [name, setName] = useState(existing?.name ?? seed.slice(0, 60));
  const [arabic, setArabic] = useState(existing?.arabic ?? "");
  const [meaning, setMeaning] = useState(existing?.meaning ?? "");
  const [target, setTarget] = useState(String(existing?.defaultTarget ?? 33));

  const valid = name.trim().length > 0;

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onCreate({
          // Editing keeps the id, so every session already counted against this
          // dhikr still points at it.
          id: existing?.id ?? `custom-${Date.now().toString(36)}`,
          name: name.trim().slice(0, 60),
          arabic: arabic.trim().slice(0, 300),
          transliteration: name.trim().slice(0, 60),
          meaning: meaning.trim().slice(0, 200),
          category: "mine",
          aliases: [],
          targets: [],
          defaultTarget: normaliseTarget(target) ?? 33,
          sources: [],
          reviewStatus: "approved",
          custom: true,
          createdAt: Date.now(),
        });
      }}
    >
      <Field label="Name" value={name} onChange={setName} maxLength={60} required />
      <Field
        label="Arabic (optional)"
        value={arabic}
        onChange={setArabic}
        maxLength={300}
        rtl
      />
      <Field
        label="Meaning (optional)"
        value={meaning}
        onChange={setMeaning}
        maxLength={200}
      />
      <Field
        label="Default target"
        value={target}
        onChange={setTarget}
        maxLength={7}
        numeric
      />
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={!valid}
          className="flex-1 rounded-full bg-accent px-4 py-3 text-[14px] font-medium text-fg-on-accent disabled:opacity-40"
        >
          {existing ? "Save changes" : "Create"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-border px-4 py-3 text-[14px] text-fg-muted"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  maxLength,
  rtl,
  numeric,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength: number;
  rtl?: boolean;
  numeric?: boolean;
  required?: boolean;
}) {
  const id = `f-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[12px] font-medium text-fg-muted">
        {label}
      </label>
      <input
        id={id}
        value={value}
        required={required}
        inputMode={numeric ? "numeric" : "text"}
        dir={rtl ? "rtl" : undefined}
        lang={rtl ? "ar" : undefined}
        maxLength={maxLength}
        onChange={(e) =>
          onChange(numeric ? e.target.value.replace(/[^\d]/g, "") : e.target.value)
        }
        className={`w-full rounded-[var(--radius-sm)] border border-border bg-surface-sunken px-3 py-2.5 text-[15px] outline-none focus-visible:border-accent ${
          rtl ? "arabic-sm text-right" : ""
        }`}
        style={rtl ? { fontSize: 20 } : undefined}
      />
    </div>
  );
}
