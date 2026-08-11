"""Check if clicking Employer role reveals company name field"""
from playwright.sync_api import sync_playwright
BASE = "https://rekrutai-staging.onrender.com"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_context(viewport={"width":1440,"height":900}).new_page()
    page.goto(f"{BASE}/register", wait_until="networkidle", timeout=30000)
    page.wait_for_timeout(1500)

    print("Before clicking Employer:")
    for inp in page.locator("input").all():
        print(f"  {inp.get_attribute('placeholder')!r}")

    # click Employer button
    page.click("button:has-text('Employer')")
    page.wait_for_timeout(800)
    page.screenshot(path="docs/qa/live-qa-2026-08-11/screenshots/debug-register-employer.png", full_page=True)

    print("\nAfter clicking Employer:")
    for inp in page.locator("input").all():
        ph = inp.get_attribute("placeholder") or ""
        t  = inp.get_attribute("type") or ""
        print(f"  type={t!r} placeholder={ph!r}")

    browser.close()
    print("done")
