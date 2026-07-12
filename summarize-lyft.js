import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';

// Initialize the Gemini SDK (it automatically looks for the GEMINI_API_KEY env variable)
const ai = new GoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY
});
const INPUT_FILE = './lyft-summary.md'; // Your crawled raw data
const SUMMARY_OUTPUT = './ai-summary-lyft.md';

// Helper: split the crawled data into individual articles.
// Heuristics used (in order):
// 1) Split on '\n\n---\n\n' which is a common article separator
// 2) If that yields a single large chunk, split on top-level markdown H1 ('^# ')
// 3) Fallback: split on two or more blank lines
function splitArticles(raw) {
  let parts = raw.split(/\n\n---\n\n/gi).map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1) {
    // try H1 headings
    const matches = raw.split(/(?=^# )/m).map(p => p.trim()).filter(Boolean);
    if (matches.length > 1) {
      parts = matches;
    } else {
      // fallback to double blank line
      parts = raw.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    }
  }
  return parts;
}

// Extract a title (first markdown H1 or first line) from an article
function extractTitle(article) {
  const m = article.match(/^#\s+(.+)$/m);
  if (m) return m[1].trim();
  const firstLine = article.split('\n')[0];
  return firstLine.trim().slice(0, 120) || 'Untitled';
}

// Try to extract a date from the article body using common date patterns
function extractDate(article) {
  // ISO-style dates
  let m = article.match(/(\d{4}-\d{2}-\d{2})/);
  if (m) return new Date(m[1]);
  // Year-month
  m = article.match(/(\d{4})[\/-](\d{2})/);
  if (m) return new Date(`${m[1]}-${m[2]}-01`);
  // Month name day, year
  m = article.match(/(?:\b)(January|February|March|April|May|June|July|August|September|October|November|December)\s+([0-3]?\d),\s*(\d{4})/i);
  if (m) return new Date(`${m[3]} ${m[1]} ${m[2]}`);
  // Year only
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

// Simple Jaccard similarity based on word sets
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

  // exact duplicates
  for (const idxs of exactMap.values()) {
    if (idxs.length > 1) {
      duplicates.push({ type: 'exact', indices: idxs });
    }
  }

  // fuzzy duplicates (pairwise, threshold)
  const seenPairs = new Set();
  const threshold = 0.85; // high threshold for near-duplicates
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

  // Build Markdown table
  const header = '| Year | Articles |\n|---:|---:|';
  const rows = [];
  years.forEach(y => rows.push(`| ${y} | ${counts[y] || 0} |`));
  rows.push(`| Older/Unknown | ${counts['Older/Unknown']} |`);
  return [header, ...rows].join('\n');
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

    // Find duplicates
    const duplicates = findDuplicates(articles);
    if (duplicates.length > 0) {
      console.log(`Found ${duplicates.length} duplicate group(s).`);
    } else {
      console.log('No duplicates found.');
    }

    // Build year table
    const yearTableMd = buildYearTable(articles);

    // Prepare a preface that lists duplicate groups and the year breakdown table
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

    // Combine de-duplicated content for the AI to synthesize.
    // We'll use one canonical article per exact-duplicate group and avoid sending exact duplicates multiple times.
    const canonicalIdx = new Set();
    const exactGroups = duplicates.filter(d => d.type === 'exact');
    for (const g of exactGroups) {
      // pick the first index in the group as canonical
      canonicalIdx.add(g.indices[0]);
    }
    // include all others unless they were exact duplicates (we allow fuzzy pairs to both be included)
    const combinedForAI = articles
      .map((a) => ({ idx: a.index, content: a.content }))
      .filter(a => !exactGroups.some(g => g.indices.slice(1).includes(a.idx)))
      .map(a => a.content)
      .join('\n\n---\n\n');

    console.log('Asking Gemini to synthesize the data into a debate article...');

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

    const response = await ai.getModel('models/gemini-2.5-flash').generateContent({ // Fast and excellent at synthesis tasks
  contents: `Here are the raw crawled source materials:\n\n${combinedForAI}`,
  systemInstruction: systemInstruction,
  generationConfig: {
    temperature: 0.3 // Low temperature keeps it analytical and grounded in your data
  }
});
    // Compose final output file which includes duplicates list, year table, and the AI essay
    const finalMd = `# Synthesized Debate Article (Lyft variant)\n\n${preface}---\n\n${response.text}`;

    fs.writeFileSync(SUMMARY_OUTPUT, finalMd);
    console.log(`✨ Success! Your synthesized debate article with duplicates and year table has been saved to ${SUMMARY_OUTPUT}`);

  } catch (error) {
    console.error(`Error generating summary: ${error.message}`);
  }
}

generateSummaryArticle();
