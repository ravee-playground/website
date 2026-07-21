import os
import glob
import re
import time
from google import genai
from google.genai import types
from google.genai.errors import APIError
from pinecone import Pinecone

# 1. Initialize Clients
ai = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
pc = Pinecone(api_key=os.environ["PINECONE_API_KEY"])
index = pc.Index(os.environ["PINECONE_INDEX_NAME"])

def chunk_markdown(file_path):
    """Splits markdown into logical text blocks using headers as natural anchors."""
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Clean out front matter (the metadata blocked out by --- at the top of Jekyll/Hugo files)
    content = re.sub(r'^---.*?---', '', content, flags=re.DOTALL)
    
    # Split content by markdown headers (H1, H2, H3) to preserve semantic groups
    raw_chunks = re.split(r'(?=\n(?:#|##|###) )', content)
    
    clean_chunks = []
    for chunk in raw_chunks:
        text = chunk.strip()
        if len(text) > 100:  # Ignore tiny or empty chunks
            clean_chunks.append(text)
            
    return clean_chunks

def get_embeddings_batched(chunks, batch_size=20, delay_seconds=1.5):
    """
    Sends chunks in batches to Gemini to keep API calls well under rate limits.
    Includes automatic exponential backoff retry for 429/Resource Exhausted errors.
    """
    all_vectors = []
    
    for i in range(0, len(chunks), batch_size):
        batch = chunks[i:i + batch_size]
        retries = 0
        max_retries = 5
        
        while retries <= max_retries:
            try:
                # Batch request: pass the array of strings directly to contents
                response = ai.models.embed_content(
                    model="gemini-embedding-001",
                    contents=batch,
                    config=types.EmbedContentConfig(
                        task_type="RETRIEVAL_DOCUMENT",
                        output_dimensionality=1024
                    )
                )
                
                # Extract vectors from the batched response
                for emb in response.embeddings:
                    all_vectors.append(emb.values)
                    
                # Small throttle to preserve API quota
                time.sleep(delay_seconds)
                break
                
            except APIError as e:
                # Catch 429 Rate Limits gracefully and back off
                if getattr(e, 'code', None) == 429 or "RESOURCE_EXHAUSTED" in str(e):
                    retries += 1
                    wait_time = (2 ** retries) + 5
                    print(f"⚠️ Rate limit hit (429). Retrying batch {i//batch_size + 1} in {wait_time}s (Attempt {retries}/{max_retries})...")
                    time.sleep(wait_time)
                else:
                    raise e
            except Exception as e:
                raise e

    return all_vectors

def main():
    # Force search relative to the repository root directory
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    search_path = os.path.join(repo_root, "docs", "**", "*.md")
    
    md_files = glob.glob(search_path, recursive=True)
    
    print(f"Found {len(md_files)} markdown files to sync.")
    
    for file_path in md_files:
        rel_path = os.path.relpath(file_path, repo_root)
        print(f"Processing: {rel_path}")
        
        chunks = chunk_markdown(file_path)
        if not chunks:
            continue
            
        # 1. Generate embeddings in batched calls (1 API call per batch_size chunks)
        vectors = get_embeddings_batched(chunks, batch_size=20)
        
        # 2. Build Pinecone vector payloads
        upsert_data = []
        url_path = rel_path.replace("docs/", "").replace(".md", ".html")
        escaped_path = rel_path.replace('/', '_').replace('\\', '_')

        for i, (text_chunk, vector) in enumerate(zip(chunks, vectors)):
            chunk_id = f"{escaped_path}_chunk_{i}"
            sanitized_text = text_chunk.replace('\r', '').replace('\n', ' ')
            
            upsert_data.append((
                chunk_id, 
                vector, 
                {
                    "text": sanitized_text, 
                    "source_url": f"https://thetechnicalwriter.com/{url_path.lstrip('/')}"
                }
            ))
            
        # 3. Push batch to Pinecone in safety chunks (max 100 vectors per upsert)
        if upsert_data:
            pinecone_batch_size = 100
            for p_i in range(0, len(upsert_data), pinecone_batch_size):
                p_batch = upsert_data[p_i:p_i + pinecone_batch_size]
                index.upsert(vectors=p_batch)
            
            print(f"Successfully synced {len(upsert_data)} chunks for {rel_path}")

if __name__ == "__main__":
    main()
