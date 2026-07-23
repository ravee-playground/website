import json
import os
import sys
import time
import random
import urllib.request
import urllib.error
from datetime import datetime

# Environment Variables injected by GitHub Action
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN")
PR_NUMBER = os.environ.get("PR_NUMBER")
REPOSITORY = os.environ.get("REPOSITORY")
CHANGED_FILES = os.environ.get("CHANGED_FILES", "").split()


def call_gemini(prompt_text, max_retries=3):
    """Calls Gemini API using standard library urllib with retry logic."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    headers = {"Content-Type": "application/json"}
    
    payload = {
        "contents": [{
            "parts": [{"text": prompt_text}]
        }],
        "generationConfig": {
            "temperature": 0.2,
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

req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
    try:
        with urllib.request.urlopen(req) as response:
            res_body = response.read().decode("utf-8")
            res_json = json.loads(res_body)
            return res_json["candidates"][0]["content"]["parts"][0]["text"]
    except urllib.error.HTTPError as e:
        print(f"Gemini API Error: {e.read().decode('utf-8')}")
        sys.exit(1)


def evaluate_file(file_path):
    """Reads file content and requests Gemini review."""
    if not os.path.exists(file_path):
        return None

    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()

    system_prompt = f"""
    You are an expert Technical Documentation Manager and Style Guardrail Judge.
    Evaluate the following Markdown file according to these strict rules:
    1. Tone & Voice: Active voice, direct second-person address ("you"), concise technical prose.
    2. Formatting & Structure: Clear hierarchy (H1, H2, H3), proper use of code blocks, and callouts (`> [!NOTE]`).
    3. Completeness: Ensure prerequisites, step-by-step procedures, or code snippets are included where applicable.

    Return a JSON response with this exact structure:
    {{
      "filename": "{file_path}",
      "overall_score": <int 1-10>,
      "status": "<PASS|NEEDS_IMPROVEMENT>",
      "key_critiques": ["<list of 2-4 actionable improvements>"],
      "strengths": ["<list of 1-2 notable positive aspects>"]
    }}

    Markdown content to review:
    ---
    {content}
    ---
    """
    
    raw_response = call_gemini(system_prompt)
    return json.loads(raw_response)


def post_github_comment(review_results):
    """Posts the compiled evaluation summary back to the GitHub PR."""
    if not GITHUB_TOKEN or not PR_NUMBER or not REPOSITORY:
        print("Missing GitHub context environment variables. Skipping comment posting.")
        return

    comment_body = "### 🛠️ Automated Doc Quality Guardrails Review\n\n"
    
    for review in review_results:
        badge = "🟢 **PASS**" if review["status"] == "PASS" else "⚠️ **NEEDS IMPROVEMENT**"
        comment_body += f"#### File: `{review['filename']}` — Score: `{review['overall_score']}/10` ({badge})\n\n"
        
        if review["strengths"]:
            comment_body += "**What works well:**\n"
            for s in review["strengths"]:
                comment_body += f"* {s}\n"
            comment_body += "\n"

        if review["key_critiques"]:
            comment_body += "**Recommended Refinements:**\n"
            for c in review["key_critiques"]:
                comment_body += f"* {c}\n"
            comment_body += "\n"
        
        comment_body += "---\n"

    comment_body += "\n*Powered by Gemini Docs-as-Code Quality Engine*"

    url = f"https://api.github.com/repos/{REPOSITORY}/issues/{PR_NUMBER}/comments"
    headers = {
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28"
    }

    req = urllib.request.Request(url, data=json.dumps({"body": comment_body}).encode("utf-8"), headers=headers)
    try:
        with urllib.request.urlopen(req) as response:
            print("Successfully posted review comment to PR.")
    except urllib.error.HTTPError as e:
        print(f"Failed to post comment to GitHub: {e.read().decode('utf-8')}")


def generate_audit_report(results, report_path="docs/reports/QUALITY_REPORT.md"):
    """Generates a markdown audit ledger for all site documentation."""
os.makedirs(os.path.dirname(report_path), exist_ok=True)
    
    total_docs = len(results)
    avg_score = round(sum(r["overall_score"] for r in results) / total_docs, 1) if total_docs > 0 else 0
    passed_docs = sum(1 for r in results if r["status"] == "PASS")
    
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    
    report_content = f"""# 📊 Documentation Quality Audit Ledger

> **Last Updated:** `{now}`  
> **Average Site Quality Score:** `{avg_score}/10`  
> **Compliance Rate:** `{passed_docs}/{total_docs}` pages passing

---

## Executive Summary

This report is automatically compiled by the **Gemini Docs-as-Code Quality Engine** upon every deployment to `main`. It evaluates site documentation against strict clarity, active voice, structural completeness, and code accuracy criteria.

---

## Detailed Page Scores

| Document | Score | Status | Key Refinement Areas |
|---|---|---|---|
"""
    for r in results:
        status_icon = "🟢 PASS" if r["status"] == "PASS" else "⚠️ NEEDS WORK"
        critiques = "<br>".join(f"• {c}" for c in r.get("key_critiques", [])) if r.get("key_critiques") else "None"
        report_content += f"| `{r['filename']}` | **{r['overall_score']}/10** | {status_icon} | {critiques} |\n"

    report_content += "\n---\n*Automated Governance Report generated via GitHub Actions*"

    with open(report_path, "w", encoding="utf-8") as f:
        f.write(report_content)
    
    print(f"Audit report saved to {report_path}")


def main():
    md_files = [f for f in CHANGED_FILES if f.endswith(".md") or f.endswith(".markdown")]
    
    if not md_files:
        print("No Markdown files changed in this PR. Exiting.")
        sys.exit(0)

    print(f"Evaluating changed Markdown files: {md_files}")
    results = []
    
    for file_path in md_files:
        print(f"Running LLM evaluation on {file_path}...")
        res = evaluate_file(file_path)
        if res:
            results.append(res)

    if results:
        post_github_comment(results)


if __name__ == "__main__":
    main()
