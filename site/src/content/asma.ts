/**
 * Asma ul-Husna, the 99 Names.
 * Specification section 47.
 *
 * Same review gate as content/dhikr.ts. The Arabic, transliteration and the
 * English renderings below must be verified by a qualified human before
 * production. Renderings of the Names differ between reputable sources; the
 * short glosses here are intended as meaning, not as translation of scripture.
 *
 * Section 47: no Abjad-derived repetition counts are attached to any Name.
 * A user may set any target themselves; the product makes no claim about it.
 */

import type { Dhikr } from "@/core/types";

export interface AsmaName {
  index: number;
  arabic: string;
  transliteration: string;
  meaning: string;
}

type Row = [string, string, string];

const ROWS: Row[] = [
  ["ٱلرَّحْمَٰنُ", "Ar-Rahman", "The Most Compassionate"],
  ["ٱلرَّحِيمُ", "Ar-Raheem", "The Most Merciful"],
  ["ٱلْمَلِكُ", "Al-Malik", "The King"],
  ["ٱلْقُدُّوسُ", "Al-Quddus", "The Most Holy"],
  ["ٱلسَّلَامُ", "As-Salam", "The Source of Peace"],
  ["ٱلْمُؤْمِنُ", "Al-Mu'min", "The Giver of Faith"],
  ["ٱلْمُهَيْمِنُ", "Al-Muhaymin", "The Guardian"],
  ["ٱلْعَزِيزُ", "Al-'Azeez", "The Almighty"],
  ["ٱلْجَبَّارُ", "Al-Jabbar", "The Compeller"],
  ["ٱلْمُتَكَبِّرُ", "Al-Mutakabbir", "The Supreme"],
  ["ٱلْخَالِقُ", "Al-Khaliq", "The Creator"],
  ["ٱلْبَارِئُ", "Al-Bari'", "The Originator"],
  ["ٱلْمُصَوِّرُ", "Al-Musawwir", "The Fashioner"],
  ["ٱلْغَفَّارُ", "Al-Ghaffar", "The Ever-Forgiving"],
  ["ٱلْقَهَّارُ", "Al-Qahhar", "The Subduer"],
  ["ٱلْوَهَّابُ", "Al-Wahhab", "The Bestower"],
  ["ٱلرَّزَّاقُ", "Ar-Razzaq", "The Provider"],
  ["ٱلْفَتَّاحُ", "Al-Fattah", "The Opener"],
  ["ٱلْعَلِيمُ", "Al-'Aleem", "The All-Knowing"],
  ["ٱلْقَابِضُ", "Al-Qabid", "The Withholder"],
  ["ٱلْبَاسِطُ", "Al-Basit", "The Extender"],
  ["ٱلْخَافِضُ", "Al-Khafid", "The Abaser"],
  ["ٱلرَّافِعُ", "Ar-Rafi'", "The Exalter"],
  ["ٱلْمُعِزُّ", "Al-Mu'izz", "The Giver of Honour"],
  ["ٱلْمُذِلُّ", "Al-Mudhill", "The Giver of Dishonour"],
  ["ٱلسَّمِيعُ", "As-Samee'", "The All-Hearing"],
  ["ٱلْبَصِيرُ", "Al-Baseer", "The All-Seeing"],
  ["ٱلْحَكَمُ", "Al-Hakam", "The Judge"],
  ["ٱلْعَدْلُ", "Al-'Adl", "The Utterly Just"],
  ["ٱللَّطِيفُ", "Al-Lateef", "The Subtle One"],
  ["ٱلْخَبِيرُ", "Al-Khabeer", "The All-Aware"],
  ["ٱلْحَلِيمُ", "Al-Haleem", "The Forbearing"],
  ["ٱلْعَظِيمُ", "Al-'Azeem", "The Magnificent"],
  ["ٱلْغَفُورُ", "Al-Ghafoor", "The Much-Forgiving"],
  ["ٱلشَّكُورُ", "Ash-Shakoor", "The Appreciative"],
  ["ٱلْعَلِيُّ", "Al-'Aliyy", "The Most High"],
  ["ٱلْكَبِيرُ", "Al-Kabeer", "The Most Great"],
  ["ٱلْحَفِيظُ", "Al-Hafeez", "The Preserver"],
  ["ٱلْمُقِيتُ", "Al-Muqeet", "The Sustainer"],
  ["ٱلْحَسِيبُ", "Al-Haseeb", "The Reckoner"],
  ["ٱلْجَلِيلُ", "Al-Jaleel", "The Majestic"],
  ["ٱلْكَرِيمُ", "Al-Kareem", "The Most Generous"],
  ["ٱلرَّقِيبُ", "Ar-Raqeeb", "The Watchful"],
  ["ٱلْمُجِيبُ", "Al-Mujeeb", "The Responsive"],
  ["ٱلْوَاسِعُ", "Al-Wasi'", "The All-Encompassing"],
  ["ٱلْحَكِيمُ", "Al-Hakeem", "The All-Wise"],
  ["ٱلْوَدُودُ", "Al-Wadood", "The Most Loving"],
  ["ٱلْمَجِيدُ", "Al-Majeed", "The Most Glorious"],
  ["ٱلْبَاعِثُ", "Al-Ba'ith", "The Resurrector"],
  ["ٱلشَّهِيدُ", "Ash-Shaheed", "The Witness"],
  ["ٱلْحَقُّ", "Al-Haqq", "The Absolute Truth"],
  ["ٱلْوَكِيلُ", "Al-Wakeel", "The Trustee"],
  ["ٱلْقَوِيُّ", "Al-Qawiyy", "The All-Strong"],
  ["ٱلْمَتِينُ", "Al-Mateen", "The Firm"],
  ["ٱلْوَلِيُّ", "Al-Waliyy", "The Protecting Friend"],
  ["ٱلْحَمِيدُ", "Al-Hameed", "The Praiseworthy"],
  ["ٱلْمُحْصِي", "Al-Muhsee", "The All-Enumerating"],
  ["ٱلْمُبْدِئُ", "Al-Mubdi'", "The Originator"],
  ["ٱلْمُعِيدُ", "Al-Mu'eed", "The Restorer"],
  ["ٱلْمُحْيِي", "Al-Muhyee", "The Giver of Life"],
  ["ٱلْمُمِيتُ", "Al-Mumeet", "The Bringer of Death"],
  ["ٱلْحَيُّ", "Al-Hayy", "The Ever-Living"],
  ["ٱلْقَيُّومُ", "Al-Qayyoom", "The Self-Sustaining"],
  ["ٱلْوَاجِدُ", "Al-Wajid", "The Perceiver"],
  ["ٱلْمَاجِدُ", "Al-Majid", "The Illustrious"],
  ["ٱلْوَاحِدُ", "Al-Wahid", "The One"],
  ["ٱلْأَحَدُ", "Al-Ahad", "The Unique"],
  ["ٱلصَّمَدُ", "As-Samad", "The Eternal Refuge"],
  ["ٱلْقَادِرُ", "Al-Qadir", "The All-Powerful"],
  ["ٱلْمُقْتَدِرُ", "Al-Muqtadir", "The Determiner"],
  ["ٱلْمُقَدِّمُ", "Al-Muqaddim", "The Expediter"],
  ["ٱلْمُؤَخِّرُ", "Al-Mu'akhkhir", "The Delayer"],
  ["ٱلْأَوَّلُ", "Al-Awwal", "The First"],
  ["ٱلْآخِرُ", "Al-Akhir", "The Last"],
  ["ٱلظَّاهِرُ", "Az-Zahir", "The Manifest"],
  ["ٱلْبَاطِنُ", "Al-Batin", "The Hidden"],
  ["ٱلْوَالِي", "Al-Walee", "The Governor"],
  ["ٱلْمُتَعَالِي", "Al-Muta'ali", "The Most Exalted"],
  ["ٱلْبَرُّ", "Al-Barr", "The Source of Goodness"],
  ["ٱلتَّوَّابُ", "At-Tawwab", "The Ever-Relenting"],
  ["ٱلْمُنْتَقِمُ", "Al-Muntaqim", "The Avenger"],
  ["ٱلْعَفُوُّ", "Al-'Afuww", "The Pardoner"],
  ["ٱلرَّءُوفُ", "Ar-Ra'oof", "The Most Kind"],
  ["مَالِكُ ٱلْمُلْكِ", "Malik-ul-Mulk", "Owner of all Sovereignty"],
  ["ذُو ٱلْجَلَالِ وَٱلْإِكْرَامِ", "Dhul-Jalali wal-Ikram", "Lord of Majesty and Generosity"],
  ["ٱلْمُقْسِطُ", "Al-Muqsit", "The Equitable"],
  ["ٱلْجَامِعُ", "Al-Jami'", "The Gatherer"],
  ["ٱلْغَنِيُّ", "Al-Ghaniyy", "The Self-Sufficient"],
  ["ٱلْمُغْنِي", "Al-Mughnee", "The Enricher"],
  ["ٱلْمَانِعُ", "Al-Mani'", "The Withholder"],
  ["ٱلضَّارُّ", "Ad-Darr", "The Distresser"],
  ["ٱلنَّافِعُ", "An-Nafi'", "The Bestower of Benefit"],
  ["ٱلنُّورُ", "An-Noor", "The Light"],
  ["ٱلْهَادِي", "Al-Hadee", "The Guide"],
  ["ٱلْبَدِيعُ", "Al-Badee'", "The Incomparable Originator"],
  ["ٱلْبَاقِي", "Al-Baqee", "The Everlasting"],
  ["ٱلْوَارِثُ", "Al-Warith", "The Inheritor"],
  ["ٱلرَّشِيدُ", "Ar-Rasheed", "The Guide to the Right Path"],
  ["ٱلصَّبُورُ", "As-Saboor", "The Most Patient"],
];

