import json
import time
from playwright.sync_api import sync_playwright

BASE = "https://rekrutai.co"
OUT_DIR = "docs/qa/live-qa-2026-08-06/screenshots"
EMAIL = "qa.recruiter.reuse@gmail.com"
PASSWORD = "QaTest123!Pass"
NAME = "QA Test Recruiter"
COMPANY = "QA Test Co"

log = []
def record(step, ok, detail=""):
    log.append({"step": step, "ok": ok, "detail": detail})
    print(f"[{'OK' if ok else 'FAIL'}] {step} — {detail}")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()

    # fresh unique email each run
    ts = int(time.time())
    email = f"qa.recruiter.{ts}@gmail.com"

    page.goto(f"{BASE}/recruiter-register", wait_until="networkidle", timeout=25000)
    page.fill('input[placeholder="John Doe"]', NAME)
    page.fill('input[placeholder="example.email@gmail.com"]', email)
    page.fill('input[placeholder="Enter at least 8+ characters"]', PASSWORD)
    page.fill('input[placeholder="Your company"]', COMPANY)
    page.click('button:has-text("Sign up")')

    # Wait generously - up to 20s - for the app to settle after signup
    page.wait_for_timeout(20000)
    record("URL after signup + 20s wait", True, page.url)
    page.screenshot(path=f"{OUT_DIR}/recruiter2-after-signup-20s.png", full_page=True)
    body = page.inner_text("body").strip()
    print("Body snippet:", body[:200])

    if "/login" in page.url:
        try:
            page.wait_for_selector('input[placeholder="example.email@gmail.com"]', timeout=15000)
            page.fill('input[placeholder="example.email@gmail.com"]', email)
            page.fill('input[placeholder="Enter at least 8+ characters"]', PASSWORD)
            page.click('button:has-text("Sign in")')
            page.wait_for_timeout(8000)
            record("Post explicit login", True, page.url)
        except Exception as e:
            record("Post explicit login", False, str(e))

    page.screenshot(path=f"{OUT_DIR}/recruiter2-final.png", full_page=True)
    browser.close()

with open("docs/qa/live-qa-2026-08-06/recruiter-flow2-results.json", "w", encoding="utf-8") as f:
    json.dump({"email": email, "log": log}, f, indent=2)
print(f"\nAccount: {email} / {PASSWORD}")
