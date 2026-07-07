import http from "http";
import url from "url";
import fs from "fs";

const docs = JSON.parse(fs.readFileSync("index/resume.json", "utf-8"));

function score(doc, terms) {
  const t = (doc.title || "").toLowerCase();
  const h = (doc.headings || []).join(" ").toLowerCase();
  const x = (doc.text || "").toLowerCase();
  let s = 0;
  for (const term of terms) {
    if (t.includes(term)) s += 8;
    if (h.includes(term)) s += 4;
    if (x.includes(term)) s += 1;
  }
  return s;
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  if (parsed.pathname !== "/search") {
    res.writeHead(404);
    return res.end("Not found");
  }

  const q = (parsed.query.q || "").toString().trim();
  if (!q) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Missing q" }));
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
      snippet: (r.d.text || "").slice(0, 600),
    }));

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ query: q, results }, null, 2));
});

server.listen(process.env.PORT || 8787, () => {
  console.log("Search API listening on", process.env.PORT || 8787);
});
