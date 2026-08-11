"""
Quick browser test for:
  #15 — analytics mock data (deployed after earlier screenshots)
  #22 — sidebar reorganization
  #146 — bundle size / code splitting
"""
import json, time
from playwright.sync_api import sync_playwright, Page

BASE = "https://rekrutai-staging.onrender.com"
OUT  = "docs/qa/live-qa-2026-08-11/screenshots"

log = []

def record(issue, label, ok, detail=""):
    entry = {"issue": issue, "label": label, "ok": ok, "detail": detail}
    log.append(entry)
    print(f"  [{'PASS' if ok else 'FAIL'}] #{issue} {label} — {detail[:120]}")

def capture(page, name):
    try: page.screenshot(path=f"{OUT}/{name}.png", full_page=True, timeout=10000)
    except Exception as e: print(f"  [screenshot failed] {e}")

def login(page, email, pw):
    page.goto(f"{BASE}/login", wait_until="domcontentloaded", timeout=25000)
    page.wait_for_timeout(1000)
    page.fill("input#email", email)
    page.fill("input#password", pw)
    page.click("button[type='submit']")
    for _ in range(20):
        page.wait_for_timeout(500)
        if "/login" not in page.url:
            return True
    return False

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()

    # Track bundle requests for #146
    bundle_files = []
    js_bytes_total = 0

    def on_response(r):
        global js_bytes_total
        if ".js" in r.url and "chunk" in r.url.lower() or "index-" in r.url:
            try:
                cl = r.headers.get("content-length", "0")
                bundle_files.append({"url": r.url.split("/")[-1], "bytes": int(cl)})
            except Exception:
                pass

    page.on("response", on_response)

    # Login as employer (known-good QA owner)
    login(page, "qa.owner.1786410000@qarecruit.io", "QaStagingOwner!2026")
    page.wait_for_timeout(2000)
    record(22, "employer login", "/login" not in page.url, f"url={page.url}")

    # ── #15: Analytics page mock data check ──
    page.goto(f"{BASE}/recruiter/analytics", wait_until="domcontentloaded", timeout=25000)
    page.wait_for_timeout(5000)
    capture(page, "r15-analytics-post-fix")
    body = page.inner_text("body")
    # Mock data indicators
    has_hiring_velocity_mock = "jan" in body.lower() and ("12 interviews" in body.lower() or "15 interviews" in body.lower())
    has_trend_badges = any(x in body for x in ["+8.2%", "+12.1%", "-1.3%", "-2.5 days"])
    has_source_mock  = "Direct: 42" in body or "Referral: 28" in body
    mock_found = has_hiring_velocity_mock or has_trend_badges or has_source_mock
    record(15, "Analytics page renders", len(body) > 100, f"body_len={len(body)}")
    record(15, "Analytics has NO mock Hiring Velocity data", not has_hiring_velocity_mock,
           f"mock_velocity={has_hiring_velocity_mock} body_snippet={body[:200]}")
    record(15, "Analytics has NO fake trend badges", not has_trend_badges, f"trend_badges={has_trend_badges}")

    # ── #22: Candidate sidebar reorganization ──
    login(page, "qa.cand.1786410000@proton.me", "QaStagingCand!2026")
    page.wait_for_timeout(2000)
    page.goto(f"{BASE}/candidate", wait_until="domcontentloaded", timeout=25000)
    page.wait_for_timeout(3000)
    capture(page, "r22-candidate-sidebar-post-fix")
    body = page.inner_text("body")
    has_opportunities = "OPPORTUNITIES" in body or "opportunities" in body.lower()
    has_improve       = "IMPROVE YOUR PROFILE" in body or "improve your profile" in body.lower()
    has_new_items     = any(kw in body for kw in ["Top Matches", "Company Matches", "CV Review", "LinkedIn Optimizer", "Career Diagnosis"])
    record(22, "Sidebar has OPPORTUNITIES section", has_opportunities, f"found={has_opportunities}")
    record(22, "Sidebar has IMPROVE YOUR PROFILE section", has_improve, f"found={has_improve}")
    record(22, "Sidebar has NEW nav items (Top Matches, CV Review, etc.)", has_new_items, f"found={has_new_items}")

    # ── #146: Bundle size / code splitting ──
    page.goto(BASE, wait_until="networkidle", timeout=30000)
    page.wait_for_timeout(3000)

    # check chunks via CDP
    js_resources = page.evaluate("""
        () => {
            const entries = performance.getEntriesByType('resource')
                .filter(e => e.initiatorType === 'script' && e.name.includes('.js'));
            return entries.map(e => ({ name: e.name.split('/').pop(), size: e.transferSize || e.encodedBodySize || 0 }));
        }
    """)
    chunk_count = len([r for r in js_resources if "chunk" in r.get("name","").lower() or "index" in r.get("name","").lower()])
    largest_chunk = max((r.get("size", 0) for r in js_resources), default=0)
    total_js_size = sum(r.get("size", 0) for r in js_resources)
    js_chunks = sorted(js_resources, key=lambda x: -x.get("size",0))[:5]

    record(146, "Bundle split into multiple chunks (>5)", chunk_count > 5,
           f"chunk_count={chunk_count} total_js_kb={total_js_size//1024}KB largest_chunk_kb={largest_chunk//1024}KB")
    record(146, "Largest single chunk < 500KB (split working)", largest_chunk < 500000,
           f"largest_chunk={largest_chunk//1024}KB top5={[(c['name'][:30], c['size']//1024) for c in js_chunks]}")

    browser.close()

with open("docs/qa/live-qa-2026-08-11/qa_browser_verification.json", "w") as f:
    json.dump({"log": log, "js_chunks": js_resources[:20]}, f, indent=2)

print("\n=== Browser verification done ===")
fails = [r for r in log if not r["ok"]]
print(f"Pass: {len(log)-len(fails)}/{len(log)}  Fail: {len(fails)}")
for r in fails:
    print(f"  FAIL #{r['issue']} {r['label']}: {r['detail'][:100]}")
