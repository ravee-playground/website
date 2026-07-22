import { GoogleGenAI } from '@google/genai';
import { Pinecone } from '@pinecone-database/pinecone';

export interface Env {
  GEMINI_API_KEY: string;
  PINECONE_API_KEY: string;
  PINECONE_INDEX_NAME: string;
  PINECONE_INDEX: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://thetechnicalwriter.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // 1. Handle OPTIONS preflight FIRST with standard CORS headers
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    try {
      const url = new URL(request.url);

      // 2. Chat Endpoint
      if (request.method === 'POST' && url.pathname === '/chat') {
        const body = (await request.json().catch(() => ({}))) as { question?: string };
        const { question } = body;

        if (!question) {
          return new Response(
            JSON.stringify({ error: 'Missing question parameter' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Support both PINECONE_INDEX and PINECONE_INDEX_NAME from wrangler config
        const indexName = env.PINECONE_INDEX_NAME || env.PINECONE_INDEX;

        if (!env.GEMINI_API_KEY || !env.PINECONE_API_KEY || !indexName) {
          const missing = [];
          if (!env.GEMINI_API_KEY) missing.push('GEMINI_API_KEY');
          if (!env.PINECONE_API_KEY) missing.push('PINECONE_API_KEY');
          if (!indexName) missing.push('PINECONE_INDEX_NAME / PINECONE_INDEX');

          return new Response(
            JSON.stringify({ error: `Missing environment secret bindings: ${missing.join(', ')}` }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Initialize SDKs
        const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
        const pc = new Pinecone({ apiKey: env.PINECONE_API_KEY });

        // 3. Generate Embedding
        const embeddingResponse = await ai.models.embedContent({
          model: 'text-embedding-004',
          contents: question,
        });

        const vector =
          embeddingResponse.embedding?.values ||
          (embeddingResponse as any).embeddings?.[0]?.values;

        if (!vector || vector.length === 0) {
          throw new Error('Failed to extract vector values from Gemini embedding response.');
        }

        // 4. Query Vector DB
        const index = pc.index(indexName);
        const queryResponse = await index.query({
          vector: vector, // Fixed: was previously queryVector
          topK: 3,
          includeMetadata: true,
        });

        const contexts =
          queryResponse.matches
            ?.map((match) => (match.metadata?.text as string) || '')
            .filter(Boolean) || [];

        const sources =
          queryResponse.matches
            ?.map((match) => (match.metadata?.source_url as string) || '')
            .filter(Boolean) || [];

        const contextText = contexts.join('\n\n---\n\n');

        const systemPrompt = `You are a helpful documentation assistant. Answer the user's question accurately using only the provided context blocks extracted from the documentation. If you do not know the answer or if it's not in the context, say "I cannot find that in the documentation." Do not hallucinate.

Context:
${contextText}`;

        // 5. Generate Answer
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
      }

      // 3. Email Support Route
      if (request.method === 'POST' && url.pathname === '/email-support') {
        return new Response(
          JSON.stringify({ success: true, message: 'Support ticket endpoint reached.' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 4. Fallback 404
      return new Response(
        JSON.stringify({ error: `Path '${url.pathname}' not found` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (err: any) {
      // Global error handler — guarantees valid CORS headers on 500 errors
      console.error('Worker Execution Error:', err?.stack || err?.message || err);

      return new Response(
        JSON.stringify({
          error: 'Internal Worker Error',
          message: err?.message || String(err),
          stack: err?.stack || null,
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }
  },
};
