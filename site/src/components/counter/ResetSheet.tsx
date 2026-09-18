"use client";

/**
 * Reset confirmation.
 * Specification section 18: progress is never destroyed without a confirmation,
 * and a guided routine offers a different choice from a plain counter.
 */

import { Sheet } from "@/components/ui/Sheet";
import { useCounter } from "@/stores/counter-store";
import { getRoutine } from "@/content/routines";

export function ResetSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useCounter();
  const routine = s.state.routine ? getRoutine(s.state.routine.routineId) : null;

  return (
    <Sheet open={open} onClose={onClose} title={routine ? "Reset routine" : "Reset count"}>
      {routine ? (
        <div className="space-y-2 py-2">
          <p className="px-1 pb-2 text-[14px] leading-relaxed text-fg-muted">
            What would you like to reset in {routine.title}?
          </p>
          <Choice
            label="Reset current step"
            hint="Keep the steps you have already completed"
            onClick={() => {
              s.resetStep();
              onClose();
            }}
          />
          <Choice
            label="Restart the whole routine"
            hint="Begin again from step one"
            onClick={() => {
              s.restart();
              onClose();
            }}
          />
          <Choice label="Cancel" quiet onClick={onClose} />
        </div>
      ) : (
        <div className="space-y-2 py-2">
          <p className="px-1 pb-2 text-[14px] leading-relaxed text-fg-muted">
            This clears the count on screen. Your completed sessions, today
            total and streak are not affected.
          </p>
          <Choice
            label="Reset to zero"
            danger
            onClick={() => {
              s.resetCurrent();
              onClose();
            }}
          />
          <Choice label="Cancel" quiet onClick={onClose} />
        </div>
      )}
    </Sheet>
  );
}

function Choice({
  label,
  hint,
  onClick,
  danger,
  quiet,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
  danger?: boolean;
  quiet?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-[var(--radius-sm)] border px-4 py-3.5 text-left transition-colors ${
        danger
          ? "border-danger bg-danger-soft text-danger"
          : quiet
            ? "border-transparent text-fg-muted hover:bg-surface-sunken"
            : "border-border bg-surface hover:border-border-strong"
      }`}
    >
      <span className="block text-[15px] font-medium">{label}</span>
      {hint ? <span className="mt-0.5 block text-[13px] text-fg-muted">{hint}</span> : null}
    </button>
  );
}
