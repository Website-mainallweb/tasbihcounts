"use client";

/**
 * Layer one of the selector: quick chips.
 * Specification section 31. Thirty presets cannot be a dropdown, and the
 * chip row is the pattern the best tool in the market uses.
 */

import { useEffect, useState } from "react";
import { DHIKR, QUICK_IDS, getDhikr } from "@/content/dhikr";
import { ROUTINES } from "@/content/routines";
import { readLocal } from "@/lib/storage";

export function QuickChips({
  activeId,
  routineId,
  onSelect,
  onStartRoutine,
  onOpenAll,
}: {
  activeId: string;
  routineId: string | null;
  onSelect: (id: string) => void;
  onStartRoutine: (id: string) => void;
  onOpenAll: () => void;
}) {
  const [ids, setIds] = useState<string[]>(QUICK_IDS);

  useEffect(() => {
    const recent = readLocal<string[]>("recentDhikr", []);
    const merged = [...recent, ...QUICK_IDS].filter(
      (id, i, arr) => arr.indexOf(id) === i && getDhikr(id),
    );
    setIds(merged.slice(0, 5));
  }, [activeId]);

  const afterSalah = ROUTINES[0];

  return (
    <div
      className="overflow-guard -mx-4 mt-4 flex gap-2 px-4 pb-1"
      role="group"
      aria-label="Quick dhikr selection"
    >
      {ids.map((id) => {
        const d = DHIKR.find((x) => x.id === id);
        if (!d) return null;
        const active = !routineId && id === activeId;
        return (
          <Chip key={id} active={active} onClick={() => onSelect(id)}>
            {d.name}
          </Chip>
        );
      })}

      {/* A chip that shows a pressed state has to be the thing it selects.
          This one opened the picker instead, which is not what a chip means. */}
      {afterSalah ? (
        <Chip
          active={routineId === afterSalah.id}
          onClick={() => onStartRoutine(afterSalah.id)}
        >
          33-33-34
        </Chip>
      ) : null}

      <Chip onClick={onOpenAll} outline>
        All
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className="ms-1 inline-block"
        >
          <path
            d="M6 9l6 6 6-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Chip>
    </div>
  );
}

function Chip({
  children,
  active,
  outline,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  outline?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active ? true : undefined}
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 py-2 text-[13px] font-medium transition-all duration-200 active:scale-[0.97] ${
        active
          ? "border-accent bg-accent text-fg-on-accent"
          : outline
            ? "border-dashed border-border-strong bg-transparent text-fg-muted hover:text-fg"
            : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg"
      }`}
      style={{ transitionTimingFunction: "var(--ease-brand)", minHeight: 44 }}
    >
      {children}
    </button>
  );
}
