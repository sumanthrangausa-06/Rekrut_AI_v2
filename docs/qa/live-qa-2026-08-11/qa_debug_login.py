from playwright.sync_api import sync_playwright
BASE = "https://rekrutai-staging.onrender.com"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_context(viewport={"width":1440,"height":900}).new_page()
    page.goto(f"{BASE}/login", wait_until="networkidle", timeout=30000)
    page.wait_for_timeout(2000)

    print("=== LOGIN INPUTS ===")
    for inp in page.locator("input").all():
        t = inp.get_attribute("type") or ""
        ph= inp.get_attribute("placeholder") or ""
        i = inp.get_attribute("id") or ""
        print(f"  type={t!r:12} placeholder={ph!r:45} id={i!r}")

    print("\n=== LOGIN BUTTONS ===")
    for btn in page.locator("button").all():
        try:
            txt = btn.inner_text()[:60]
        except Exception:
            txt = ""
        print(f"  type={btn.get_attribute('type')!r} text={txt!r}")

    page.screenshot(path="docs/qa/live-qa-2026-08-11/screenshots/debug-login-form.png", full_page=True)
    browser.close()
    print("login page done")
