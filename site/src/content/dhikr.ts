/**
 * Dhikr preset library.
 * Specification sections 34, 35, 37, 38, 39, 61, 62, 63, 82.
 *
 * ############################################################################
 * ##  CONTENT REVIEW GATE — READ BEFORE LAUNCH                              ##
 * ##                                                                        ##
 * ##  Every entry below is marked reviewStatus: "needs-review".              ##
 * ##  Specification section 61 says production shows "approved" only.        ##
 * ##                                                                        ##
 * ##  The Arabic, the transliteration, the meaning, the target numbers and   ##
 * ##  the source citations must each be checked by a qualified human before  ##
 * ##  this site goes live, and the status flipped to "approved" here.        ##
 * ##  Section 152 records this as the real critical path of the project.     ##
 * ##                                                                        ##
 * ##  Until then set CONTENT_REVIEW_ENFORCED = false so the app is usable    ##
 * ##  in development. Flip it to true for production and the gate holds.     ##
 * ############################################################################
 */

import type { Dhikr, TargetOption } from "@/core/types";
import { asmaFromId, isAsmaId } from "./asma";
import { RITE_DHIKR, riteDhikr } from "./rites";

export const CONTENT_REVIEW_ENFORCED = false;
export const CONTENT_VERSION = "0.1.0";

const goal = (...values: number[]): TargetOption[] =>
  values.map((value) => ({ value, kind: "user-goal" as const }));

const sourced = (value: number, note: string): TargetOption => ({
  value,
  kind: "source-backed",
  note,
});

