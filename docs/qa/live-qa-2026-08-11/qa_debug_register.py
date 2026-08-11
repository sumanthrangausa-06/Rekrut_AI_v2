from playwright.sync_api import sync_playwright
BASE = "https://rekrutai-staging.onrender.com"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_context(viewport={"width":1440,"height":900}).new_page()
    page.goto(f"{BASE}/register", wait_until="networkidle", timeout=30000)
    page.wait_for_timeout(2000)

    print("=== INPUTS ===")
    for inp in page.locator("input").all():
        t = inp.get_attribute("type") or ""
        n = inp.get_attribute("name") or ""
        ph= inp.get_attribute("placeholder") or ""
        i = inp.get_attribute("id") or ""
        print(f"  type={t!r:12} name={n!r:20} placeholder={ph!r:40} id={i!r}")

    print("\n=== BUTTONS ===")
    for btn in page.locator("button").all():
        try:
            txt = btn.inner_text()[:60]
        except Exception:
            txt = ""
        print(f"  type={btn.get_attribute('type')!r} text={txt!r}")

    print("\n=== ROLE / TABS ===")
    for sel in ["[role='tab']","[data-value]","input[type='radio']","select","[class*='role']"]:
        items = page.locator(sel).all()
        for item in items:
            try:
                print(f"  sel={sel!r:20} val={item.get_attribute('value')!r} text={item.inner_text()[:40]!r}")
            except Exception:
                pass

    page.screenshot(path="docs/qa/live-qa-2026-08-11/screenshots/debug-register-form.png", full_page=True)
    browser.close()
    print("screenshot saved")
