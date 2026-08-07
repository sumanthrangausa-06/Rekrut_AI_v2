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
        if "/api/" in resp.url:
            try:
                body = resp.text()
            except Exception:
                body = "<unreadable>"
            api_calls.append({"url": resp.url, "status": resp.status, "body": body[:300]})

    page.on("response", on_response)

    # Login and wait for full redirect
    page.goto(f"{BASE}/login", wait_until="networkidle", timeout=25000)
    page.fill('input[placeholder="example.email@gmail.com"]', EMAIL)
    page.fill('input[placeholder="Enter at least 8+ characters"]', PASSWORD)
    page.click('button:has-text("Sign in")')
    for _ in range(40):
        page.wait_for_timeout(250)
        if "/login" not in page.url:
            break
    print("Post-login URL:", page.url)
    api_calls.clear()

    # Now do a FULL RELOAD directly on jobs page (simulates user refreshing or bookmark)
    page.goto(f"{BASE}/candidate/jobs", wait_until="domcontentloaded", timeout=25000)
    page.wait_for_timeout(10000)  # generous wait
    page.screenshot(path=f"{OUT_DIR}/jobs-debug3-10s.png", full_page=True)
    body = page.inner_text("body")
    print("Body after 10s:", body[:400].replace("\n", " | "))

    print(f"\n--- API calls on jobs page reload ({len(api_calls)}) ---")
    for call in api_calls:
        print(f"{call['status']} {call['url']}  body={call['body'][:150]}")

    with open("docs/qa/live-qa-2026-08-06/jobs-debug3-api-log.json", "w", encoding="utf-8") as f:
        json.dump(api_calls, f, indent=2)

    browser.close()
