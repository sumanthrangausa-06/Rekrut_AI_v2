from playwright.sync_api import sync_playwright

BASE = "https://rekrutai.co"
OUT_DIR = "docs/qa/live-qa-2026-08-06/screenshots"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 375, "height": 812})
    page = context.new_page()

    for name, path in [("home", "/"), ("pricing", "/pricing"), ("login", "/login"), ("register", "/register")]:
        page.goto(f"{BASE}{path}", wait_until="networkidle", timeout=25000)
        page.wait_for_timeout(1000)
        page.screenshot(path=f"{OUT_DIR}/mobile-{name}.png", full_page=True)
        print(f"Captured mobile-{name}.png")

    browser.close()
