import json
from playwright.sync_api import sync_playwright

BASE = "https://rekrutai.co"
OUT_DIR = "docs/qa/live-qa-2026-08-06/screenshots"
EMAIL = "qa.candidate.1786083173@gmail.com"
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
    for _ in range(20):
        page.wait_for_timeout(500)
        if "/login" not in page.url:
            break
    record("Login redirect", "/login" not in page.url, page.url)
    page.screenshot(path=f"{OUT_DIR}/candidate3-01-after-login.png", full_page=True)

    pages_to_check = [
        ("dashboard", "/candidate"),
        ("jobs", "/candidate/jobs"),
        ("profile", "/candidate/profile"),
        ("applications", "/candidate/applications"),
        ("interviews", "/candidate/interviews"),
        ("assessments", "/candidate/assessments"),
        ("omniscore", "/candidate/omniscore"),
        ("settings", "/candidate/settings"),
    ]
    for name, path in pages_to_check:
        try:
            page.goto(f"{BASE}{path}", wait_until="domcontentloaded", timeout=20000)
            page.wait_for_timeout(2500)
            url = page.url
            body = page.inner_text("body").strip()
            page.screenshot(path=f"{OUT_DIR}/candidate3-{name}.png", full_page=True)
            record(f"Page: {name}", "/login" not in url and len(body) > 20, f"url={url} body_len={len(body)}")
        except Exception as e:
            record(f"Page: {name}", False, str(e))

    record("Console errors total", len(console_errors) == 0, f"{len(console_errors)}: {console_errors[:10]}")
    browser.close()

with open("docs/qa/live-qa-2026-08-06/candidate-flow3-results.json", "w", encoding="utf-8") as f:
    json.dump(log, f, indent=2)
