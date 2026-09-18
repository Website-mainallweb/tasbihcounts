/**
 * Guided routines. One engine, many configurations.
 * Specification sections 40, 41, 42, 43, 56.
 *
 * Same review gate as content/dhikr.ts: every routine here is
 * reviewStatus "needs-review" until a qualified human signs it off.
 *
 * Section 42: where two reviewed variants exist, both are offered and neither
 * is labelled the only correct method.
 */

import type { Routine } from "@/core/types";
import { CONTENT_REVIEW_ENFORCED } from "./dhikr";

export const ROUTINES: Routine[] = [
  {
    id: "after-salah-33-33-34",
    title: "After Salah · 33-33-34",
    description:
      "The remembrance after the obligatory prayer, counted as thirty-three, thirty-three and thirty-four to complete one hundred.",
    category: "after-salah",
    aliases: [
      "33 33 34", "333334", "after salah", "after namaz", "after prayer",
      "tasbih after salah", "dhikr after salah", "post prayer dhikr",
    ],
    steps: [
      { id: "s1", dhikrId: "subhanallah", target: 33 },
      { id: "s2", dhikrId: "alhamdulillah", target: 33 },
      { id: "s3", dhikrId: "allahu-akbar", target: 34 },
    ],
    sources: [{ label: "After-salah tasbih narrations", type: "hadith" }],
    reviewStatus: "needs-review",
  },
  {
    id: "after-salah-33-33-33-tahlil",
    title: "After Salah · 33-33-33 + Tahlil",
    description:
      "The variant counted as thirty-three, thirty-three and thirty-three, completed with the tahlil to reach one hundred.",
    category: "after-salah",
    aliases: ["33 33 33", "tahlil ending", "after salah variant"],
    steps: [
      { id: "s1", dhikrId: "subhanallah", target: 33 },
      { id: "s2", dhikrId: "alhamdulillah", target: 33 },
      { id: "s3", dhikrId: "allahu-akbar", target: 33 },
      { id: "s4", dhikrId: "la-ilaha-illallah", target: 1 },
    ],
    sources: [{ label: "After-salah tasbih narrations", type: "hadith" }],
    reviewStatus: "needs-review",
    disputedNote:
      "Both this and the 33-33-34 form are transmitted. Follow the way you have been taught; neither is presented here as the only correct method.",
  },
  {
    id: "tasbih-fatimah",
    title: "Tasbih Fatimah",
    description:
      "The remembrance taught to Fatimah (may Allah be pleased with her), commonly recited before sleep.",
    category: "routines",
    aliases: [
      "tasbih fatima", "tasbeeh fatima", "tasbih fatimah", "tasbih e fatima",
      "fatima tasbih", "tasbih zahra",
    ],
    steps: [
      { id: "s1", dhikrId: "subhanallah", target: 33 },
      { id: "s2", dhikrId: "alhamdulillah", target: 33 },
      { id: "s3", dhikrId: "allahu-akbar", target: 34 },
    ],
    sources: [{ label: "Narration of the tasbih taught to Fatimah", type: "hadith" }],
    reviewStatus: "needs-review",
  },
  {
    id: "istighfar-100",
    title: "Daily Istighfar · 100",
    description:
      "One hundred repetitions of seeking forgiveness, kept as a single unbroken sitting.",
    category: "istighfar",
    aliases: ["istighfar 100", "daily istighfar", "astaghfirullah 100"],
    steps: [{ id: "s1", dhikrId: "astaghfirullah", target: 100 }],
    sources: [{ label: "Narrations on daily istighfar", type: "hadith" }],
    reviewStatus: "needs-review",
  },
  {
    id: "salawat-100",
    title: "Salawat · 100",
    description:
      "One hundred salawat upon the Prophet, often kept as a Friday practice.",
    category: "durood",
    aliases: ["durood 100", "salawat 100", "darood sharif 100", "friday durood"],
    steps: [{ id: "s1", dhikrId: "salawat", target: 100 }],
    sources: [],
    reviewStatus: "needs-review",
  },
];

export const ROUTINE_BY_ID = new Map(ROUTINES.map((r) => [r.id, r]));

/**
 * The user's own sequences (section 4, premium feature 2), registered at
 * runtime so the ONE routine engine runs them exactly as it runs the built-in
 * routines. Nothing here is ever published: a custom sequence is private
 * (section 60), so it lives beside the reviewed content but never inside it.
 */
const CUSTOM_ROUTINES = new Map<string, Routine>();

export function registerCustomRoutines(list: Routine[]): void {
  CUSTOM_ROUTINES.clear();
  for (const r of list) CUSTOM_ROUTINES.set(r.id, r);
}

export function getRoutine(id: string): Routine | undefined {
  return ROUTINE_BY_ID.get(id) ?? CUSTOM_ROUTINES.get(id);
}

export function visibleRoutines(): Routine[] {
  if (!CONTENT_REVIEW_ENFORCED) return ROUTINES;
  return ROUTINES.filter((r) => r.reviewStatus === "approved");
}

export function routineTargets(r: Routine): number[] {
  return r.steps.map((s) => s.target);
}

export function routineTotal(r: Routine): number {
  return r.steps.reduce((n, s) => n + s.target, 0);
}
