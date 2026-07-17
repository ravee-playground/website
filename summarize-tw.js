import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

// Initialize the Gemini SDK (it automatically looks for the GEMINI_API_KEY env variable)
const ai = new GoogleGenAI({});
const INPUT_FILE = './chunky.md'; // Your crawled raw data
const SUMMARY_OUTPUT = './ai-tw-summary.md';

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
            Act as an expert Content Strategist and Industry Analyst.
            I need you to synthesize the latest trends and perspectives to evaluate the impact of AI on content creation, specifically focusing on blogs, technical writing, and marketing copy.
            Please provide a comprehensive analysis that includes the following sections:
            
            ##Executive Summary: 
            A brief overview of how AI tools are currently altering the content writing landscape.
            
            ##The Shift in Workflow: 
            How AI is being used for ideation, outlining, drafting, and editing.
            
            ##Quality vs. Volume: 
            A synthesis of how the balance between human authenticity and AI efficiency affects search visibility and audience engagement.
            
            ##The Technical Writing Evolution: 
            Specific ways AI is impacting technical documentation (e.g., standardizing content, ensuring compliance, freeing up time for complex tasks).
            
            ##Future Outlook: 
            Emerging challenges, such as maintaining originality and ethical considerations.
            
            ##Formatting Requirements:
            Use clear headings, bullet points for readability, and cite specific real-world examples or industry benchmarks where applicable. 
            
            Keep the tone professional, objective, and analytical.
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
