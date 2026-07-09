import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

// Initialize the Gemini SDK (it automatically looks for the GEMINI_API_KEY env variable)
const ai = new GoogleGenAI({});
const INPUT_FILE = './chunky.md'; // Your crawled raw data
const SUMMARY_OUTPUT = './ai-debate-summary.md';

async function generateSummaryArticle() {
    try {
        console.log(`Reading crawled data from ${INPUT_FILE}...`);
        if (!fs.existsSync(INPUT_FILE)) {
            console.error("No crawled data found to summarize!");
            return;
        }
        
        const crawledData = fs.readFileSync(INPUT_FILE, 'utf8');

        console.log("Asking Gemini to synthesize the data into a debate article...");
        
        // Define your strict prompt instructions
        const systemInstruction = `
            You are an expert investigative journalist and tech researcher. 
            Your task is to review the provided background source articles and synthesize them into a single, high-quality, comprehensive Markdown essay.
            
            The essay must be structured exactly like this:
            # The Dual-Edged Sword: Assessing AI's Impact on [Target Field]
            
            ## Executive Summary
            (A brief overview of the current landscape based on the data)
            
            ## The Case For: Opportunities and Breakthroughs
            (Analyze the major positive arguments, statistics, or trends found in the sources)
            
            ## The Case Against: Risks, Ethics, and Limitations
            (Analyze the counterarguments, risks, or failures mentioned in the sources)
            
            ## Editorial Conclusion
            (A balanced view looking toward the future)
            
            Do not invent outside facts; rely heavily on synthesizing the themes present in the provided text. Keep it completely unbiased and objective.
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash', // Fast and excellent at synthesis tasks
            contents: `Here are the raw crawled source materials:\n\n${crawledData}`,
            config: {
                systemInstruction: systemInstruction,
                temperature: 0.3 // Low temperature keeps it analytical and grounded in your data
            }
        });

        // Write the beautifully formatted essay out to a separate file
        fs.writeFileSync(SUMMARY_OUTPUT, response.text);
        console.log(`✨ Success! Your synthesized debate article has been saved to ${SUMMARY_OUTPUT}`);

    } catch (error) {
        console.error(`Error generating summary: ${error.message}`);
    }
}

generateSummaryArticle();
