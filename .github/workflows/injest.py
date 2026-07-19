import os
import glob
import re
from google import genai
from google.genai import types
from pinecone import Pinecone

# 1. Initialize Clients
ai = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
pc = Pinecone(api_key=os.environ["PINECONE_API_KEY"])
index = pc.Index(os.environ["PINECONE_INDEX_NAME"])

def chunk_markdown(file_path):
    """Splits markdown into logical text blocks using headers as natural anchors."""
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Clean out front matter (the metadata blocked out by --- at the top of Jekyll files)
    content = re.sub(r'^---.*?---', '', content, flags=re.DOTALL)
    
    # Split content by markdown headers (H1, H2, H3) to preserve semantic groups
    raw_chunks = re.split(r'(?=\n(?:#|##|###) )', content)
    
    clean_chunks = []
    for chunk in raw_chunks:
        text = chunk.strip()
        if len(text) > 100: # Ignore tiny or empty chunks
            clean_chunks.append(text)
            
    return clean_chunks

def main():
    # Target all markdown files in your /docs directory
    search_path = os.path.join("docs", "**", "*.md")
    md_files = glob.glob(search_path, recursive=True)
    
    print(f"Found {len(md_files)} markdown files to sync.")
    
    for file_path in md_files:
        print(f"Processing: {file_path}")
        chunks = chunk_markdown(file_path)
        
        # Build vector payloads
        upsert_data = []
        for i, text_chunk in enumerate(chunks):
            # Create a clean metadata record mapping back to your custom Jekyll URL path
            url_path = file_path.replace("docs/", "").replace(".md", ".html")
            
            # Generate the embedding vector using Gemini's standard text model
            response = ai.models.embed_content(
                model="text-embedding-004",
                contents=text_chunk
            )
            vector = response.embeddings[0].values
            
            # Form unique ID per chunk
            chunk_id = f"{file_path.replace('/', '_')}_chunk_{i}"
            
            upsert_data.append((
                chunk_id, 
                vector, 
                {"text": text_chunk, "source_url": f"https://yourcustomdomain.com/{url_path}"}
            ))
            
        # Push batch to Pinecone Serverless
        if upsert_data:
            index.upsert(vectors=upsert_data)
            print(f"Successfully synced {len(upsert_data)} chunks for {file_path}")

if __name__ == "__main__":
    main()
