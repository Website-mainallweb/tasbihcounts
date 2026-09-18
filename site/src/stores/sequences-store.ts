"use client";

/**
 * Custom guided sequences — the store.
 * Specification section 4 (premium feature 2), 40 (one engine), 60 (private).
 *
 * The sequences live in IndexedDB on the device and, for a signed-in user,
 * sync to `custom_sequences`. They are registered with the routine engine on
 * load, so running one uses exactly the same code path as the built-in
 * routines rather than a parallel implementation (section 1).
 */

import { create } from "zustand";
import {
  allSequences,
  putSequence,
  deleteSequence as removeSequence,
} from "@/lib/storage";
import { registerCustomRoutines } from "@/content/routines";
import { newId } from "@/core/session";
import {
  emptySequence,
  toRoutine,
  duplicate as duplicateSequence,
  type Sequence,
} from "@/core/sequences";

interface SequencesStore {
  hydrated: boolean;
  items: Sequence[];
  hydrate: () => Promise<void>;
  create: () => Sequence;
  save: (seq: Sequence) => Promise<void>;
  remove: (id: string) => Promise<void>;
  duplicate: (id: string) => Promise<void>;
  setArchived: (id: string, archived: boolean) => Promise<void>;
}

/** Only live sequences reach the engine; an archived one is kept, not run. */
function register(items: Sequence[]): void {
  registerCustomRoutines(
    items.filter((s) => !s.archivedAt && s.steps.length > 0).map(toRoutine),
  );
}

export const useSequences = create<SequencesStore>((set, get) => ({
  hydrated: false,
  items: [],

  async hydrate() {
    const items = (await allSequences()).sort((a, b) => b.updatedAt - a.updatedAt);
    register(items);
    set({ items, hydrated: true });
  },

  create() {
    return emptySequence(newId());
  },

  async save(seq) {
    const next: Sequence = { ...seq, updatedAt: Date.now() };
    await putSequence(next);
    const items = [next, ...get().items.filter((s) => s.id !== next.id)].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
    register(items);
    set({ items });
  },

  async remove(id) {
    await removeSequence(id);
    const items = get().items.filter((s) => s.id !== id);
    register(items);
    set({ items });
  },

  async duplicate(id) {
    const source = get().items.find((s) => s.id === id);
    if (!source) return;
    await get().save(duplicateSequence(source, newId()));
  },

  async setArchived(id, archived) {
    const source = get().items.find((s) => s.id === id);
    if (!source) return;
    await get().save({ ...source, archivedAt: archived ? Date.now() : null });
  },
}));
