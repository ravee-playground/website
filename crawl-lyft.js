import axios from 'axios';
import fs from 'fs';
import cheerio from 'cheerio';
import { URL } from 'url';

// Output file for the Lyft engineering summary
const OUTPUT_FILE = './lyft-summary.md';
const START_URL = 'https://eng.lyft.com';
const MAX_LINKS = 25;

async function crawlLyft() {
  try {
    console.log(`Fetching ${START_URL}...`);
    const { data: html } = await axios.get(START_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; crawl-lyft/1.0)'
      },
      timeout: 15000
    });

    const $ = cheerio.load(html);

    // Site-level metadata
    const siteTitle = ($('title').first().text() || 'Lyft Engineering').trim();
    const siteDescription = ($('meta[name="description"]').attr('content') || '').trim();

    // Collect same-origin links with anchor text
    const origin = new URL(START_URL).origin;
    const links = new Map();

    // Prefer article anchors first
    $('article a[href]').each((i, el) => {
      if (links.size >= MAX_LINKS) return;
      const href = $(el).attr('href');
      const text = ($(el).text() || '').trim();
      if (!href || !text) return;
      let absolute;
      try { absolute = new URL(href, START_URL).toString(); } catch { return; }
      if (!absolute.startsWith(origin)) return;
      if (!links.has(absolute)) links.set(absolute, text);
    });

    // Fallback: general anchors
    if (links.size < MAX_LINKS) {
      $('a[href]').each((i, el) => {
        if (links.size >= MAX_LINKS) return;
        const href = $(el).attr('href');
        const text = ($(el).text() || '').trim();
        if (!href || !text || text.length < 3) return;
        let absolute;
        try { absolute = new URL(href, START_URL).toString(); } catch { return; }
        if (!absolute.startsWith(origin)) return;
        if (!links.has(absolute)) links.set(absolute, text);
      });
    }

    const items = Array.from(links.entries()).slice(0, MAX_LINKS);

    // Build Markdown output
    const timestamp = new Date().toUTCString();
    let md = `# Lyft Engineering Site Summary\n`;
    md += `> **Source:** ${START_URL}  \n`;
    md += `> **Site Title:** ${siteTitle}  \n`;
    md += `> **Last Updated:** ${timestamp}  \n`;
    md += `> **Total Links Included:** ${items.length}  \n\n`;

    if (siteDescription) md += `**Site Description:** ${siteDescription}\n\n`;
    md += `---\n\n`;

    items.forEach(([url, title], idx) => {
      md += `## ${idx + 1}. [${title}](${url})\n`;
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
