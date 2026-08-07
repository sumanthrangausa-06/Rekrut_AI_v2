import json
import time
from playwright.sync_api import sync_playwright

BASE = "https://rekrutai.co"
OUT_DIR = "docs/qa/live-qa-2026-08-06/screenshots"
TS = int(time.time())
EMAIL = f"qa.recruiter.{TS}@gmail.com"
PASSWORD = "QaTest123!Pass"
NAME = "QA Test Recruiter"
COMPANY = "QA Test Co"

log = []
def record(step, ok, detail=""):
    log.append({"step": step, "ok": ok, "detail": detail})
    print(f"[{'OK' if ok else 'FAIL'}] {step} — {detail}")

api_calls = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()

    console_errors = []
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    def on_response(resp):
        if "/api/" in resp.url and resp.request.method in ("POST","PUT","PATCH"):
            try:
                body = resp.text()
            except Exception:
                body = "<unreadable>"
            api_calls.append({"url": resp.url, "status": resp.status, "body": body[:300]})
    page.on("response", on_response)

    # Register as recruiter
    page.goto(f"{BASE}/recruiter-register", wait_until="networkidle", timeout=25000)
    page.fill('input[placeholder="John Doe"]', NAME)
    page.fill('input[placeholder="example.email@gmail.com"]', EMAIL)
    page.fill('input[placeholder="Enter at least 8+ characters"]', PASSWORD)
    page.fill('input[placeholder="Your company"]', COMPANY)
    page.screenshot(path=f"{OUT_DIR}/recruiter-01-form-filled.png")
    page.click('button:has-text("Sign up")')
    for _ in range(40):
        page.wait_for_timeout(250)
        if "/register" not in page.url:
            break
    record("Recruiter Signup redirect", True, page.url)
    page.screenshot(path=f"{OUT_DIR}/recruiter-02-after-signup.png", full_page=True)

    # Login if not auto-logged-in
    if "/candidate" not in page.url and "/recruiter" not in page.url:
        page.goto(f"{BASE}/login", wait_until="networkidle", timeout=25000)
        page.fill('input[placeholder="example.email@gmail.com"]', EMAIL)
        page.fill('input[placeholder="Enter at least 8+ characters"]', PASSWORD)
        page.click('button:has-text("Sign in")')
        for _ in range(40):
            page.wait_for_timeout(250)
            if "/login" not in page.url:
                break
        record("Recruiter Login redirect", True, page.url)

    page.wait_for_timeout(2000)
    page.screenshot(path=f"{OUT_DIR}/recruiter-03-dashboard.png", full_page=True)
    record("Recruiter Dashboard landing", "recruiter" in page.url.lower(), page.url)

    pages_to_check = [
        ("jobs", "/recruiter/jobs"),
        ("candidates", "/recruiter/candidates"),
        ("analytics", "/recruiter/analytics"),
        ("create-job", "/recruiter/jobs/create"),
        ("settings", "/recruiter/settings"),
    ]
    for name, path in pages_to_check:
        try:
            page.goto(f"{BASE}{path}", wait_until="domcontentloaded", timeout=20000)
            page.wait_for_timeout(4000)
            url = page.url
            body = page.inner_text("body").strip()
            page.screenshot(path=f"{OUT_DIR}/recruiter-{name}.png", full_page=True)
            record(f"Page: {name}", "/login" not in url and len(body) > 20, f"url={url} body_len={len(body)}")
        except Exception as e:
            record(f"Page: {name}", False, str(e))

    record("Console errors", len(console_errors) == 0, f"{len(console_errors)}: {console_errors[:15]}")
    browser.close()

with open("docs/qa/live-qa-2026-08-06/recruiter-flow-results.json", "w", encoding="utf-8") as f:
    json.dump({"email": EMAIL, "log": log, "state_changing_api_calls": api_calls}, f, indent=2)

print(f"\nRecruiter test account: {EMAIL} / {PASSWORD}")
