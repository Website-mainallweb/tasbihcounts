// Regenerates site/src/content/pages.ts from the HTML in this folder, so the page
// copy has one source of truth. Run: node content/build.mjs
import { readFileSync, writeFileSync } from "node:fs";

const here = new URL("./", import.meta.url);
const pages = [
  ["home", "home.html"],
  ["aboutUs", "about-us.html"],
  ["contactUs", "contact-us.html"],
  ["privacyPolicy", "privacy-policy.html"],
  ["terms", "terms.html"],
  ["refundPolicy", "refund-policy.html"],
];

let out = `// Page copy. /content holds the HTML source of each page; this file is generated
// from it by \`node content/build.mjs\` — edit the HTML, not this file.
// {{SUPPORT_EMAIL}} is filled in by the page from SUPPORT_EMAIL in lib/site.ts so
// the address follows the site domain.
`;
for (const [name, file] of pages) {
  const html = readFileSync(new URL(file, here), "utf8").trim();
  out += `\nexport const ${name}: string = ${JSON.stringify(html)};\n`;
}
writeFileSync(new URL("../site/src/content/pages.ts", here), out);
console.log("wrote site/src/content/pages.ts");
