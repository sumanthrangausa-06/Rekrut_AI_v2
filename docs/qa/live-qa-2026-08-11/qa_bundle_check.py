"""Quick bundle check for #146 — load authenticated app and measure JS chunks"""
from playwright.sync_api import sync_playwright

BASE = "https://rekrutai-staging.onrender.com"

chunks = []
def on_response(r):
    if ".js" in r.url and "/assets/" in r.url:
        try:
            cl = int(r.headers.get("content-length", 0))
            chunks.append({"name": r.url.split("/")[-1], "bytes": cl})
        except Exception:
            pass

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_context(viewport={"width":1440,"height":900}).new_page()
    page.on("response", on_response)
    # login
    page.goto(f"{BASE}/login", wait_until="domcontentloaded", timeout=25000)
    page.wait_for_timeout(500)
    page.fill("input#email", "qa.cand.1786410000@proton.me")
    page.fill("input#password", "QaStagingCand!2026")
    page.click("button[type='submit']")
    page.wait_for_timeout(3000)
    # navigate a few routes to trigger lazy loading
    for path in ["/candidate", "/candidate/jobs", "/candidate/profile", "/candidate/omniscore"]:
        page.goto(f"{BASE}{path}", wait_until="domcontentloaded", timeout=20000)
        page.wait_for_timeout(2000)
    browser.close()

sorted_chunks = sorted(chunks, key=lambda x: -x["bytes"])
total_kb = sum(c["bytes"] for c in chunks) // 1024
print(f"Total JS loaded: {total_kb}KB across {len(chunks)} chunks")
print(f"Largest chunks:")
for c in sorted_chunks[:8]:
    print(f"  {c['name'][:50]:50} {c['bytes']//1024}KB")

# old baseline was 1.55MB = 1587KB
# after split, main bundle should be much smaller
main_chunk = next((c for c in chunks if c["name"].startswith("index-")), None)
if main_chunk:
    print(f"\nMain bundle (index-*): {main_chunk['bytes']//1024}KB (was ~1550KB before split)")
    ok = main_chunk["bytes"] < 500000
    print(f"#146 PASS: {ok} (main bundle < 500KB)")
else:
    print(f"\nNo index-* chunk found. Total {len(chunks)} chunks, {total_kb}KB total.")
    ok = len(chunks) > 10 and total_kb < 2000
    print(f"#146 PASS (by chunks>10 and total<2MB): {ok}")