export const DHIKR: Dhikr[] = [
  /* ---------- the core tasbih ---------- */
  {
    id: "subhanallah",
    name: "SubhanAllah",
    arabic: "سُبْحَانَ ٱللَّٰهِ",
    transliteration: "SubhanAllah",
    meaning: "Glory be to Allah.",
    category: "tasbih",
    aliases: [
      "subhanallah", "subhan allah", "subhaanallah", "subhan-allah",
      "tasbih", "tasbeeh", "tesbih", "tespih", "zikirmatik", "سبحان الله",
    ],
    targets: [
      sourced(33, "Counted 33 times as part of the remembrance after the obligatory prayer."),
      ...goal(100, 313, 1000),
    ],
    defaultTarget: 33,
    sources: [
      { label: "After-salah tasbih narrations", type: "hadith" },
    ],
    reviewStatus: "needs-review",
  },
  {
    id: "alhamdulillah",
    name: "Alhamdulillah",
    arabic: "ٱلْحَمْدُ لِلَّٰهِ",
    transliteration: "Alhamdulillah",
    meaning: "All praise is for Allah.",
    category: "tasbih",
    aliases: ["alhamdulillah", "alhamdu lillah", "hamd", "tahmid", "الحمد لله"],
    targets: [
      sourced(33, "Counted 33 times as part of the remembrance after the obligatory prayer."),
      ...goal(100, 313, 1000),
    ],
    defaultTarget: 33,
    sources: [{ label: "After-salah tasbih narrations", type: "hadith" }],
    reviewStatus: "needs-review",
  },
  {
    id: "allahu-akbar",
    name: "Allahu Akbar",
    arabic: "ٱللَّٰهُ أَكْبَرُ",
    transliteration: "Allahu Akbar",
    meaning: "Allah is the greatest.",
    category: "tasbih",
    aliases: ["allahu akbar", "allahuakbar", "takbir", "takbeer", "الله أكبر"],
    targets: [
      sourced(34, "Counted 34 times to complete the hundred after the obligatory prayer."),
      sourced(33, "Counted 33 times in the variant that closes with the tahlil."),
      ...goal(100, 1000),
    ],
    defaultTarget: 34,
    sources: [{ label: "After-salah tasbih narrations", type: "hadith" }],
    reviewStatus: "needs-review",
  },
  {
    id: "la-ilaha-illallah",
    name: "La ilaha illallah",
    arabic: "لَا إِلَٰهَ إِلَّا ٱللَّٰهُ",
    transliteration: "La ilaha illallah",
    meaning: "There is no god but Allah.",
    category: "tahlil",
    aliases: [
      "la ilaha illallah", "laa ilaaha illallah", "tahlil", "tahleel",
      "kalima", "kalma", "first kalima", "لا إله إلا الله",
    ],
    targets: goal(100, 313, 1000),
    defaultTarget: 100,
    sources: [],
    reviewStatus: "needs-review",
  },
  {
    id: "astaghfirullah",
    name: "Astaghfirullah",
    arabic: "أَسْتَغْفِرُ ٱللَّٰهَ",
    transliteration: "Astaghfirullah",
    meaning: "I seek forgiveness from Allah.",
    category: "istighfar",
    aliases: [
      "astaghfirullah", "astagfirullah", "istighfar", "istigfar", "istegfar",
      "estaghfirullah", "أستغفر الله",
    ],
    targets: [
      sourced(100, "Narrated as a daily practice of seeking forgiveness one hundred times."),
      ...goal(33, 313, 1000),
    ],
    defaultTarget: 100,
    sources: [{ label: "Narrations on daily istighfar", type: "hadith" }],
    reviewStatus: "needs-review",
  },

  /* ---------- durood and salawat (section 37) ---------- */
  {
    id: "salawat",
    name: "Salawat",
    arabic: "ٱللَّٰهُمَّ صَلِّ عَلَىٰ مُحَمَّدٍ",
    transliteration: "Allahumma salli 'ala Muhammad",
    meaning: "O Allah, send blessings upon Muhammad.",
    category: "durood",
    aliases: [
      "salawat", "salawaat", "durood", "darood", "darud", "durood sharif",
      "darood sharif", "salat alan nabi", "salawat nabi", "drood",
      "اللهم صل على محمد",
    ],
    targets: goal(11, 100, 313, 1000),
    defaultTarget: 100,
    sources: [],
    reviewStatus: "needs-review",
  },

  /* ---------- extended core (section 35) ---------- */
  {
    id: "subhanallahi-wa-bihamdihi",
    name: "SubhanAllahi wa bihamdihi",
    arabic: "سُبْحَانَ ٱللَّٰهِ وَبِحَمْدِهِ",
    transliteration: "SubhanAllahi wa bihamdihi",
    meaning: "Glory be to Allah, and praise be to Him.",
    category: "tasbih",
    aliases: ["subhanallahi wa bihamdihi", "subhan allah wa bihamdihi"],
    targets: [
      sourced(100, "Narrated as a remembrance said one hundred times in a day."),
      ...goal(33, 1000),
    ],
    defaultTarget: 100,
    sources: [{ label: "Narrations on saying it one hundred times daily", type: "hadith" }],
    reviewStatus: "needs-review",
  },
  {
    id: "subhanallahil-azeem",
    name: "SubhanAllahil-Azeem",
    arabic: "سُبْحَانَ ٱللَّٰهِ ٱلْعَظِيمِ",
    transliteration: "SubhanAllahil-'Azeem",
    meaning: "Glory be to Allah, the Most Great.",
    category: "tasbih",
    aliases: ["subhanallahil azeem", "subhan allahil azim"],
    targets: goal(33, 100, 1000),
    defaultTarget: 100,
    sources: [],
    reviewStatus: "needs-review",
  },
  {
    id: "la-hawla",
    name: "La hawla wa la quwwata illa billah",
    arabic: "لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِٱللَّٰهِ",
    transliteration: "La hawla wa la quwwata illa billah",
    meaning: "There is no power and no strength except by Allah.",
    category: "tasbih",
    aliases: ["la hawla", "la hawla wala quwwata", "hawqala", "لا حول ولا قوة إلا بالله"],
    targets: goal(33, 100, 313),
    defaultTarget: 33,
    sources: [],
    reviewStatus: "needs-review",
  },
  {
    id: "astaghfirullah-wa-atubu",
    name: "Astaghfirullaha wa atubu ilayh",
    arabic: "أَسْتَغْفِرُ ٱللَّٰهَ وَأَتُوبُ إِلَيْهِ",
    transliteration: "Astaghfirullaha wa atubu ilayh",
    meaning: "I seek forgiveness from Allah and turn to Him in repentance.",
    category: "istighfar",
    aliases: ["astaghfirullah wa atubu ilayh", "astagfirullah wa atubu"],
    targets: goal(100, 313, 1000),
    defaultTarget: 100,
    sources: [],
    reviewStatus: "needs-review",
  },
  {
    id: "hasbunallah",
    name: "Hasbunallahu wa ni'mal wakeel",
    arabic: "حَسْبُنَا ٱللَّٰهُ وَنِعْمَ ٱلْوَكِيلُ",
    transliteration: "Hasbunallahu wa ni'mal wakeel",
    meaning: "Allah is sufficient for us, and He is the best disposer of affairs.",
    category: "tasbih",
    aliases: ["hasbunallah", "hasbunallahu wa nimal wakeel", "حسبنا الله ونعم الوكيل"],
    targets: goal(100, 313, 450, 1000),
    defaultTarget: 100,
    sources: [],
    reviewStatus: "needs-review",
  },
  {
    id: "dua-yunus",
    name: "Dua Yunus",
    arabic: "لَا إِلَٰهَ إِلَّا أَنْتَ سُبْحَانَكَ إِنِّي كُنْتُ مِنَ ٱلظَّالِمِينَ",
    transliteration: "La ilaha illa anta subhanaka inni kuntu minaz-zalimeen",
    meaning:
      "There is no god but You, glory be to You. Indeed, I was among the wrongdoers.",
    category: "recitation",
    aliases: ["dua yunus", "ayat e karima", "ayat karima", "dua of yunus"],
    targets: goal(100, 313, 1000, 125000),
    defaultTarget: 100,
    sources: [{ label: "Qur'an, Surah al-Anbiya 21:87", type: "quran" }],
    reviewStatus: "needs-review",
  },
  {
    id: "afuwwun",
    name: "Allahumma innaka 'afuwwun",
    arabic: "ٱللَّٰهُمَّ إِنَّكَ عَفُوٌّ تُحِبُّ ٱلْعَفْوَ فَٱعْفُ عَنِّي",
    transliteration: "Allahumma innaka 'afuwwun tuhibbul-'afwa fa'fu 'anni",
    meaning:
      "O Allah, You are Most Forgiving and You love forgiveness, so forgive me.",
    category: "morning-evening",
    aliases: ["allahumma innaka afuwwun", "afuwwun karimun", "laylatul qadr dua"],
    targets: goal(33, 100, 313),
    defaultTarget: 100,
    sources: [],
    reviewStatus: "needs-review",
  },

  /* ---------- Hajj and Umrah (sections 50, 53) ---------- */
  {
    id: "talbiyah",
    name: "Talbiyah",
    arabic:
      "لَبَّيْكَ ٱللَّٰهُمَّ لَبَّيْكَ، لَبَّيْكَ لَا شَرِيكَ لَكَ لَبَّيْكَ، إِنَّ ٱلْحَمْدَ وَٱلنِّعْمَةَ لَكَ وَٱلْمُلْكَ، لَا شَرِيكَ لَكَ",
    transliteration:
      "Labbayka Allahumma labbayk, labbayka la sharika laka labbayk, innal-hamda wan-ni'mata laka wal-mulk, la sharika lak",
    meaning:
      "Here I am, O Allah, here I am. Here I am, You have no partner, here I am. Indeed all praise and blessing are Yours, and the dominion. You have no partner.",
    category: "hajj",
    aliases: ["talbiyah", "talbiya", "labbaik", "labbayk", "labaik allahumma labaik", "تلبية"],
    // Section 53 asks for a simple manual counter on the preset phrase. No
    // number is attached to it by any source we are relying on, so every target
    // offered here is the user's own goal and is labelled as one.
    targets: goal(33, 100, 313, 1000),
    sources: [],
    reviewStatus: "needs-review",
  },
];

