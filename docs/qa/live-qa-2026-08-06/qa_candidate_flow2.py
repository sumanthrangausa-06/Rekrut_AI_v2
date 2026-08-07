import json
import time
from playwright.sync_api import sync_playwright

BASE = "https://rekrutai.co"
OUT_DIR = "docs/qa/live-qa-2026-08-06/screenshots"
TS = int(time.time())
EMAIL = f"qa.candidate.{TS}@gmail.com"
PASSWORD = "QaTest123!Pass"
NAME = "QA Test Candidate"

log = []

def record(step, ok, detail=""):
    log.append({"step": step, "ok": ok, "detail": detail})
    print(f"[{'OK' if ok else 'FAIL'}] {step} — {detail}")

api_calls = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()

    def on_response(resp):
        if "/api/" in resp.url and resp.request.method in ("POST", "PUT", "PATCH"):
            try:
                body = resp.text()
            except Exception:
                body = "<unreadable>"
            api_calls.append({"url": resp.url, "status": resp.status, "method": resp.request.method, "body": body[:500]})

    page.on("response", on_response)

    page.goto(f"{BASE}/register", wait_until="networkidle", timeout=25000)
    page.fill('input[placeholder="John Doe"]', NAME)
    page.fill('input[placeholder="example.email@gmail.com"]', EMAIL)
    page.fill('input[placeholder="Enter at least 8+ characters"]', PASSWORD)
    page.click('button:has-text("Sign up")')

    # Wait up to 15s for either navigation away from /register or an error message
    for _ in range(30):
        page.wait_for_timeout(500)
        if "/register" not in page.url:
            break

    page.screenshot(path=f"{OUT_DIR}/candidate2-after-signup.png", full_page=True)
    record("Signup result URL", True, page.url)

    print("\n--- API calls during signup ---")
    for call in api_calls:
        print(json.dumps(call, indent=2)[:800])

    with open("docs/qa/live-qa-2026-08-06/candidate-signup-api-log.json", "w", encoding="utf-8") as f:
        json.dump({"email": EMAIL, "api_calls": api_calls, "final_url": page.url}, f, indent=2)

    browser.close()

print(f"\nTest account: {EMAIL} / {PASSWORD}")
