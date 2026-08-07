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
            api_calls.append({"url": resp.url, "status": resp.status, "method": resp.request.method, "body": body[:400]})

    page.on("response", on_response)

    page.goto(f"{BASE}/login", wait_until="networkidle", timeout=25000)
    page.fill('input[placeholder="example.email@gmail.com"]', EMAIL)
    page.fill('input[placeholder="Enter at least 8+ characters"]', PASSWORD)
    page.click('button:has-text("Sign in")')
    page.wait_for_timeout(3000)
    print("After login click, URL:", page.url)
    page.screenshot(path=f"{OUT_DIR}/jobs-debug2-post-login.png", full_page=True)

    # Now click the Job Board nav link instead of full page.goto (SPA client-side nav)
    try:
        page.click('text=Job Board', timeout=5000)
        page.wait_for_timeout(6000)
        print("After clicking Job Board nav, URL:", page.url)
    except Exception as e:
        print("Could not click Job Board nav:", e)

    page.screenshot(path=f"{OUT_DIR}/jobs-debug2-after-nav-click.png", full_page=True)
    body = page.inner_text("body")
    print("Body preview:", body[:300])

    print(f"\n--- All API calls ({len(api_calls)}) ---")
    for call in api_calls:
        print(f"{call['status']} {call['method']} {call['url']}")

    with open("docs/qa/live-qa-2026-08-06/jobs-debug2-api-log.json", "w", encoding="utf-8") as f:
        json.dump(api_calls, f, indent=2)

    browser.close()