export const DHIKR_BY_ID = new Map(DHIKR.map((d) => [d.id, d]));

/**
 * The library as the admin panel last left it (docs/ADMIN.md §3.9).
 *
 * The page inlines the published rows of public.names as `window.__njcNames`
 * before this module loads (lib/counter/library.ts). Where it is there, it
 * decides which dhikr the library lists, in what order, and their text; the
 * targets, sources and aliases stay the ones written here. A row the panel
 * added that this file does not know becomes a plain dhikr. A built-in dhikr the
 * panel unpublished leaves the list but still resolves by id, so its history and
 * any link to it keep working.
 *
 * With no injected list — offline, an old cached page, a test — nothing changes.
 */
type LibraryRow = { id: string; n: string; t: string; m: string; g?: "mantra" };

export function applyLibrary(rows: unknown = (globalThis as { __njcNames?: unknown }).__njcNames): void {
  if (!Array.isArray(rows) || typeof rows[0]?.id !== "string") return;
  const ordered: Dhikr[] = [];
  for (const row of rows as LibraryRow[]) {
    if (!row || typeof row.id !== "string" || typeof row.t !== "string") continue;
    const known = DHIKR_BY_ID.get(row.id);
    const entry: Dhikr = known
      ? { ...known, arabic: row.n || known.arabic, transliteration: row.t, meaning: row.m || known.meaning }
      : {
          id: row.id,
          name: row.t,
          arabic: row.n,
          transliteration: row.t,
          meaning: row.m,
          category: row.g === "mantra" ? "recitation" : "tasbih",
          aliases: [row.t.toLowerCase()],
          targets: goal(33, 100, 1000),
          defaultTarget: 33,
          sources: [],
          reviewStatus: "needs-review",
        };
    DHIKR_BY_ID.set(entry.id, entry);
    ordered.push(entry);
  }
  if (!ordered.length) return;
  DHIKR.splice(0, DHIKR.length, ...ordered);
}

