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
