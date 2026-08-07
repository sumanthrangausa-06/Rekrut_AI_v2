import time
from playwright.sync_api import sync_playwright

BASE = "https://rekrutai.co"
EMAIL = "qa.candidate.1786083173@gmail.com"
PASSWORD = "QaTest123!Pass"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()

    page.goto(f"{BASE}/login", wait_until="networkidle", timeout=25000)
    page.fill('input[placeholder="example.email@gmail.com"]', EMAIL)
    page.fill('input[placeholder="Enter at least 8+ characters"]', PASSWORD)

    t0 = time.time()
    page.click('button:has-text("Sign in")')
    prev_url = page.url
    for i in range(40):
        page.wait_for_timeout(250)
        cur_url = page.url
        if cur_url != prev_url:
            elapsed = time.time() - t0
            print(f"URL changed at t={elapsed:.2f}s: {prev_url} -> {cur_url}")
            prev_url = cur_url
        if "/login" not in cur_url:
            elapsed = time.time() - t0
            print(f"Reached non-login URL at t={elapsed:.2f}s: {cur_url}")
            break
    else:
        print(f"STILL ON LOGIN after {time.time()-t0:.2f}s: {page.url}")

    browser.close()
