/**
 * Word-for-word check of the migrated copy against the live WordPress site.
 * Both sides are reduced to a plain text stream, then compared. Any drift is
 * printed as the first differing line.
 *
 *   node scripts/verify-content.mjs http://localhost:3000 https://old-site.example
 */

const LOCAL = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const LIVE = (
  process.argv[3] ?? "https://slateblue-mandrill-605528.hostingersite.com"
).replace(/\/$/, "");

// The privacy policy is no longer compared: it was rewritten on purpose for the
// Premium plan, and the WordPress copy was wrong about ads and analytics.
const PAGES = ["/", "/about-us/", "/contact-us/"];

/** Strips a page to the words a reader sees, dropping chrome and scripts. */
function toText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&#8216;|&lsquo;/g, "‘")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .split("\n")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** The article body, taken between the first and last sentence we expect. */
function slice(lines, first, last) {
  const a = lines.findIndex((l) => l.startsWith(first));
  const b = lines.map((l) => l.startsWith(last)).lastIndexOf(true);
  if (a === -1 || b === -1 || b < a) return null;
  return lines.slice(a, b + 1);
}

const BOUNDS = {
  "/": ["Bhakti Nam Jap Counter – Digital Online", "Follow Bhakti Nam Jap today"],
  "/about-us/": ["Our Spiritual Mission", "Join the growing Bhakti Nam Jap family"],
  "/contact-us/": ["Get In Touch", "Your privacy is sacred"],
};

let failed = 0;

for (const path of PAGES) {
  const [first, last] = BOUNDS[path];
  const [liveHtml, localHtml] = await Promise.all([
    fetch(LIVE + path).then((r) => r.text()),
    fetch(LOCAL + path).then((r) => r.text()),
  ]);

  const live = slice(toText(liveHtml), first, last);
  const local = slice(toText(localHtml), first, last);

  if (!live || !local) {
    failed += 1;
    console.log(`${path}  COULD NOT LOCATE BODY (live=${!!live} local=${!!local})`);
    continue;
  }

  // The live page splits some runs across extra inline tags; join and compare
  // the words themselves so markup differences do not read as copy changes.
  // The Contact page prints the site's own address. Both sides are folded to
  // one token so a domain change does not read as a copy change.
  const norm = (arr) =>
    arr
      .join(" ")
      .replaceAll(LIVE, "SITE_URL")
      .replaceAll(new URL(LOCAL).origin, "SITE_URL")
      .replaceAll(process.env.NEXT_PUBLIC_SITE_URL ?? "https://bhaktinamjap.com", "SITE_URL")
      .replace(/\s+/g, " ")
      .trim();
  const a = norm(live);
  const b = norm(local);

  if (a === b) {
    console.log(`${path}  OK  ${b.split(" ").length} words identical`);
    continue;
  }

  failed += 1;
  const aw = a.split(" ");
  const bw = b.split(" ");
  let i = 0;
  while (i < aw.length && i < bw.length && aw[i] === bw[i]) i += 1;
  console.log(`${path}  DIFF at word ${i}`);
  console.log(`   live : ...${aw.slice(Math.max(0, i - 8), i + 8).join(" ")}`);
  console.log(`   local: ...${bw.slice(Math.max(0, i - 8), i + 8).join(" ")}`);
}

console.log(failed ? `\n${failed} page(s) differ` : "\nAll pages match word for word");
process.exit(failed ? 1 : 0);
