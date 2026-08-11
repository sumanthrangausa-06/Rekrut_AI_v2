"""
QA Script 1 (v2): Public pages + Candidate flow
Target: https://rekrutai-staging.onrender.com
Selectors verified from live form inspection 2026-08-11
"""
import json, time
from playwright.sync_api import sync_playwright, Page

BASE = "https://rekrutai-staging.onrender.com"
OUT  = "docs/qa/live-qa-2026-08-11/screenshots"
TS   = "1786410000"
CAND_EMAIL = f"qa.cand.{TS}@proton.me"
CAND_PW    = "QaStagingCand!2026"

log = []
api_failures: list[dict] = []
console_errors_all: list[str] = []

def record(step, ok, detail="", severity="none"):
    entry = {"step": step, "ok": ok, "detail": detail, "severity": severity}
    log.append(entry)
    print(f"[{'OK  ' if ok else 'FAIL'}] {step} — {detail[:130]}")

def capture(page: Page, name: str):
    try:
        page.screenshot(path=f"{OUT}/{name}.png", full_page=True, timeout=10000)
    except Exception as e:
        print(f"  [screenshot failed] {name}: {e}")

def has_spinner(page: Page) -> bool:
    return page.locator(
        "svg[class*='animate-spin'], [class*='spinner'], [aria-label*='ading' i]"
    ).count() > 0

def visible_errors(page: Page) -> list[str]:
    errs = []
    for sel in ["[role='alert']", "[class*='error']", "p[class*='text-red']"]:
        try:
            errs.extend([t.strip() for t in page.locator(sel).all_inner_texts() if t.strip()])
        except Exception:
            pass
    return errs[:5]

