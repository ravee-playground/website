import { GoogleGenAI } from '@google/genai';
import { Pinecone } from '@pinecone-database/pinecone';

export interface Env {
  GEMINI_API_KEY: string;
  PINECONE_API_KEY: string;
  PINECONE_INDEX_NAME: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://thetechnicalwriter.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // 1. ALWAYS handle OPTIONS preflight FIRST with status 204
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    const url = new URL(request.url);

    // 2. Route Handling with CORS headers attached to ALL status codes
    if (request.method === 'POST' && url.pathname === '/chat') {
      try {
        const body = await request.json().catch(() => ({})) as { question?: string };
        const { question } = body;

        if (!question) {
          return new Response(
            JSON.stringify({ error: 'Missing question parameter' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (!env.GEMINI_API_KEY || !env.PINECONE_API_KEY || !env.PINECONE_INDEX_NAME) {
          return new Response(
            JSON.stringify({ error: 'Missing environment secret bindings on Worker' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Initialize SDKs inside handler
        const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
        const pc = new Pinecone({ apiKey: env.PINECONE_API_KEY });

        // 3. Generate Embedding (Using gemini-embedding-001)
        const embeddingResponse = await ai.models.embedContent({
          model: 'gemini-embedding-001',
          contents: question,
        });

        const queryVector = embeddingResponse.embedding?.values;
        if (!queryVector) {
          return new Response(
            JSON.stringify({ error: 'Failed to generate embedding vector' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // 4. Query Vector DB
        const index = pc.Index(env.PINECONE_INDEX_NAME);
        const queryResponse = await index.query({
          vector: queryVector,
          topK: 3,
          includeMetadata: true,
        });

        const contexts = queryResponse.matches?.map(match => match.metadata?.text || '') || [];
        const sources = queryResponse.matches?.map(match => match.metadata?.source_url || '') || [];
        const contextText = contexts.join('\n\n---\n\n');

        const systemPrompt = `You are a helpful documentation assistant. Answer the user's question accurately using only the provided context blocks extracted from the documentation. If you do not know the answer or if it's not in the context, say "I cannot find that in the documentation." Do not hallucinate.

Context:
${contextText}`;

        // 5. Generate Answer (System instruction moved to config block)
        const aiResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: question,
          config: {
            systemInstruction: systemPrompt,
          },
        });

        return new Response(
          JSON.stringify({
            answer: aiResponse.text,
            sources: [...new Set(sources)].filter(Boolean),
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      } catch (error: any) {
        console.error("Worker Execution Error (/chat):", error);
        return new Response(
          JSON.stringify({ error: error?.message || String(error) }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // 3. Email Support Route
    if (request.method === 'POST' && url.pathname === '/email-support') {
      return new Response(
        JSON.stringify({ success: true, message: "Support ticket endpoint reached." }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Fallback 404 (Includes CORS headers)
    return new Response(
      JSON.stringify({ error: `Path '${url.pathname}' not found` }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  },
};