applyLibrary();

export function getDhikr(id: string): Dhikr | undefined {
  // Section 47: a single Name is selectable and countable like any dhikr.
  if (isAsmaId(id)) return asmaFromId(id);
  // Sections 51 and 52: a rite is countable the same way, but is not a phrase
  // and so is not a member of DHIKR. Resolved by id, like a Name.
  const rite = riteDhikr(id);
  if (rite) return rite;
  return DHIKR_BY_ID.get(id);
}

/** Section 61: production surfaces approved entries only. */
export function visibleDhikr(): Dhikr[] {
  if (!CONTENT_REVIEW_ENFORCED) return DHIKR;
  return DHIKR.filter((d) => d.reviewStatus === "approved");
}

export const DEFAULT_DHIKR_ID = "subhanallah";

/**
 * Fold a name to its comparable form: no case, no spaces, no punctuation, and
 * no Arabic diacritics — so "Subhan-Allah", "subhan allah" and the vocalised
 * "سُبْحَانَ ٱللَّٰهِ" all reduce to the same key as the bare "سبحان الله".
 *
 * This used to be `replace(/[^a-z0-9]/g, "")`, which deleted every character
 * outside the Latin alphabet. Every Arabic alias therefore folded to the EMPTY
 * STRING, matched the empty string of the first entry that had one, and every
 * Arabic deep link in the product — `?d=الحمد لله`, the PWA shortcuts, the
 * `/#…` fragments — landed on SubhanAllah regardless of what was asked for.
 */
function fold(value: string): string {
  return (
    value
      .toLowerCase()
      // Decompose, then drop the combining marks: this is what removes the
      // harakat without touching the letters underneath.
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      // Alef variants are the same letter for matching purposes, and which one
      // a link carries is not something a reader chose.
      .replace(/[آأإٱ]/g, "ا")
      // Keep letters and digits in ANY script; drop everything else.
      .replace(/[^\p{L}\p{N}]/gu, "")
  );
}

/**
 * Resolve a link fragment to a dhikr id. Backs the PWA shortcuts of section 91
 * and the deep links of section 97, so `?d=durood` and `/#durood` both land on
 * Salawat rather than doing nothing at all.
 */
export function resolveDhikrId(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  if (DHIKR_BY_ID.has(key)) return key;
  if (isAsmaId(key)) return key;

  const loose = fold(key);
  // A fragment that folds away entirely — punctuation, an emoji — matches
  // nothing. Without this guard it matches the first entry that also folds to
  // empty, which is how the bug above stayed invisible.
  if (!loose) return null;

  // Rites are searched alongside the phrases so `?d=tawaf` and `?d=سعي` work
  // like any other deep link, even though they are not members of DHIKR.
  for (const d of [...DHIKR, ...RITE_DHIKR]) {
    if (fold(d.id) === loose) return d.id;
    if (d.aliases.some((a) => fold(a) === loose)) return d.id;
  }
  return null;
}

/** Section 31 layer 1: the quick chips shown above the counter. */
export const QUICK_IDS = [
  "subhanallah",
  "astaghfirullah",
  "salawat",
  "alhamdulillah",
  "la-ilaha-illallah",
];
