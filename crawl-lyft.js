import axios from 'axios';
import fs from 'fs';
import cheerio from 'cheerio';
import { URL } from 'url';

// Output file for the Lyft engineering summary
const OUTPUT_FILE = './lyft-summary.md';
const START_URL = 'https://eng.lyft.com';
const MAX_LINKS = 100; // increased from 25
const MAX_DEPTH = 3; // crawl depth (0 = start page, up to 2 = two hops, etc.)
const REQUEST_TIMEOUT = 15000;

function normalizeUrl(u) {
  try {
    const url = new URL(u);
    // remove fragment
    url.hash = '';
    // normalize: remove trailing slash except for root
    if (url.pathname !== '/' && url.pathname.endsWith('/')) url.pathname = url.pathname.replace(/\/+$/,'');
    return url.toString();
  } catch {
    return null;
  }
}

function isLikelyBinaryPath(pathname) {
  // crude filter for common binary/file extensions
  return /\.(jpg|jpeg|png|gif|pdf|zip|rar|exe|tar|gz|mp4|mp3|woff|woff2|ttf|svg)$/.test(pathname.toLowerCase());
}

async function fetchHtml(url) {
  const res = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; crawl-lyft/1.0)' },
    timeout: REQUEST_TIMEOUT,
    maxRedirects: 5,
  });
  return res.data;
}

async function crawlLyft() {
  try {
    console.log(`Starting crawl of ${START_URL} with maxLinks=${MAX_LINKS} and maxDepth=${MAX_DEPTH}...`);

    const origin = new URL(START_URL).origin;

    // queue entries: { url, depth }
    const queue = [{ url: START_URL, depth: 0 }];
    const visited = new Set();
    const enqueued = new Set([normalizeUrl(START_URL)]);

    // Map of discovered links -> title text
    const links = new Map();

    while (queue.length > 0 && links.size < MAX_LINKS) {
      const { url, depth } = queue.shift();
      const norm = normalizeUrl(url);
      if (!norm) continue;
      if (visited.has(norm)) continue;

      console.log(`Crawling (depth ${depth}): ${norm}`);
      visited.add(norm);

      let html = '';
      try {
        html = await fetchHtml(norm);
      } catch (err) {
        console.warn(`  Failed to fetch ${norm}: ${err.message}`);
        continue;
      }

      const $ = cheerio.load(html);

      // If this page itself is a useful link, capture its title
      const pageTitle = ($('title').first().text() || '').trim() || null;
      if (!links.has(norm) && links.size < MAX_LINKS) {
        links.set(norm, pageTitle || norm);
      } else if (pageTitle && links.has(norm)) {
        // update title if placeholder
        links.set(norm, pageTitle);
      }

      // Extract anchors, prefer anchors in <article> elements first
      const collected = [];
      $('article a[href]').each((i, el) => {
        const href = $(el).attr('href');
        const text = ($(el).text() || '').trim();
        if (href && text) collected.push({ href, text });
      });

      if (collected.length === 0) {
        $('a[href]').each((i, el) => {
          const href = $(el).attr('href');
          const text = ($(el).text() || '').trim();
          // require some anchor text to avoid nav items like icons
          if (href && text && text.length >= 2) collected.push({ href, text });
        });
      }

      for (const { href, text } of collected) {
        if (links.size >= MAX_LINKS) break;
        let absolute;
        try {
          absolute = new URL(href, norm).toString();
        } catch {
          continue;
        }
        // normalize and skip fragments
        const absoluteNorm = normalizeUrl(absolute);
        if (!absoluteNorm) continue;
        if (!absoluteNorm.startsWith(origin)) continue; // same-origin only
        if (isLikelyBinaryPath(new URL(absoluteNorm).pathname)) continue;

        if (!links.has(absoluteNorm)) {
          links.set(absoluteNorm, text || absoluteNorm);
        }

        // enqueue for crawling if depth limit not reached
        if (depth + 1 < MAX_DEPTH) {
          if (!visited.has(absoluteNorm) && !enqueued.has(absoluteNorm)) {
            queue.push({ url: absoluteNorm, depth: depth + 1 });
            enqueued.add(absoluteNorm);
          }
        }
      }

      // small delay to be polite
      await new Promise((r) => setTimeout(r, 250));
    }

    const items = Array.from(links.entries()).slice(0, MAX_LINKS);

    // Build Markdown output
    const timestamp = new Date().toUTCString();
    let md = `# Lyft Engineering Site Summary\n`;
    md += `> **Source:** ${START_URL}  \n`;
    md += `> **Crawl Depth:** ${MAX_DEPTH}  \n`;
    md += `> **Last Updated:** ${timestamp}  \n`;
    md += `> **Total Links Included:** ${items.length}  \n\n`;

    md += `---\n\n`;

    items.forEach(([url, title], idx) => {
      md += `## ${idx + 1}. [${title || url}](${url})\n`;
      md += `* **URL:** <${url}>\n\n`;
      md += `---\n\n`;
    });

    fs.writeFileSync(OUTPUT_FILE, md, 'utf8');
    console.log(`Wrote summary to ${OUTPUT_FILE} (${items.length} links).`);

  } catch (error) {
    console.error(`Fatal error during execution: ${error.message}`);
  }
}

crawlLyft();