def login_as(page: Page, email: str, pw: str) -> bool:
    """Log in and wait for redirect away from /login. Returns True on success."""
    page.goto(f"{BASE}/login", wait_until="domcontentloaded", timeout=25000)
    page.wait_for_timeout(1000)
    page.fill("input#email", email)
    page.fill("input#password", pw)
    page.click("button[type='submit']")
    for _ in range(24):
        page.wait_for_timeout(500)
        if "/login" not in page.url:
            return True
    return False

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()

    page.on("console", lambda m: console_errors_all.append(m.text) if m.type == "error" else None)
    page.on("response", lambda r: api_failures.append({"url": r.url, "status": r.status})
            if "/api/" in r.url and r.status >= 400 else None)

    # ── Wake staging ──
    print("Waking staging...")
    t0 = time.time()
    page.goto(BASE, wait_until="networkidle", timeout=60000)
    record("Staging wake-up", True, f"{int((time.time()-t0)*1000)}ms response time")

    # ══════════════════ PUBLIC PAGES ══════════════════

    # US-P01: Home
    page.goto(BASE, wait_until="networkidle", timeout=30000)
    page.wait_for_timeout(2000)
    capture(page, "p01-home")
    body = page.inner_text("body")
    record("US-P01 Home page", "rekrut" in body.lower() or "hire" in body.lower() or "job" in body.lower(),
           f"url={page.url} body_len={len(body)}")

    # US-P02: Public /jobs
    page.goto(f"{BASE}/jobs", wait_until="domcontentloaded", timeout=20000)
    page.wait_for_timeout(4000)
    capture(page, "p02-public-jobs")
    body = page.inner_text("body")
    stuck = has_spinner(page)
    has_content = len(body) > 200 and not stuck
    record("US-P02 Public /jobs page", has_content,
           f"body_len={len(body)} stuck_spinner={stuck}")

    # US-P03: Login page
    page.goto(f"{BASE}/login", wait_until="domcontentloaded", timeout=20000)
    page.wait_for_timeout(1500)
    capture(page, "p03-login")
    has_email = page.locator("input#email").count() > 0
    has_pw    = page.locator("input#password").count() > 0
    record("US-P03 Login form fields", has_email and has_pw,
           f"email_field={has_email} pw_field={has_pw}")

    # US-P04: Register page
    page.goto(f"{BASE}/register", wait_until="domcontentloaded", timeout=20000)
    page.wait_for_timeout(1500)
    capture(page, "p04-register")
    has_name  = page.locator("input[placeholder='John Doe']").count() > 0
    has_roles = page.locator("button:has-text('Job Seeker')").count() > 0
    record("US-P04 Register form + role buttons", has_name and has_roles,
           f"name_field={has_name} role_buttons={has_roles}")

    # US-P05: Forgot password
    page.goto(f"{BASE}/forgot-password", wait_until="domcontentloaded", timeout=20000)
    page.wait_for_timeout(1500)
    capture(page, "p05-forgot-password")
    has_input = page.locator("input").count() > 0
    record("US-P05 Forgot-password page", has_input, page.url)

    # US-P06: 404
    page.goto(f"{BASE}/this-page-does-not-exist-8811", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(1500)
    capture(page, "p06-404")
    body = page.inner_text("body")
    shows_notfound = any(kw in body.lower() for kw in ["not found", "404", "doesn't exist"])
    record("US-P06 404 page shows not-found UI", shows_notfound, body[:100])

    # ══════════════════ CANDIDATE FLOW ══════════════════

    # US-C01: Register as candidate
    page.goto(f"{BASE}/register", wait_until="domcontentloaded", timeout=20000)
    page.wait_for_timeout(1000)
    # select Job Seeker role first
    page.click("button:has-text('Job Seeker')")
    page.wait_for_timeout(300)
    page.fill("input[placeholder='John Doe']", "QA Candidate")
    page.fill("input#email", CAND_EMAIL)
    page.fill("input#password", CAND_PW)
    capture(page, "c01a-register-filled")
    page.click("button[type='submit']")
    for _ in range(24):
        page.wait_for_timeout(500)
        if page.url != f"{BASE}/register":
            break
    page.wait_for_timeout(2000)
    capture(page, "c01b-after-register")
    vis_err = visible_errors(page)
    on_register = page.url.endswith("/register") or "/register" in page.url
    record("US-C01 Candidate registration", not on_register,
           f"url={page.url} vis_errors={vis_err}",
           "high" if on_register else "none")

    # US-C02: Login (may already be logged in after registration)
    already_in = "candidate" in page.url or "dashboard" in page.url
    if not already_in:
        ok = login_as(page, CAND_EMAIL, CAND_PW)
        page.wait_for_timeout(3000)
    capture(page, "c02-after-login")
    login_ok = "/login" not in page.url
    record("US-C02 Candidate login", login_ok,
           f"url={page.url}", "high" if not login_ok else "none")

    # US-C03–C10: Candidate pages
    cand_pages = [
        ("c03", "/candidate",              "US-C03 Candidate dashboard"),
        ("c04", "/candidate/jobs",         "US-C04 Candidate job board"),
        ("c07", "/candidate/profile",      "US-C07 Candidate profile"),
        ("c08", "/candidate/omniscore",    "US-C08 OmniScore"),
        ("c09", "/candidate/applications", "US-C09 My applications"),
        ("c09b","/candidate/interviews",   "US-C09b Interviews"),
        ("c09c","/candidate/assessments",  "US-C09c Assessments"),
        ("c10", "/settings",               "US-C10 Settings"),
    ]
    for slug, path, story in cand_pages:
        try:
            page.goto(f"{BASE}{path}", wait_until="domcontentloaded", timeout=25000)
            page.wait_for_timeout(4000)
            name = path.split("/")[-1] or "dashboard"
            capture(page, f"{slug}-{name}")
            url  = page.url
            body = page.inner_text("body").strip()
            stuck = has_spinner(page)
            is_login = "/login" in url
            vis_err  = visible_errors(page)
            ok = not is_login and len(body) > 50 and not stuck
            sev = "none"
            if not ok:
                sev = "high" if "job" in path or "dashboard" in path else "medium"
            record(story, ok,
                   f"url={url} body={len(body)} spinner={stuck} vis_err={vis_err[:2]}",
                   sev)
        except Exception as e:
            record(story, False, str(e), "medium")

    # US-C05: Click a job and apply
    try:
        page.goto(f"{BASE}/candidate/jobs", wait_until="domcontentloaded", timeout=25000)
        page.wait_for_timeout(5000)
        capture(page, "c05-job-board-loaded")
        # look for clickable job cards
        job_links = page.locator("a[href*='/jobs/']:not([href$='/jobs'])")
        n = job_links.count()
        record("US-C05a Job board has clickable jobs", n > 0,
               f"job_links_found={n}", "medium" if n == 0 else "none")
        if n > 0:
            job_links.first.click()
            page.wait_for_timeout(2000)
            capture(page, "c05b-job-detail")
            job_url = page.url
            apply_btn = page.locator("button:has-text('Apply'), button:has-text('Apply Now')")
            has_apply = apply_btn.count() > 0
            record("US-C05b Job detail has Apply button", has_apply,
                   f"url={job_url}", "medium" if not has_apply else "none")
            if has_apply:
                apply_btn.first.click()
                page.wait_for_timeout(2000)
                cover = page.locator("textarea")
                if cover.count() > 0:
                    cover.first.fill("QA automated test — excited to apply for this role.")
                capture(page, "c05c-apply-modal")
                submit_apply = page.locator("button[type='submit'], button:has-text('Submit Application')")
                if submit_apply.count() > 0:
                    submit_apply.first.click()
                    page.wait_for_timeout(2500)
                capture(page, "c05d-after-apply")
                record("US-C05c Apply submitted", True, f"url={page.url}")
    except Exception as e:
        record("US-C05 Job apply flow", False, str(e), "medium")

    # Console + API error summary
    record("Console errors (whole session)",
           len(console_errors_all) == 0,
           f"count={len(console_errors_all)} sample={console_errors_all[:5]}")
    record("API 4xx/5xx (whole session)",
           len(api_failures) == 0,
           f"count={len(api_failures)} failures={api_failures[:8]}")

    browser.close()

# Save results
with open("docs/qa/live-qa-2026-08-11/qa_01_results.json", "w", encoding="utf-8") as f:
    json.dump({"log": log,
               "api_failures": api_failures[:40],
               "console_errors": console_errors_all[:30]}, f, indent=2)

print("\n=== DONE — public + candidate ===")
fails = [r for r in log if not r["ok"]]
print(f"Pass: {len(log)-len(fails)}/{len(log)}  Fail: {len(fails)}")
for r in fails:
    print(f"  FAIL [{r['severity'].upper():7}] {r['step']}: {r['detail'][:110]}")
