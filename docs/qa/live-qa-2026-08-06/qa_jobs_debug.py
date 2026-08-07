import json
from playwright.sync_api import sync_playwright

BASE = "https://rekrutai.co"
OUT_DIR = "docs/qa/live-qa-2026-08-06/screenshots"
EMAIL = "qa.candidate.1786083173@gmail.com"
PASSWORD = "QaTest123!Pass"

api_calls = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()

    def on_response(resp):
        if "/api/" in resp.url and ("job" in resp.url.lower() or "search" in resp.url.lower()):
            try:
                body = resp.text()
            except Exception:
                body = "<unreadable>"
            api_calls.append({"url": resp.url, "status": resp.status, "method": resp.request.method, "body": body[:1000]})

    page.on("response", on_response)

    page.goto(f"{BASE}/login", wait_until="networkidle", timeout=25000)
    page.fill('input[placeholder="example.email@gmail.com"]', EMAIL)
    page.fill('input[placeholder="Enter at least 8+ characters"]', PASSWORD)
    page.click('button:has-text("Sign in")')
    page.wait_for_timeout(3000)

    page.goto(f"{BASE}/candidate/jobs", wait_until="domcontentloaded", timeout=20000)
    # Wait longer this time - up to 15s - to see if spinner resolves
    page.wait_for_timeout(15000)
    page.screenshot(path=f"{OUT_DIR}/jobs-debug-after-15s.png", full_page=True)

    print(f"\n--- Job-related API calls ({len(api_calls)}) ---")
    for call in api_calls:
        print(json.dumps(call, indent=2)[:1200])
        print("---")

    with open("docs/qa/live-qa-2026-08-06/jobs-debug-api-log.json", "w", encoding="utf-8") as f:
        json.dump(api_calls, f, indent=2)

    browser.close()
