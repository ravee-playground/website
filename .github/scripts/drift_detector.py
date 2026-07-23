import json
import os
import subprocess
import sys
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


def call_gemini(prompt_text):
    """Calls Gemini API using standard library urllib."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    headers = {"Content-Type": "application/json"}
    
    payload = {
        "contents": [{"parts": [{"text": prompt_text}]}],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json"
        }
    }

    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
    try:
        with urllib.request.urlopen(req) as response:
            res_body = response.read().decode("utf-8")
            res_json = json.loads(res_body)
            return res_json["candidates"][0]["content"]["parts"][0]["text"]
    except urllib.error.HTTPError as e:
        print(f"Gemini API Error: {e.read().decode('utf-8')}")
        sys.exit(1)


def analyze_drift(code_diff, docs_context):
    """Sends code diff and docs context to Gemini to check for semantic drift."""
    prompt = f"""
    You are an expert Systems Architect & Technical Documentation Auditor.
    
    Analyze the following code changes (Git Diff) against the existing documentation files.
    Determine if any documentation pages are now OUTDATED, INACCURATE, or MISSING updates due to these code changes.

    Code Git Diff:
    ```diff
    {code_diff[:4000]}
    ```

    Existing Documentation Files & Content Summaries:
    {json.dumps(docs_context, indent=2)}

    Return a JSON response with this exact structure:
    {{
      "drift_detected": <true|false>,
      "risk_level": "<NONE|LOW|MEDIUM|HIGH>",
      "affected_docs": [
        {{
          "doc_path": "<path_to_affected_md_file>",
          "reason": "<explanation of why this doc is now stale or missing updates>",
          "suggested_update": "<concrete suggestion of what needs to be changed in the doc>"
        }}
      ],
      "summary": "<a 1-2 sentence overview of code-to-doc parity>"
    }}
    """
    raw_response = call_gemini(prompt)
    return json.loads(raw_response)


def post_github_comment(drift_analysis):
    """Posts drift alert back to the PR."""
    if not GITHUB_TOKEN or not PR_NUMBER or not REPOSITORY:
        print("Missing GitHub environment variables. Skipping comment.")
        return

    if not drift_analysis.get("drift_detected"):
        comment_body = "### 🟢 Code-to-Doc Drift Check: PASSED\nNo documentation drift detected for recent code changes."
    else:
        risk = drift_analysis.get("risk_level", "MEDIUM")
        badge = "⚠️ **MEDIUM DRIFT RISK**" if risk == "MEDIUM" else "🚨 **HIGH DRIFT RISK**"
        
        comment_body = f"### {badge}\n\n"
        comment_body += f"**Summary:** {drift_analysis.get('summary')}\n\n"
        comment_body += "#### Outdated Documentation Pages Detected:\n\n"
        
        for item in drift_analysis.get("affected_docs", []):
            comment_body += f"* **Doc:** `{item['doc_path']}`\n"
            comment_body += f"  * **Reason:** {item['reason']}\n"
            comment_body += f"  * **Suggested Fix:** {item['suggested_update']}\n\n"

        comment_body += "*Please update the affected documentation files before merging.*"

    url = f"https://api.github.com/repos/{REPOSITORY}/issues/{PR_NUMBER}/comments"
    headers = {
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28"
    }

    req = urllib.request.Request(url, data=json.dumps({"body": comment_body}).encode("utf-8"), headers=headers)
    try:
        with urllib.request.urlopen(req):
            print("Successfully posted drift comment to PR.")
    except urllib.error.HTTPError as e:
        print(f"Failed to post drift comment: {e.read().decode('utf-8')}")


def main():
    diff = get_git_diff()
    if not diff:
        print("No code changes detected in diff. Skipping drift check.")
        sys.exit(0)

    print("Code changes detected. Reading docs context...")
    docs_context = get_all_docs()
    
    print("Running Gemini Code-to-Doc Drift Evaluation...")
    drift_res = analyze_drift(diff, docs_context)
    
    post_github_comment(drift_res)


if __name__ == "__main__":
    main()
