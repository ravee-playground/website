import http from "http";
import url from "url";
import fs from "fs";
import path from "path";

// Try to read your data file (checks chunks.jsonl first, then falls back to your resume.json)
let docs = [];
const chunksPath = path.join(process.cwd(), "chunks.jsonl");
const resumePath = path.join(process.cwd(), "index/resume.json");

try {
  if (fs.existsSync(chunksPath)) {
    const fileContent = fs.readFileSync(chunksPath, "utf-8");
    docs = fileContent.split("\n").filter(line => line.trim() !== "").map(line => JSON.parse(line));
    console.log(`Loaded data from chunks.jsonl`);
  } else if (fs.existsSync(resumePath)) {
    docs = JSON.parse(fs.readFileSync(resumePath, "utf-8"));
    console.log(`Loaded data from index/resume.json`);
  }
} catch (e) {
  console.error("Warning: Could not load data files during startup.", e.message);
}

// --- Your exact custom scoring algorithm ---
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

// Reusable search logic matching your exact specification
function runSearch(q) {
  const terms = q.toLowerCase().split(/\s+/).slice(0, 10);
  return docs
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
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  
  // Set JSON headers by default for API routes
  res.setHeader("Content-Type", "application/json");

  // 1. YOUR ORIGINAL ENDPOINT (Kept intact for backwards compatibility)
  if (parsed.pathname === "/search") {
    const q = (parsed.query.q || "").toString().trim();
    if (!q) {
      res.writeHead(400);
      return res.end(JSON.stringify({ error: "Missing q" }));
    }
    const results = runSearch(q);
    res.writeHead(200);
    return res.end(JSON.stringify({ query: q, results }, null, 2));
  }

  // 2. MCP ENDPOINT: List Available Tools to the LLM
  if (parsed.pathname === "/tools" && req.method === "GET") {
    res.writeHead(200);
    return res.end(JSON.stringify({
      tools: [
        {
          name: "search_documentation",
          description: "Search through the documentation chunks using a custom weighted keyword-matching algorithm.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "The keyword or search terms to look up." }
            },
            required: ["query"]
          }
        }
      ]
    }));
  }

  // 3. MCP ENDPOINT: Execute Tool
  if (parsed.pathname === "/tools/search_documentation" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const params = JSON.parse(body || "{}");
        const query = params.query || "";
        
        if (!query.trim()) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: "Missing query parameter" }));
        }

        const results = runSearch(query);

        // MCP expects output structured inside a content text block
        res.writeHead(200);
        return res.end(JSON.stringify({
          content: [
            {
              type: "text",
              text: JSON.stringify(results, null, 2)
            }
          ]
        }));
      } catch (err) {
        res.writeHead(500);
        return res.end(JSON.stringify({ error: "Malformed JSON or server error" }));
      }
    });
    return;
  }

  // Fallback Route
  res.writeHead(404);
  return res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(process.env.PORT || 8787, () => {
  console.log("MCP Search API listening on port", process.env.PORT || 8787);
});
