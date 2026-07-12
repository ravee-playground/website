import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const INPUT_FILE = './lyft-summary.md'; 
const SUMMARY_OUTPUT = './ai-summary-lyft.md';

function splitArticles(raw) {
  let parts = raw.split(/\n\n---\n\n/gi).map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1) {
    const matches = raw.split(/(?=^# )/m).map(p => p.trim()).filter(Boolean);
    if (matches.length > 1) {
      parts = matches;
    } else {
      parts = raw.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    }
  }
  return parts;
}

function extractTitle(article) {
  const m = article.match(/^#\s+(.+)$/m);
  if (m) return m[1].trim();
  const firstLine = article.split('\n')[0];
  return firstLine.trim().slice(0, 120) || 'Untitled';
}

function extractDate(article) {
  let m = article.match(/(\d{4}-\d{2}-\d{2})/);
  if (m) return new Date(m[1]);
  m = article.match(/(\d{4})[\/-](\d{2})/);
  if (m) return new Date(`${m[1]}-${m[2]}-01`);
  m = article.match(/(?:\b)(January|February|March|April|May|June|July|August|September|October|November|December)\s+([0-3]?\d),\s*(\d{4})/i);
  if (m) return new Date(`${m[3]} ${m[1]} ${m[2]}`);
  m = article.match(/\b(20\d{2}|19\d{2})\b/);
  if (m) return new Date(`${m[1]}-01-01`);
  return null;
}

function normalizeText(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function jaccard(a, b) {
  const as = new Set(normalizeText(a).split(' ').filter(Boolean));
  const bs = new Set(normalizeText(b).split(' ').filter(Boolean));
  if (as.size === 0 || bs.size === 0) return 0;
  let inter = 0;
  for (const x of as) if (bs.has(x)) inter++;
  const uni = new Set([...as, ...bs]).size;
  return inter / uni;
}

function findDuplicates(articles) {
  const exactMap = new Map();
  const duplicates = [];

  articles.forEach((a, idx) => {
    const key = normalizeText(a.content);
    if (exactMap.has(key)) {
      exactMap.get(key).push(idx);
    } else {
      exactMap.set(key, [idx]);
    }
  });

  for (const idxs of exactMap.values()) {
    if (idxs.length > 1) {
      duplicates.push({ type: 'exact', indices: idxs });
    }
  }

  const seenPairs = new Set();
  const threshold = 0.85; 
  for (let i = 0; i < articles.length; i++) {
    for (let j = i + 1; j < articles.length; j++) {
      const key = `${i}-${j}`;
      if (seenPairs.has(key)) continue;
      const sim = jaccard(articles[i].content, articles[j].content);
      if (sim >= threshold) {
        duplicates.push({ type: 'fuzzy', indices: [i, j], similarity: sim });
      }
      seenPairs.add(key);
    }
  }

  return duplicates;
}

function buildYearTable(articles) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const years = [];
  for (let i = 0; i < 10; i++) years.push(currentYear - i);
  const counts = {};
  years.forEach(y => (counts[y] = 0));
  counts['Older/Unknown'] = 0;

  articles.forEach(a => {
    if (!a.date) {
      counts['Older/Unknown']++;
      return;
    }
    const y = a.date.getFullYear();
    if (years.includes(y)) counts[y]++;
    else counts['Older/Unknown']++;
  });

  const header = '| Year | Articles |\n|---:|---:|';
  const rows = [];
  years.forEach(y => rows.push(`| ${y} | ${counts[y] || 0} |`));
  rows.push(`| Older/Unknown | ${counts['Older/Unknown']} |`);
  return [header, ...rows].join('\n');
}

// FIX: Added 503 and 500 server errors to the auto-retry backoff cycle
async function safeGenerateContent(model, promptText) {
  let attempts = 0;
  while (attempts < 5) {
    try {
      const result = await model.generateContent(promptText);
      return result.response.text();
    } catch (apiError) {
      const errorMsg = apiError.message || '';
      
      // Catch 429 (Rate limit), 503 (Overloaded), and 500 (Internal Error)
      const isRetryable = errorMsg.includes('429') || 
                          errorMsg.includes('503') || 
                          errorMsg.includes('500') || 
                          errorMsg.includes('quota') ||
                          errorMsg.includes('demand');

      if (isRetryable && attempts < 4) {
        attempts++;
        // Escalating delay: 15s, 30s, 45s, 60s
        const backoffTime = attempts * 15000;
        console.warn(`⚠️ API Overloaded or Limited (${errorMsg.slice(0, 50)}...). Sleeping for ${backoffTime / 1000}s before retrying (Attempt ${attempts}/5)...`);
        await new Promise(r => setTimeout(r, backoffTime));
      } else {
        throw apiError;
      }
    }
  }
}

async function generateSummaryArticle() {
  try {
    console.log(`Reading crawled data from ${INPUT_FILE}...`);
    if (!fs.existsSync(INPUT_FILE)) {
      console.error('No crawled data found to summarize!');
      return;
    }

    const crawledData = fs.readFileSync(INPUT_FILE, 'utf8');
    const rawArticles = splitArticles(crawledData);
    const articles = rawArticles.map((a, idx) => ({
      index: idx,
      title: extractTitle(a),
      content: a,
      date: extractDate(a),
    }));

    console.log(`Parsed ${articles.length} article(s) from the crawled data.`);

    const duplicates = findDuplicates(articles);
    if (duplicates.length > 0) {
      console.log(`Found ${duplicates.length} duplicate group(s).`);
    } else {
      console.log('No duplicates found.');
    }

    const yearTableMd = buildYearTable(articles);

    let preface = `## Duplicate Articles\n\n`;
    if (duplicates.length === 0) {
      preface += 'No duplicate or near-duplicate articles detected.\n\n';
    } else {
      for (const [i, d] of duplicates.entries()) {
        if (d.type === 'exact') {
          const titles = d.indices.map(ix => `(${ix}) ${articles[ix].title}`).join(', ');
          preface += `- Group ${i + 1} — exact duplicates: ${titles}\n`;
        } else {
          const titles = d.indices.map(ix => `(${ix}) ${articles[ix].title}`).join(', ');
          preface += `- Group ${i + 1} — near-duplicates (similarity=${(d.similarity||0).toFixed(2)}): ${titles}\n`;
        }
      }
      preface += '\n';
    }

    preface += `## Articles by Year (last 10 years + Older/Unknown)\n\n${yearTableMd}\n\n`;

    const exactGroups = duplicates.filter(d => d.type === 'exact');
    const uniquelyCleanedArticles = articles
      .filter(a => !exactGroups.some(g => g.indices.slice(1).includes(a.index)))
      .map(a => `Title: ${a.title}\nContent: ${a.content}`);

    console.log(`Splitting ${uniquelyCleanedArticles.length} filtered articles into batches to safely fit within token quotas...`);
    const BATCH_SIZE = 5;
    const batchSummaries = [];

    const chunkingModel = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: 'You are an internal data extraction processor. Summarize the following engineering articles, pulling out key technical tools, team contexts, architectural challenges, and technical skills gaps mentioned. Keep it dense and informational.'
    });

    for (let i = 0; i < uniquelyCleanedArticles.length; i += BATCH_SIZE) {
      const currentBatch = uniquelyCleanedArticles.slice(i, i + BATCH_SIZE);
      console.log(`Processing article batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(uniquelyCleanedArticles.length / BATCH_SIZE)}...`);
      
      const batchPrompt = `Analyze and condense this batch of text:\n\n${currentBatch.join('\n\n---\n\n')}`;
      const miniSummary = await safeGenerateContent(chunkingModel, batchPrompt);
      batchSummaries.push(miniSummary);

      // Add a small delay between batch loops to let the per-minute token quota breathe
      await new Promise(r => setTimeout(r, 2000));
    }

    console.log('Running final reduction step to synthesize report layout formats...');
    const combinedIntermediateText = batchSummaries.join('\n\n=====================\n\n');

    const systemInstruction = `
        You are an expert Technical Developer Educator, Technical Publications Lead, Content Architect, and AI Enablement Architect.
        Your task is to review the provided summary notes and synthesize them into a single, high-quality report.
        
        Act as a Lead Technical Developer Educator. Review the attached text from Lyft’s recent engineering blog posts. Analyze the underlying tech stack shifts, tooling adoptions, and architectural challenges discussed across the teams (e.g., platform, infrastructure, mobile, data).
        ## The top hidden technical skill gaps
        (Identify the top 3–5 hidden technical 'skill gaps' or steep learning curves an incoming software engineer would face trying to contribute to these specific production environments. Group your findings into a structured summary highlighting the core concepts, runtime tools mentioned, and the corresponding training urgency level (High/Medium).)

        Act as a Technical Publications Lead and Content Architect. Analyze the style, technical depth, and structure of these Lyft engineering articles.
        ## Likely operational bottlenecks
        (Based on how complex these topics are (e.g., distributed systems, ML infrastructure), identify the likely operational bottlenecks an engineer faces when trying to translate their code into these public-facing blog posts. Draft a lean, 'Docs-as-Code' template and a 3-step checklist that an L&D partner could give to a Lyft engineer to help them structure a complex technical post in under 30 minutes without sacrificing technical accuracy.)

        ## Which specific engineering teams are shipping the most complex changes?
        (Analyze these Lyft engineering articles and identify the core authors, team names (e.g., Data Platform, Core Infrastructure, Autonomous, Mobile Platforms), and specialized technical Subject Matter Experts (SMEs) driving their high-leverage initiatives. Generate an internal stakeholder mapping report listing)

        ## Which domains are prime candidates for embedding 'AI Productivity Champions' to help scale internal technical enablement?
        (Analyze these Lyft engineering articles and identify the core authors, team names (e.g., Data Platform, Core Infrastructure, Autonomous, Mobile Platforms), and specialized technical Subject Matter Experts (SMEs) driving their high-leverage initiatives. Generate an internal stakeholder mapping report listing)

        Review Lyft's engineering architecture described in these articles. Act as an AI Enablement Architect.
        ## Structuring Systems Context for AI Coding Assistants at Lyft.
        (Design a concrete syllabus outline for a 1-hour internal workshop. The syllabus must explicitly address how a developer working on Lyft's specific service infrastructure can use advanced prompt engineering, metadata schema design, and runtime context to safely accelerate their coding velocity while adhering to strict internal data access governance parameters.)
 
        ## Editorial Conclusion
        (A balanced view looking toward the future)
        
        Do not invent outside facts; rely heavily on synthesizing the themes present in the provided text. Keep it completely unbiased and objective.
    `;

    const finalModel = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash',
      systemInstruction: systemInstruction,
      generationConfig: { temperature: 0.3 }
    });

    const finalOutputText = await safeGenerateContent(finalModel, `Here are the condensed raw technical materials summaries:\n\n${combinedIntermediateText}`);
    const finalMd = `# Synthesized Report (Lyft variant)\n\n${preface}---\n\n${finalOutputText}`;

    fs.writeFileSync(SUMMARY_OUTPUT, finalMd);
    console.log(`✨ Success! Your report with duplicates and year table has been saved to ${SUMMARY_OUTPUT}`);

  } catch (error) {
    console.error(`Error generating summary: ${error.message}`);
    
    // Fallback logic updated to handle 503 limits as well
    if (error.message.includes('429') || error.message.includes('503') || error.message.includes('quota')) {
      console.warn("⚠️ Pipeline warning: Gemini summary skipped due to temporary platform load limits. Writing fallback file.");
      fs.writeFileSync(SUMMARY_OUTPUT, `# Synthesized Report (Lyft variant)\n\n${preface}\n\n> ⚠️ Automated Warning: The detailed AI-generated architecture synthesis is temporarily unavailable because Gemini servers are under high demand. Please check back during the next workflow run cycle.`);
    } else {
      process.exit(1); 
    }
  }
}

generateSummaryArticle();
