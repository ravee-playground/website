import axios from 'axios';
import fs from 'fs';
import { load } from 'cheerio';
import { URL } from 'url';

const OUTPUT_FILE = './lyft-summary.md';
const START_URL = process.env.TARGET_URL || 'https://eng.lyft.com';
const MAX_LINKS = 100; 
const MAX_DEPTH = 3; 
const REQUEST_TIMEOUT = 15000;

function normalizeUrl(u) {
  try {
    const url = new URL(u);
    url.hash = '';
    if (url.pathname !== '/' && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.toString();
  } catch {
    return null;
  }
}

function isLikelyBinaryPath(pathname) {
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
    const queue = [{ url: START_URL, depth: 0 }];
    const visited = new Set();
    const enqueued = new Set([normalizeUrl(START_URL)]);

    // FIX 1: Store objects containing the title AND the full text body content
    const crawledArticles = new Map();

    while (queue.length > 0 && crawledArticles.size < MAX_LINKS) {
      const { url, depth } = queue.shift();
      const norm = normalizeUrl(url);
      if (!norm || visited.has(norm)) continue;

      console.log(`Crawling (depth ${depth}): ${norm}`);
      visited.add(norm);

      let html = '';
      try {
        html = await fetchHtml(norm);
      } catch (err) {
        console.warn(`  Failed to fetch ${norm}: ${err.message}`);
        continue;
      }

      const $ = load(html);
      const pageTitle = ($('title').first().text() || '').trim() || 'Untitled';

      // FIX 2: Target Medium/Blog post structural markup to extract the text content
      // Medium (which Lyft Engineering uses) wraps posts in 'article' tags or specific sections
      let bodyText = $('article').text() || $('.post-content').text() || $('main').text();
      
      // Clean up excess whitespace strings so the text block is clean
      bodyText = bodyText.replace(/\s+/g, ' ').trim();

      // Only save if we found some coherent content, avoiding processing blank error/landing pages
      if (bodyText.length > 200 && !crawledArticles.has(norm)) {
        crawledArticles.set(norm, { title: pageTitle, content: bodyText });
      }

      // Collect sub-links to keep diving deeper
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
          if (href && text && text.length >= 2) collected.push({ href, text });
        });
      }

      for (const { href } of collected) {
        if (crawledArticles.size >= MAX_LINKS) break;
        let absolute;
        try {
          absolute = new URL(href, norm).toString();
        } catch {
          continue;
        }
        
        const absoluteNorm = normalizeUrl(absolute);
        if (!absoluteNorm || !absoluteNorm.startsWith(origin)) continue; 
        if (isLikelyBinaryPath(new URL(absoluteNorm).pathname)) continue;

        if (depth + 1 < MAX_DEPTH) {
          if (!visited.has(absoluteNorm) && !enqueued.has(absoluteNorm)) {
            queue.push({ url: absoluteNorm, depth: depth + 1 });
            enqueued.add(absoluteNorm);
          }
        }
      }

      await new Promise((r) => setTimeout(r, 250));
    }

    // Build Markdown output for the summarizer
    const timestamp = new Date().toUTCString();
    let md = `# Lyft Engineering Site Summary\n`;
    md += `> **Source:** ${START_URL}  \n`;
    md += `> **Last Updated:** ${timestamp}  \n\n`;
    md += `---\n\n`;

    // FIX 3: Write out individual articles split explicitly by your delimiter
    Array.from(crawledArticles.entries()).forEach(([url, data]) => {
      md += `# ${data.title}\n`;
      md += `**URL:** ${url}\n\n`;
      md += `${data.content}\n\n`;
      md += `---\n\n`; // This is the exact pattern your splitArticles() function scans for!
    });

    fs.writeFileSync(OUTPUT_FILE, md, 'utf8');
    console.log(`Wrote summary data to ${OUTPUT_FILE} (${crawledArticles.size} full articles saved).`);

  } catch (error) {
    console.error(`Fatal error during execution: ${error.message}`);
    process.exit(1); // Force a non-zero exit so GitHub Actions notices failures
  }
}

crawlLyft();
