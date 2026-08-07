import json
import time
from playwright.sync_api import sync_playwright

BASE = "https://rekrutai.co"
OUT_DIR = "docs/qa/live-qa-2026-08-06/screenshots"
TS = int(time.time())
EMAIL = f"qa-candidate-{TS}@rekrutai-qa-test.com"
PASSWORD = "QaTest123!Pass"
NAME = "QA Test Candidate"

log = []

def record(step, ok, detail="", console_errors=None, failed_requests=None):
    log.append({
        "step": step,
        "ok": ok,
        "detail": detail,
        "console_errors": console_errors or [],
        "failed_requests": failed_requests or [],
    })
    print(f"[{'OK' if ok else 'FAIL'}] {step} — {detail}")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()

    console_errors = []
    failed_requests = []
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.on("response", lambda r: failed_requests.append(f"{r.status} {r.url}") if r.status >= 400 else None)

    # 1. Register
    page.goto(f"{BASE}/register", wait_until="networkidle", timeout=25000)
    page.screenshot(path=f"{OUT_DIR}/candidate-01-register-form.png")
    try:
        page.fill('input[placeholder="John Doe"]', NAME)
        page.fill('input[placeholder="example.email@gmail.com"]', EMAIL)
        page.fill('input[placeholder="Enter at least 8+ characters"]', PASSWORD)
        page.screenshot(path=f"{OUT_DIR}/candidate-02-register-filled.png")
        page.click('button:has-text("Sign up")')
        page.wait_for_timeout(3000)
        page.screenshot(path=f"{OUT_DIR}/candidate-03-after-signup.png")
        current_url = page.url
        record("Candidate Signup", "/login" not in current_url and "/register" not in current_url, f"Landed on {current_url}")
    except Exception as e:
        record("Candidate Signup", False, str(e))
        page.screenshot(path=f"{OUT_DIR}/candidate-03-signup-error.png")

    # 2. Dashboard check
    page.wait_for_timeout(2000)
    dash_url = page.url
    record("Candidate Dashboard Landing", "candidate" in dash_url.lower() or "dashboard" in dash_url.lower(), dash_url)
    page.screenshot(path=f"{OUT_DIR}/candidate-04-dashboard.png", full_page=True)

    # 3. Job search
    try:
        page.goto(f"{BASE}/candidate/jobs", wait_until="networkidle", timeout=25000)
        page.wait_for_timeout(2000)
        page.screenshot(path=f"{OUT_DIR}/candidate-05-jobs.png", full_page=True)
        body = page.inner_text("body")
        record("Job Search Page", len(body.strip()) > 50, f"body_len={len(body.strip())}")
    except Exception as e:
        record("Job Search Page", False, str(e))

    # 4. Profile page
    try:
        page.goto(f"{BASE}/candidate/profile", wait_until="networkidle", timeout=25000)
        page.wait_for_timeout(2000)
        page.screenshot(path=f"{OUT_DIR}/candidate-06-profile.png", full_page=True)
        body = page.inner_text("body")
        record("Profile Page", len(body.strip()) > 50, f"body_len={len(body.strip())}")
    except Exception as e:
        record("Profile Page", False, str(e))

    # 5. Applications page
    try:
        page.goto(f"{BASE}/candidate/applications", wait_until="networkidle", timeout=25000)
        page.wait_for_timeout(2000)
        page.screenshot(path=f"{OUT_DIR}/candidate-07-applications.png", full_page=True)
        body = page.inner_text("body")
        record("Applications Page", len(body.strip()) > 30, f"body_len={len(body.strip())}")
    except Exception as e:
        record("Applications Page", False, str(e))

    # 6. Logout and re-login to verify credentials persist
    try:
        page.goto(f"{BASE}/login", wait_until="networkidle", timeout=25000)
        page.fill('input[placeholder="example.email@gmail.com"]', EMAIL)
        page.fill('input[placeholder="Enter at least 8+ characters"]', PASSWORD)
        page.click('button:has-text("Sign in")')
        page.wait_for_timeout(3000)
        page.screenshot(path=f"{OUT_DIR}/candidate-08-relogin.png", full_page=True)
        record("Candidate Re-login", "/login" not in page.url, f"Landed on {page.url}")
    except Exception as e:
        record("Candidate Re-login", False, str(e))

    record("Aggregate console errors", len(console_errors) == 0, f"{len(console_errors)} errors", console_errors[:20])
    record("Aggregate failed requests", len(failed_requests) == 0, f"{len(failed_requests)} failed", failed_requests[:20])

    browser.close()

with open("docs/qa/live-qa-2026-08-06/candidate-flow-results.json", "w", encoding="utf-8") as f:
    json.dump({"test_email": EMAIL, "log": log}, f, indent=2)

print(f"\nTest account: {EMAIL} / {PASSWORD}")
print("Done.")
