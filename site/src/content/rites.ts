/**
 * Content for the Hajj and Umrah rite trackers.
 * Specification sections 50, 51, 52, and 61 to 63.
 *
 * `core/rites.ts` holds the RULES — seven laps, which way the walker is facing,
 * no eighth round. This file holds the WORDS, under exactly the same review
 * gate as every other religious string in the product.
 *
 * Tawaf and Sa'i are projected as `Dhikr` records so that `getDhikr`,
 * snapshots, sessions, totals and history all work on them without a second
 * code path. They are deliberately NOT members of the `DHIKR` array: they are
 * not phrases to repeat, they should not appear in the ordinary dhikr grid, and
 * a custom sequence should not be able to take "Tawaf" as one of its steps.
 * `getDhikr` resolves them the same way it resolves a single Name — by id,
 * outside the array.
 *
 * WHAT THESE STRINGS ARE, AND ARE NOT
 *
 * A one-line description of what is being counted, and for Sa'i the two place
 * names the Master's own UX names. That is the whole of it. No method, no
 * ruling, no duʿāʾ, no instruction on how to perform anything — the product
 * counts, it does not teach, and section 63 forbids inventing or machine
 * translating religious content. The Arabic field is empty for both because
 * neither rite is a phrase; leaving it empty is honest, and filling it with a
 * transliteration to avoid a blank would be exactly the field confusion the
 * content tests exist to catch.
 */

import type { Dhikr } from "@/core/types";
import { RITES, RITE_LAPS, isRiteId, type RiteId } from "@/core/rites";

const MEANING: Record<RiteId, string> = {
  tawaf: "Circuits of the Kaʿbah, tracked seven at a time.",
  sai: "Lengths between Safa and Marwah, tracked seven at a time.",
};

const ALIASES: Record<RiteId, string[]> = {
  tawaf: ["tawaf", "tawaaf", "towaf", "circumambulation", "طواف"],
  sai: ["sai", "sa'i", "saee", "say", "safa marwah", "safa marwa", "سعي"],
};

/** The rite as the rest of the product sees it: one countable thing with an id. */
function project(id: RiteId): Dhikr {
  const rite = RITES[id];
  return {
    id,
    name: rite.name,
    // Not a phrase. See the note at the top of this file.
    arabic: "",
    transliteration: rite.name,
    meaning: MEANING[id],
    category: "hajj",
    aliases: ALIASES[id],
    // Seven is not a goal the user chose and not a number the product invented,
    // so it is source-backed and says so, and it is the only option offered.
    targets: [
      {
        value: RITE_LAPS,
        kind: "source-backed",
        note: `A complete ${rite.name} is ${RITE_LAPS} ${rite.unitPlural.toLowerCase()}.`,
      },
    ],
    defaultTarget: RITE_LAPS,
    sources: [],
    reviewStatus: "needs-review",
  };
}

export const RITE_DHIKR: Dhikr[] = [project("tawaf"), project("sai")];

const BY_ID = new Map(RITE_DHIKR.map((d) => [d.id, d]));

export function riteDhikr(id: string): Dhikr | undefined {
  return isRiteId(id) ? BY_ID.get(id) : undefined;
}

/**
 * The Hajj and Umrah group, in the order the Master lists it: Tawaf, Sa'i,
 * Talbiyah. Talbiyah is a phrase rather than a rite, so it lives in
 * `content/dhikr.ts` with the other phrases and is referenced here by id.
 */
export const TALBIYAH_ID = "talbiyah";
export const HAJJ_UMRAH_IDS = ["tawaf", "sai", TALBIYAH_ID] as const;