export const ASMA: AsmaName[] = ROWS.map(([arabic, transliteration, meaning], i) => ({
  index: i + 1,
  arabic,
  transliteration,
  meaning,
}));

export const ASMA_TOTAL = ASMA.length;

export function asmaAt(index: number): AsmaName {
  const i = ((index - 1) % ASMA_TOTAL + ASMA_TOTAL) % ASMA_TOTAL;
  return ASMA[i] as AsmaName;
}

export const ASMA_REVIEW_STATUS = "needs-review" as const;

/* ------------------------------------------------------------------ */
/* Section 47: any Name can be selected and counted like any dhikr.    */
/* No Abjad-derived repetition count is ever attached to a Name.       */
/* ------------------------------------------------------------------ */


export const ASMA_ID_PREFIX = "asma-";

export function isAsmaId(id: string): boolean {
  return id.startsWith(ASMA_ID_PREFIX);
}

/** Turn a Name into a Dhikr so the one counter engine can drive it. */
export function asmaToDhikr(index: number): Dhikr | undefined {
  const a = ASMA[index - 1];
  if (!a) return undefined;
  return {
    id: `${ASMA_ID_PREFIX}${a.index}`,
    name: a.transliteration,
    arabic: a.arabic,
    transliteration: a.transliteration,
    meaning: a.meaning,
    category: "asma",
    aliases: [
      a.transliteration,
      a.meaning,
      "asma ul husna",
      "99 names",
      "names of allah",
    ],
    // Every target here is the user's own goal. The app claims nothing.
    targets: [
      { value: 33, kind: "user-goal" },
      { value: 100, kind: "user-goal" },
      { value: 1000, kind: "user-goal" },
    ],
    defaultTarget: 33,
    sources: [],
    reviewStatus: ASMA_REVIEW_STATUS,
  };
}

export function asmaFromId(id: string): Dhikr | undefined {
  if (!isAsmaId(id)) return undefined;
  const n = Number(id.slice(ASMA_ID_PREFIX.length));
  return Number.isFinite(n) ? asmaToDhikr(n) : undefined;
}
