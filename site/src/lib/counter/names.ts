/**
 * The built-in library of names, shared by the counter and the pages that read
 * its history. It lived inside the engine, so Stats could not look a name up and
 * showed raw ids in its filter — "c1789143769915" for someone's own mantra (#25).
 *
 * Order is what the library shows first (2026-09-13, Rajan): the names most
 * people chant — Radha, Shiv, Mahadev, Hanuman, Ram — at the top, then the rest,
 * then the mantras as their own group. Ids never change: a practice's history is
 * stored under them.
 */

export type NameEntry = { id: string; n: string; t: string; m: string; g?: "mantra" };

/**
 * The list this page is actually using.
 *
 * Since the admin panel took over the library (docs/ADMIN.md §3.9), the page can
 * carry a newer copy from the database, inlined as `window.__njcNames` before
 * the engine starts (lib/counter/library.ts). This returns that when it is there
 * and the list below when it is not — an older browser, a page rendered while
 * Supabase was unreachable, a test.
 *
 * NAMES therefore stays in the repository as the fallback rather than as
 * history. It is checked rather than trusted: this value reaches the page as
 * inline script, so anything malformed falls back instead of breaking the
 * counter, which is the one thing that must never stop working.
 */
export function library(): NameEntry[] {
  const injected = (globalThis as { __njcNames?: NameEntry[] }).__njcNames;
  // A shape check, not a trust boundary: the rows come from public.names, which
  // only the admin panel's service role can write, and the column constraints
  // are what actually guarantee the fields. This is here so that a page rendered
  // while the database was unreachable, or an old cached page, falls back to the
  // bundled list instead of handing the engine something it cannot draw. Kept to
  // one property on one element because this file is in the counter's first-load
  // bundle and it is within 40 bytes of its budget (scripts/check-bundle.mjs).
  return Array.isArray(injected) && typeof injected[0]?.id === "string" ? injected : NAMES;
}

export const NAMES: NameEntry[] = [
  { id: "radha", n: "राधा", t: "Radha", m: "The beloved of Krishna" },
  { id: "shriradha", n: "श्री राधा", t: "Shri Radha", m: "The queen of Vrindavan" },
  { id: "radhe", n: "राधे राधे", t: "Radhe Radhe", m: "Invoking Radha" },
  { id: "shiv", n: "शिव", t: "Shiv", m: "The auspicious one" },
  { id: "sambsadashiv", n: "साम्ब सदाशिव", t: "Samb Sadashiv", m: "Shiva, ever auspicious, with the Mother" },
  { id: "mahadev", n: "महादेव", t: "Mahadev", m: "The great god" },
  { id: "harharmahadev", n: "हर हर महादेव", t: "Har Har Mahadev", m: "Glory to the great god" },
  { id: "hanuman", n: "हनुमान", t: "Hanuman", m: "The devoted one" },
  { id: "shriram", n: "श्री राम", t: "Shri Ram", m: "Lord Rama" },
  { id: "ram", n: "राम", t: "Ram", m: "The all-pervading joy" },
  { id: "sitaram", n: "सीता राम", t: "Sita Ram", m: "The divine pair" },
  { id: "jaishriram", n: "जय श्री राम", t: "Jai Shri Ram", m: "Victory to Lord Rama" },
  { id: "krishna", n: "कृष्ण", t: "Krishna", m: "The all-attractive one" },
  { id: "radhekrsna", n: "राधे कृष्ण", t: "Radhe Krishna", m: "Radha with Krishna" },
  { id: "govind", n: "गोविन्द", t: "Govind", m: "Protector of the cows" },
  { id: "gopal", n: "गोपाल", t: "Gopal", m: "The cowherd boy" },
  { id: "vishnu", n: "विष्णु", t: "Vishnu", m: "The preserver" },
  { id: "narayan", n: "नारायण", t: "Narayan", m: "Resting place of all beings" },
  { id: "ganesh", n: "गणेश", t: "Ganesh", m: "Remover of obstacles" },
  { id: "durga", n: "दुर्गा", t: "Durga", m: "The invincible mother" },
  { id: "kali", n: "काली", t: "Kali", m: "Mother of time" },
  { id: "ambe", n: "अम्बे", t: "Ambe", m: "The mother" },
  { id: "lakshmi", n: "लक्ष्मी", t: "Lakshmi", m: "Goddess of abundance" },
  { id: "saraswati", n: "सरस्वती", t: "Saraswati", m: "Goddess of learning" },
  { id: "jagannath", n: "जगन्नाथ", t: "Jagannath", m: "Lord of the universe" },
  { id: "balaji", n: "बालाजी", t: "Balaji", m: "Venkateshwara" },
  { id: "khatushyam", n: "खाटू श्याम", t: "Khatu Shyam", m: "The beloved of Khatu" },
  { id: "sai", n: "साईं राम", t: "Sai Ram", m: "Sai Baba" },
  { id: "swaminarayan", n: "स्वामिनारायण", t: "Swaminarayan", m: "Sahajanand Swami" },
  { id: "dattatreya", n: "दत्तात्रेय", t: "Dattatreya", m: "The triple lord" },
  { id: "om", n: "ॐ", t: "Om", m: "The primordial sound" },

  // Mantra jap
  { id: "harekrsna", n: "हरे कृष्ण हरे राम", t: "Hare Krishna Hare Rama", m: "The maha-mantra", g: "mantra" },
  { id: "omnamah", n: "ॐ नमः शिवाय", t: "Om Namah Shivaya", m: "The five-syllable mantra", g: "mantra" },
  { id: "shriramjairam", n: "श्री राम जय राम जय जय राम", t: "Shri Ram Jai Ram Jai Jai Ram", m: "The Ram taraka mantra", g: "mantra" },
  { id: "omnamona", n: "ॐ नमो नारायणाय", t: "Om Namo Narayanaya", m: "The eight-syllable mantra", g: "mantra" },
  { id: "vasudev", n: "ॐ नमो भगवते वासुदेवाय", t: "Om Namo Bhagavate Vasudevaya", m: "The twelve-syllable mantra", g: "mantra" },
  { id: "omhanu", n: "ॐ श्री हनुमते नमः", t: "Om Shri Hanumate Namah", m: "Salutations to Hanuman", g: "mantra" },
  { id: "omgam", n: "ॐ गं गणपतये नमः", t: "Om Gam Ganapataye Namah", m: "Ganesha bija mantra", g: "mantra" },
  { id: "omdum", n: "ॐ दुं दुर्गायै नमः", t: "Om Dum Durgayai Namah", m: "Durga bija mantra", g: "mantra" },
  { id: "omshreem", n: "ॐ श्रीं महालक्ष्म्यै नमः", t: "Om Shreem Mahalakshmyai Namah", m: "Lakshmi mantra", g: "mantra" },
  { id: "gayatri", n: "ॐ भूर्भुवः स्वः", t: "Gayatri", m: "The Gayatri opening", g: "mantra" },
  { id: "mahamrityu", n: "ॐ त्र्यम्बकं यजामहे", t: "Mahamrityunjaya", m: "The healing mantra", g: "mantra" },
  { id: "kartikeya", n: "ॐ शरवणभवाय नमः", t: "Om Sharavanabhavaya Namah", m: "Kartikeya mantra", g: "mantra" },
  { id: "surya", n: "ॐ सूर्याय नमः", t: "Om Suryaya Namah", m: "Salutations to the sun", g: "mantra" },
  { id: "shanti", n: "ॐ शांति शांति शांति", t: "Om Shanti", m: "Peace", g: "mantra" },
];

