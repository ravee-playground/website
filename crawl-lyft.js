import fs from 'fs';
import { chromium } from 'playwright';
import { URL } from 'url';

const OUTPUT_FILE = './lyft-summary.md';
const MAX_LINKS = 100; 
const REQUEST_TIMEOUT = 15000;

// The target topic landing pages containing infinite scroll content
const TARGET_TOPICS = [
  'https://eng.lyft.com/all?topic=security',
  'https://eng.lyft.com/all?topic=product',
  'https://eng.lyft.com/all?topic=mobile',
  'https://eng.lyft.com/all?topic=engineering',
  'https://eng.lyft.com/all?topic=data-science',
  'https://eng.lyft.com/all?topic=data'
];

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

// Helper to scroll down a page gradually to load infinite scroll contents
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 400;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        // Stop scrolling when we hit the bottom or 20 scrolls (safeguard)
        if (totalHeight >= scrollHeight || totalHeight > 8000) {
          clearInterval(timer);
          resolve();
        }
      }, 150);
    });
  });
  // Wait a moment for network payloads to resolve into components
  await page.waitForTimeout(1000);
}

async function crawlLyft() {
  let browser;
  try {
    console.log(`Starting headless browser crawl for Lyft Engineering topics...`);
    
    // Launch headless browser instance
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });
    const page = await context.newPage();

    const origin = 'https://eng.lyft.com';
    const queue = [];
    const visited = new Set();
    const crawledArticles = new Map();

    // 1. First Pass: Seed the queue by processing the dynamic infinite-scroll topic sections
    for (const topicUrl of TARGET_TOPICS) {
      console.log(`Gathering hidden links from dynamic feed: ${topicUrl}`);
      try {
        await page.goto(topicUrl, { waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT });
        
        // Scroll to load lazy-loaded elements
        await autoScroll(page);

        // Extract all visible URLs from the feed
        const hrefs = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('a[href]')).map(a => a.href);
        });

        for (const href of hrefs) {
          const norm = normalizeUrl(href);
          if (norm && norm.startsWith(origin) && !isLikelyBinaryPath(new URL(norm).pathname)) {
            // Avoid adding index/topic directory paths back into the deep content loop
            if (!norm.includes('?topic=') && norm !== origin && !queue.includes(norm)) {
              queue.push(norm);
            }
          }
        }
      } catch (err) {
        console.warn(`Failed parsing topic URL ${topicUrl}: ${err.message}`);
      }
    }

    console.log(`Discovered ${queue.length} unique deep links. Beginning body content extraction loop...`);

    // 2. Second Pass: Extract deep body text payloads up to MAX_LINKS limit
    while (queue.length > 0 && crawledArticles.size < MAX_LINKS) {
      const targetUrl = queue.shift();
      const norm = normalizeUrl(targetUrl);
      if (!norm || visited.has(norm)) continue;

      console.log(`Extracting content (${crawledArticles.size + 1}/${MAX_LINKS}): ${norm}`);
      visited.add(norm);

      try {
        await page.goto(norm, { waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT });
        
        const pageData = await page.evaluate(() => {
          const title = document.querySelector('title')?.innerText || 'Untitled';
          
          // Target common article wrapper hierarchies
          const articleEl = document.querySelector('article') || document.querySelector('.post-content') || document.querySelector('main');
          const content = articleEl ? articleEl.innerText : '';
          
          return { title, content };
        });

        const cleanContent = pageData.content.replace(/\s+/g, ' ').trim();

        // Only commit real structural articles
        if (cleanContent.length > 300) {
          crawledArticles.set(norm, {
            title: pageData.title.trim(),
            content: cleanContent
          });
        }
      } catch (err) {
        console.warn(`Skipping path ${norm}: ${err.message}`);
      }

      // Quick throttle cooldown delay
      await page.waitForTimeout(200);
    }

    // 3. Document Compilation Stage
    const timestamp = new Date().toUTCString();
    let md = `# Lyft Engineering Site Summary\n`;
    md += `> **Source Topics:** ${TARGET_TOPICS.length} Feeds Parsed \n`;
    md += `> **Last Updated:** ${timestamp}  \n\n`;
    md += `---\n\n`;

    Array.from(crawledArticles.entries()).forEach(([url, data]) => {
      md += `# ${data.title}\n`;
      md += `**URL:** ${url}\n\n`;
      md += `${data.content}\n\n`;
      md += `---\n\n`;
    });

    fs.writeFileSync(OUTPUT_FILE, md, 'utf8');
    console.log(`Wrote summary data to ${OUTPUT_FILE} (${crawledArticles.size} full articles saved).`);

  } catch (error) {
    console.error(`Fatal error during execution: ${error.message}`);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

crawlLyft();
