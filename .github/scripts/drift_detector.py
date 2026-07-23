import json
import os
import subprocess
import sys
import time
import random
import urllib.request
import urllib.error

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN")
PR_NUMBER = os.environ.get("PR_NUMBER")
REPOSITORY = os.environ.get("REPOSITORY")


def get_git_diff():
    """Gets the git diff of code files against the base branch."""
    try:
        # Diff against main/master
        cmd = ["git", "diff", "origin/main", "--", "*.py", "*.js", "*.ts", "*.json", "*.sh", "*.yml"]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return result.stdout.strip()
    except Exception as e:
        print(f"Error fetching git diff: {e}")
        return ""


def get_all_docs():
    """Reads all Markdown docs to provide context for drift analysis."""
    docs_data = {}
    for root, _, files in os.walk("docs"):
        for file in files:
            if file.endswith(".md") or file.endswith(".markdown"):
                full_path = os.path.join(root, file)
                try:
                    with open(full_path, "r", encoding="utf-8") as f:
                        docs_data[full_path] = f.read()[:1500]  # Read first 1500 chars per doc
                except Exception:
                    pass
    return docs_data


def call_gemini(prompt_text, max_retries=3):
    """Calls Gemini API using standard library urllib with retry logic."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    headers = {"Content-Type": "application/json"}
    
    payload = {
        "contents": [{"parts": [{"text": prompt_text}]}],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json"
        }
    }

    for attempt in range(max_retries):
        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
        try:
            with urllib.request.urlopen(req) as response:
                res_body = response.read().decode("utf-8")
                res_json = json.loads(res_body)
                return res_json["candidates"][0]["content"]["parts"][0]["text"]
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8")
            error_data = json.loads(error_body)
            error_code = error_data.get("error", {}).get("code")
            
            # Retry on 429 (rate limit) or 503 (service unavailable)
            if error_code in [429, 503] and attempt < max_retries - 1:
                wait_time = (2 ** attempt) + random.uniform(0, 1)
                print(f"API rate limited (code {error_code}). Retrying in {wait_time:.2f}s (attempt {attempt + 1}/{max_retries})...")
                time.sleep(wait_time)
            else:
                print(f"Gemini API Error: {error_body}")
                sys.exit(1)

# ... rest of the file remains the same
