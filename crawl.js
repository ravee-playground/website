import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
/*
const START_URL = 'https://docusaurus.io/docs';
const BASE_URL = 'https://docusaurus.io';
const OUTPUT_FILE = './chunks.jsonl';

// Simple helper to sleep between requests to be polite to the server
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function crawlDocs() {
    try {
        console.log(`Fetching main documentation page to find links...`);
        const { data } = await axios.get(START_URL);
        const $ = cheerio.load(data);
        
        // Docusaurus sidebars typically contain links under '.menu__link'
        const docLinks = new Set();
        $('.menu__link, a').each((_, el) => {
            const href = $(el).attr('href');
            if (href && href.startsWith('/docs')) {
                // Resolve relative URLs to full URLs
                const fullUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
                // Remove trailing slashes and hashes to avoid duplicate crawling
                const cleanUrl = fullUrl.split('#')[0].replace(/\/$/, "");
                docLinks.add(cleanUrl);
            }
        });*/
const API_KEY = process.env.NEWSAPI_KEY;
const START_URL = `https://newsapi.org/v2/everything?q=documentation&apiKey=${API_KEY}`;

// Inside crawlDocs():
const { data } = await axios.get(START_URL);
const articles = data.articles;

for (const article of articles) {
  const docChunk = {
    title: article.title,
    headings: [],
    text: article.description || article.content,
    url: article.url
  };
  // ...rest of logic
}


        const urlsToCrawl = Array.from(docLinks);
        console.log(`Found ${urlsToCrawl.length} unique documentation pages to crawl.\n`);

        // Clear or create the output file
        fs.writeFileSync(OUTPUT_FILE, '');

        for (let i = 0; i < urlsToCrawl.length; i++) {
            const url = urlsToCrawl[i];
            console.log(`[${i + 1}/${urlsToCrawl.length}] Crawling: ${url}`);
            
            try {
                const pageResponse = await axios.get(url);
                const pageDoc = cheerio.load(pageResponse.data);
                
                // Docusaurus primary content usually lives inside <article> or main markdown containers
                const mainContent = pageDoc('article, main, .markdown');
                
                if (mainContent.length === 0) continue;

                // Extract title
                const title = pageDoc('h1').first().text().trim() || 'Untitled Section';
                
                // Extract all subheadings (h2, h3)
                const headings = [];
                mainContent.find('h2, h3').each((_, heading) => {
                    headings.push(pageDoc(heading).text().trim());
                });

                // Extract and clean paragraph body text
                const textChunks = [];
                mainContent.find('p, li').each((_, p) => {
                    textChunks.push(pageDoc(p).text().trim());
                });
                const cleanText = textChunks.filter(t => t.length > 0).join(' ');

                // Construct the JSON structure matching your original HTML browser expectations
                const docChunk = {
                    title: title,
                    headings: headings,
                    text: cleanText,
                    url: url
                };

                // Append line directly to the chunks.jsonl file
                fs.appendFileSync(OUTPUT_FILE, JSON.stringify(docChunk) + '\n');

            } catch (err) {
                console.error(`❌ Failed to crawl ${url}: ${err.message}`);
            }

            // Pause for 300ms between requests to avoid rate limits
            await sleep(300);
        }

        console.log(`\n All done! Data safely written to ${OUTPUT_FILE}`);

    } catch (error) {
        console.error(`Fatal error during crawl initialization: ${error.message}`);
    }
}

crawlDocs();
