import { GoogleGenAI } from '@google/genai';
import { Pinecone } from '@pinecone-database/pinecone';

// Define the environment variables the worker expects
export interface Env {
  GEMINI_API_KEY: string;
  PINECONE_API_KEY: string;
  PINECONE_INDEX_NAME: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // 1. Handle CORS Preflight Requests (Crucial for static sites like Jekyll)
    const corsHeaders = {
      'Access-Control-Allow-Origin': 'https://thetechnicalwriter.com', // Replace with your Jekyll domain
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 2. Only allow POST requests to /chat
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/chat') {
      return new Response('Not Found', { status: 404 });
    }

    try {
      const { question } = await request.json() as { question: string };
      if (!question) {
        return new Response('Missing question', { status: 400 });
      }

      // 3. Initialize SDKs inside the fetch handler to use current environment variables
      const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
      const pc = new Pinecone({ apiKey: env.PINECONE_API_KEY });
      const index = pc.Index(env.PINECONE_INDEX_NAME);

      // 4. Convert the User's Question into an Embedding Vector
      const embeddingResponse = await ai.models.embedContent({
        model: 'text-embedding-004',
        contents: question,
      });
      if (!embeddingResponse.embeddings || !embeddingResponse.embeddings[0]?.values) {
        return new Response('Failed to generate embedding', { status: 500 });
      }
      const queryVector: number[] = embeddingResponse.embeddings[0].values as number[];

      // 5. Query Vector Database for Context
      const queryResponse = await index.query({
        vector: queryVector,
        topK: 3,
        includeMetadata: true,
      });

      // Extract the relevant markdown chunks and their source links
      const contexts = queryResponse.matches.map(match => match.metadata?.text || '');
      const sources = queryResponse.matches.map(match => match.metadata?.source_url || '');

      // 6. Generate the Final Answer using Gemini 2.5 Flash
      const contextText = contexts.join('\n\n---\n\n');
      const systemPrompt = `You are a helpful documentation assistant. Answer the user's question accurately using only the provided context blocks extracted from the documentation. If you do not know the answer or if it's not in the context, say "I cannot find that in the documentation." Do not hallucinate.

Context:
${contextText}`;

      const aiResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          { role: 'system', parts: [{ text: systemPrompt }] },
          { role: 'user', parts: [{ text: question }] }
        ]
      });

      // 7. Return Response with Metadata/Citations
      return new Response(
        JSON.stringify({
          answer: aiResponse.text,
          sources: [...new Set(sources)], // deduplicated sources
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );

    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
};

/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 

export default {
	async fetch(request, env, ctx): Promise<Response> {
		return new Response("Hello World!");
	},
} satisfies ExportedHandler<Env>;
 **/
