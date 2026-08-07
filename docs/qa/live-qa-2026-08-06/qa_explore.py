import sys
import json
from playwright.sync_api import sync_playwright

BASE = "https://rekrutai.co"
OUT_DIR = "docs/qa/live-qa-2026-08-06/screenshots"

PAGES = [
    ("home", "/"),
    ("pricing", "/pricing"),
    ("about", "/about"),
    ("contact", "/contact"),
    ("blog", "/blog"),
    ("terms", "/terms"),
    ("privacy", "/privacy"),
    ("login", "/login"),
    ("register", "/register"),
    ("forgot-password", "/forgot-password"),
    ("recruiter-register", "/recruiter-register"),
    ("admin-login", "/admin-login"),
    ("nonexistent", "/this-page-does-not-exist-12345"),
]

results = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()

    for name, path in PAGES:
        url = BASE + path
        console_errors = []
        failed_requests = []

        def on_console(msg):
            if msg.type == "error":
                console_errors.append(msg.text)

        def on_response(resp):
            if resp.status >= 400:
                failed_requests.append(f"{resp.status} {resp.url}")

        page.on("console", on_console)
        page.on("response", on_response)

        entry = {"name": name, "url": url}
        try:
            resp = page.goto(url, wait_until="networkidle", timeout=25000)
            page.wait_for_timeout(1200)
            entry["status"] = resp.status if resp else None
            entry["title"] = page.title()
            body_text = page.inner_text("body")
            entry["body_len"] = len(body_text.strip())
            entry["body_preview"] = body_text.strip()[:200].replace("\n", " ")
            page.screenshot(path=f"{OUT_DIR}/{name}.png", full_page=True)
        except Exception as e:
            entry["error"] = str(e)

        entry["console_errors"] = console_errors
        entry["failed_requests"] = failed_requests

        page.remove_listener("console", on_console)
        page.remove_listener("response", on_response)

        results.append(entry)
        print(f"Tested {name}: status={entry.get('status')} body_len={entry.get('body_len')} errors={len(console_errors)} failed_reqs={len(failed_requests)}")

    browser.close()

with open("docs/qa/live-qa-2026-08-06/public-pages-results.json", "w", encoding="utf-8") as f:
    json.dump(results, f, indent=2)

print("\nDone. Results saved to public-pages-results.json")
