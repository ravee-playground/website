// search.js
import fs from "fs";

const q = process.argv.slice(2).join(" ").trim();
if (!q) {
  console.error('Usage: node search.js "your query here"');
  process.exit(1);
}

const INDEX_PATH = "index/resume.jsonl";
if (!fs.existsSync(INDEX_PATH)) {
  console.error(`Missing ${INDEX_PATH}. Run the crawler workflow first.`);
  process.exit(1);
}

const docs = JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8"));

function score(doc, terms) {
  const title = (doc.title || "").toLowerCase();
  const heads = (doc.headings || []).join(" ").toLowerCase();
  const text = (doc.text || "").toLowerCase();

  let s = 0;
  for (const t of terms) {
    if (!t) continue;
    if (title.includes(t)) s += 8;
    if (heads.includes(t)) s += 4;
    if (text.includes(t)) s += 1;
  }
  return s;
}

const terms = q.toLowerCase().split(/\s+/).slice(0, 10);

const results = docs
  .map((d) => ({ s: score(d, terms), d }))
  .filter((r) => r.s > 0)
  .sort((a, b) => b.s - a.s)
  .slice(0, 8)
  .map((r) => ({
    score: r.s,
    url: r.d.url,
    title: r.d.title,
    headings: (r.d.headings || []).slice(0, 8),
    snippet: (r.d.text || "").slice(0, 800),
  }));

console.log(JSON.stringify({ query: q, results }, null, 2));