/* Meanings in Hindi. The library showed English meanings under a Hindi interface. */
export const MEANING_HI: Record<string, string> = {
  radha: "श्रीकृष्ण की प्रिया", shriradha: "वृंदावन की स्वामिनी", sambsadashiv: "माँ सहित सदा कल्याणकारी शिव",
  harharmahadev: "महादेव की जय", shriram: "प्रभु श्रीराम", shriramjairam: "राम तारक मंत्र",
  ram: "सर्वव्यापी आनंद", sitaram: "दिव्य युगल", jaishriram: "प्रभु श्रीराम की जय", krishna: "सबको आकर्षित करने वाले",
  radhe: "श्री राधा का स्मरण", radhekrsna: "राधा संग कृष्ण", harekrsna: "महामंत्र", govind: "गौओं के रक्षक",
  gopal: "ग्वाल बाल", shiv: "कल्याणकारी", mahadev: "देवों के देव", omnamah: "पंचाक्षरी मंत्र", vishnu: "पालनहार",
  narayan: "सब प्राणियों के आश्रय", omnamona: "अष्टाक्षरी मंत्र", vasudev: "द्वादशाक्षरी मंत्र", hanuman: "परम भक्त",
  omhanu: "हनुमान जी को नमन", ganesh: "विघ्नहर्ता", omgam: "गणेश बीज मंत्र", durga: "अजेय माँ", omdum: "दुर्गा बीज मंत्र",
  kali: "काल की माता", ambe: "जगदम्बा माँ", lakshmi: "समृद्धि की देवी", omshreem: "लक्ष्मी मंत्र", saraswati: "विद्या की देवी",
  gayatri: "गायत्री मंत्र का आरम्भ", mahamrityu: "आरोग्य मंत्र", jagannath: "जगत के स्वामी", balaji: "श्री वेंकटेश्वर",
  khatushyam: "खाटू के प्रिय", sai: "साईं बाबा", swaminarayan: "सहजानंद स्वामी", dattatreya: "त्रिमूर्ति स्वरूप",
  kartikeya: "कार्तिकेय मंत्र", surya: "सूर्यदेव को नमन", om: "आदि नाद", shanti: "शांति",
};

/**
 * What a person calls a name: their own words for a custom mantra, the library
 * title for a built-in one — never the raw id. A custom id with no text on this
 * device (it was added on another one; custom text does not sync) reads as
 * "Your own mantra".
 */
export function nameLabel(id: string, custom: unknown, lang: "en" | "hi" = "en"): string {
  const own = Array.isArray(custom) ? (custom as Partial<NameEntry>[]).find((c) => c && c.id === id) : undefined;
  if (own) {
    const text = lang === "hi" ? own.n || own.t : own.t || own.n;
    if (typeof text === "string" && text.trim()) return text;
  }
  // library(), not NAMES: a name added through the admin panel must read as its
  // title on the Stats and Streak pages too, not as its raw id.
  const known = library().find((x) => x.id === id);
  if (known) return lang === "hi" ? known.n : known.t;
  if (/^c\d+$/.test(id)) return lang === "hi" ? "आपका अपना मंत्र" : "Your own mantra";
  return id;
}
