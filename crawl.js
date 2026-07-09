import axios from 'axios';
import fs from 'fs';

// Changed extension to .md
const OUTPUT_FILE = './chunky.md'; 
const API_KEY = process.env.NEWSAPI_KEY;
const START_URL = `https://newsapi.org/v2/everything?q=ai&apiKey=${API_KEY}`;

async function crawlDocs() {
    try {
        console.log(`Fetching articles from NewsAPI...`);
        
        const { data } = await axios.get(START_URL);
        const articles = data.articles;

        if (!articles || articles.length === 0) {
            console.log("No articles found matching the query.");
            return;
        }

        console.log(`Found ${articles.length} articles. Writing to ${OUTPUT_FILE}...\n`);

        // 1. Initialize the Markdown file with a clean Main Title and header metadata
        const timestamp = new Date().toUTCString();
        let markdownContent = `# Automated Documentation Search Index\n`;
        markdownContent += `> **Last Updated:** ${timestamp}  \n`;
        markdownContent += `> **Total Articles Found:** ${articles.length}\n\n`;
        markdownContent += `---\n\n`;

        // 2. Process each article and append formatted Markdown blocks
        for (let i = 0; i < articles.length; i++) {
            const article = articles[i];
            console.log(`[${i + 1}/${articles.length}] Formatting: ${article.title}`);

            const cleanText = article.description || article.content || '*No content summary available.*';

            // Add an H2 for the title acting as a link, bold metadata layout, and clear text blocks
            markdownContent += `## ${i + 1}. [${article.title || 'Untitled Article'}](${article.url})\n`;
            markdownContent += `* **Source URL:** <${article.url}>\n`;
            markdownContent += `* **Published At:** ${article.publishedAt || 'Unknown'}\n\n`;
            markdownContent += `${cleanText.trim()}\n\n`;
            
            // Add a clean visual divider between articles
            markdownContent += `---\n\n`;
        }

        // 3. Write the entire built string out to the file at once
        fs.writeFileSync(OUTPUT_FILE, markdownContent);
        console.log(`\n All done! Data safely written to ${OUTPUT_FILE}`);

    } catch (error) {
        console.error(`Fatal error during execution: ${error.message}`);
    }
}

crawlDocs();

/* 
import axios from 'axios';
import fs from 'fs';

const OUTPUT_FILE = './chunky.jsonl';
const API_KEY = process.env.NEWSAPI_KEY;
const START_URL = `https://newsapi.org/v2/everything?q=documentation&apiKey=${API_KEY}`;
process.env.NEWSAPI_KEY

async function crawlDocs() {
    try {
        console.log(`Fetching articles from NewsAPI...`);
        
        // 1. Fetch data from NewsAPI
        const { data } = await axios.get(START_URL);
        const articles = data.articles;

        if (!articles || articles.length === 0) {
            console.log("No articles found matching the query.");
            return;
        }

        console.log(`Found ${articles.length} articles. Writing to ${OUTPUT_FILE}...\n`);

        // 2. Clear or create the output file
        fs.writeFileSync(OUTPUT_FILE, '');

        // 3. Process each article directly from the JSON payload
        for (let i = 0; i < articles.length; i++) {
            const article = articles[i];
            console.log(`[${i + 1}/${articles.length}] Saving: ${article.title}`);

            const cleanText = article.description || article.content || '';

            // Construct the JSON structure matching your expected layout
            const docChunk = {
                title: article.title || 'Untitled Article',
                headings: [], // NewsAPI JSON doesn't separate markdown subheadings
                text: cleanText.trim(),
                url: article.url
            };

            // Append line directly to the chunky.jsonl file
            fs.appendFileSync(OUTPUT_FILE, JSON.stringify(docChunk) + '\n');
        }

        console.log(`\n All done! Data safely written to ${OUTPUT_FILE}`);

    } catch (error) {
        console.error(`Fatal error during execution: ${error.message}`);
    }
}

crawlDocs();
*/
