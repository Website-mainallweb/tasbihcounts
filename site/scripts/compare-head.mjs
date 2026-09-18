/**
 * Side by side diff of the <head> the old WordPress site served and the one the
 * new site serves, per page. Domains are folded to a token so the two are
 * comparable. Prints what is missing, what is extra and what changed.
 *
 *   node scripts/compare-head.mjs http://localhost:3000 https://old-site
 */

const LOCAL = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const LIVE = (
  process.argv[3] ?? "https://slateblue-mandrill-605528.hostingersite.com"
).replace(/\/$/, "");
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://bhaktinamjap.com";

const PAGES = ["/", "/about-us/", "/contact-us/", "/privacy-policy/", "/blog/"];

/** Everything Google reads out of the head, as name -> value pairs. */
function headFacts(html) {
  const head = html.slice(0, html.indexOf("</head>") + 7);
  const facts = {};

  const title = head.match(/<title[^>]*>([\s\S]*?)<\/title>/);
  if (title) facts["title"] = title[1];

  for (const m of head.matchAll(
    /<meta\s+(?:name|property)=["']([^"']+)["']\s+content=["']([^"']*)["']/gi,
  )) {
    facts["meta:" + m[1].toLowerCase()] = m[2];
  }
  // Attribute order varies between the two generators.
  for (const m of head.matchAll(
    /<meta\s+content=["']([^"']*)["']\s+(?:name|property)=["']([^"']+)["']/gi,
  )) {
    facts["meta:" + m[2].toLowerCase()] = m[1];
  }

  const canon = head.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  if (canon) facts["link:canonical"] = canon[1];

  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (ld) {
    try {
      const graph = JSON.parse(ld[1])["@graph"] ?? [];
      facts["jsonld:types"] = graph
        .map((n) => (Array.isArray(n["@type"]) ? n["@type"].join("+") : n["@type"]))
        .join(",");
      for (const node of graph) {
        const type = Array.isArray(node["@type"]) ? node["@type"][0] : node["@type"];
        if (node.name) facts[`jsonld:${type}.name`] = node.name;
        if (node.headline) facts[`jsonld:${type}.headline`] = node.headline;
        if (node.keywords) facts[`jsonld:${type}.keywords`] = node.keywords;
        if (node.datePublished) facts[`jsonld:${type}.datePublished`] = node.datePublished;
      }
    } catch {
      facts["jsonld:types"] = "PARSE ERROR";
    }
  }
  return facts;
}

const fold = (v) =>
  String(v)
    .replaceAll(LIVE, "SITE")
    .replaceAll(SITE, "SITE")
    .replaceAll(LOCAL, "SITE")
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&#x27;|&#039;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

// Head entries the old site emitted that carry no ranking meaning.
const IGNORE = [
  /^meta:generator$/,
  /^meta:viewport$/,
  /^meta:og:updated_time$/,
  /^meta:article:/,
  /^meta:twitter:label/,
  /^meta:twitter:data/,
  /^meta:msapplication/,
  /^meta:theme-color$/,
  /^meta:og:image:(secure_url|width|height|alt|type)$/,
  // Site Kit's host-platform attribution and the PWA plugin's signature. Both
  // describe the WordPress install, not the site, and would be false here.
  /^meta:google-adsense-platform-/,
  /^meta:pwaforwp$/,
];
const ignored = (k) => IGNORE.some((re) => re.test(k));

let problems = 0;

for (const path of PAGES) {
  const [oldHtml, newHtml] = await Promise.all([
    fetch(LIVE + path).then((r) => r.text()),
    fetch(LOCAL + path).then((r) => r.text()),
  ]);
  const a = headFacts(oldHtml);
  const b = headFacts(newHtml);

  const missing = [];
  const changed = [];
  for (const [k, v] of Object.entries(a)) {
    if (ignored(k)) continue;
    if (!(k in b)) {
      missing.push(`${k} = ${fold(v)}`);
      continue;
    }
    if (fold(v) !== fold(b[k])) changed.push(`${k}\n      old: ${fold(v)}\n      new: ${fold(b[k])}`);
  }
  const added = Object.keys(b).filter((k) => !(k in a) && !ignored(k));

  console.log(`\n${path}`);
  if (!missing.length && !changed.length) {
    console.log(`  every ranking field carried over (${Object.keys(a).length} checked)`);
  }
  if (missing.length) {
    problems += missing.length;
    console.log("  MISSING from the new site:");
    missing.forEach((m) => console.log("    - " + m));
  }
  if (changed.length) {
    problems += changed.length;
    console.log("  CHANGED:");
    changed.forEach((c) => console.log("    - " + c));
  }
  if (added.length) console.log("  added (new, not a regression): " + added.join(", "));
}

// Files the old site served from the document root.
for (const file of ["/ads.txt", "/robots.txt", "/sitemap.xml"]) {
  const res = await fetch(LOCAL + file);
  console.log(`\n${file}  HTTP ${res.status}`);
  if (res.ok) console.log("  " + (await res.text()).trim().split("\n").slice(0, 3).join(" | "));
  else problems += 1;
}

console.log(problems ? `\n${problems} problem(s)` : "\nNo SEO regressions");
process.exit(problems ? 1 : 0);
