import json
from playwright.sync_api import sync_playwright

BASE = "https://rekrutai.co"
OUT_DIR = "docs/qa/live-qa-2026-08-06/screenshots"
EMAIL = "qa.recruiter.1786085084@gmail.com"
PASSWORD = "QaTest123!Pass"

log = []
def record(step, ok, detail=""):
    log.append({"step": step, "ok": ok, "detail": detail})
    print(f"[{'OK' if ok else 'FAIL'}] {step} — {detail}")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    console_errors = []
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    page.goto(f"{BASE}/login", wait_until="networkidle", timeout=25000)
    page.fill('input[placeholder="example.email@gmail.com"]', EMAIL)
    page.fill('input[placeholder="Enter at least 8+ characters"]', PASSWORD)
    page.click('button:has-text("Sign in")')
    page.wait_for_timeout(8000)
    record("Login", "recruiter" in page.url, page.url)

    for name, path in [("jobs", "/recruiter/jobs"), ("candidates", "/recruiter/candidates"),
                        ("analytics", "/recruiter/analytics"), ("create-job", "/recruiter/jobs/create")]:
        try:
            page.goto(f"{BASE}{path}", wait_until="domcontentloaded", timeout=20000)
            page.wait_for_timeout(4000)
            page.screenshot(path=f"{OUT_DIR}/recruiter3-{name}.png", full_page=True)
            body = page.inner_text("body").strip()
            record(f"Page: {name}", len(body) > 20, f"url={page.url} body_len={len(body)}")
        except Exception as e:
            record(f"Page: {name}", False, str(e))

    record("Console errors", len(console_errors) == 0, f"{len(console_errors)}: {console_errors[:10]}")
    browser.close()

with open("docs/qa/live-qa-2026-08-06/recruiter-flow3-results.json", "w", encoding="utf-8") as f:
    json.dump(log, f, indent=2)
