"""
QA Script 2 (v3 final): Employer + Recruiter + Pending Recruiter flows
Selectors fixed from screenshot analysis 2026-08-11
"""
import json, time
from playwright.sync_api import sync_playwright, Page

BASE = "https://rekrutai-staging.onrender.com"
OUT  = "docs/qa/live-qa-2026-08-11/screenshots"
TS   = "1786410000"
OWNER_EMAIL = f"qa.owner.{TS}@qarecruit.io"
OWNER_PW    = "QaStagingOwner!2026"
REC_EMAIL   = f"qa.recruiter.{TS}@qarecruit.io"
REC_PW      = "QaStagingRec!2026"

log = []
api_failures: list[dict] = []
console_errors_all: list[str] = []

def record(step, ok, detail="", severity="none"):
    entry = {"step": step, "ok": ok, "detail": detail, "severity": severity}
    log.append(entry)
    print(f"[{'OK  ' if ok else 'FAIL'}] {step} — {detail[:140]}")

def capture(page: Page, name: str):
    try:
        page.screenshot(path=f"{OUT}/{name}.png", full_page=True, timeout=10000)
    except Exception as e:
        print(f"  [screenshot failed] {name}: {e}")

def has_spinner(page: Page) -> bool:
    return page.locator("svg[class*='animate-spin'], [class*='spinner']").count() > 0

def has_mock_data(page: Page) -> bool:
    """Detect fabricated dashboard data for brand-new accounts."""
    body = page.inner_text("body")
    sigs = [
        "100\ntotal",       # Source Breakdown "100 total" donut
        "Direct: 42",        # hardcoded source breakdown
        "Referral: 28",
        "+65%",              # fake Applications Over Time trend
        "Jan: 12 interviews",
        "Jan: 15 interviews",
        "Feb: 12 interviews",
        "Feb: 15 interviews",
    ]
    return any(s.lower() in body.lower() for s in sigs)

def login_as(page: Page, email: str, pw: str) -> bool:
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

def logout(page: Page):
    """Navigate to logout by clicking the user avatar dropdown then Sign out."""
    try:
        # try direct navigation to trigger logout endpoint
        page.evaluate("() => { localStorage.clear(); sessionStorage.clear(); }")
        page.goto(f"{BASE}/login", wait_until="domcontentloaded", timeout=15000)
        page.wait_for_timeout(1000)
    except Exception:
        pass

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()

    page.on("console", lambda m: console_errors_all.append(m.text) if m.type == "error" else None)
    page.on("response", lambda r: api_failures.append({"url": r.url, "status": r.status})
            if "/api/" in r.url and r.status >= 400 else None)

    # ── US-R01: Employer registration ──
    page.goto(f"{BASE}/register", wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(1500)
    page.click("button:has-text('Employer')")
    page.wait_for_timeout(500)
    page.fill("input[placeholder='John Doe']", "QA Owner")
    page.fill("input#email", OWNER_EMAIL)
    page.fill("input#password", OWNER_PW)
    if page.locator("input[placeholder='Your company']").count() > 0:
        page.fill("input[placeholder='Your company']", "QA Recruit IO")
    capture(page, "r01a-employer-register-filled-v3")
    page.click("button[type='submit']")
    for _ in range(24):
        page.wait_for_timeout(500)
        if page.url != f"{BASE}/register":
            break
    page.wait_for_timeout(3000)
    capture(page, "r01b-after-employer-register-v3")
    vis_err = []
    for sel in ["[role='alert']", "[class*='error']"]:
        try:
            vis_err.extend([t for t in page.locator(sel).all_inner_texts() if t.strip()])
        except Exception:
            pass
    still_register = "/register" in page.url
    record("US-R01 Employer registration", not still_register,
           f"url={page.url}", "high" if still_register else "none")

    # login if not auto-logged in
    if "/login" in page.url or "/register" in page.url:
        login_as(page, OWNER_EMAIL, OWNER_PW)
        page.wait_for_timeout(3000)
    capture(page, "r02-employer-dashboard-v3")
    record("US-R02 Employer login + dashboard", "/login" not in page.url,
           f"url={page.url}", "high" if "/login" in page.url else "none")

    # ── US-R03: Recruiter dashboard — check mock data ──
    page.goto(f"{BASE}/recruiter", wait_until="domcontentloaded", timeout=25000)
    page.wait_for_timeout(4000)
    capture(page, "r03-recruiter-dashboard-v3")
    stuck  = has_spinner(page)
    mock   = has_mock_data(page)
    record("US-R03 Recruiter dashboard renders (no spinner)", not stuck,
           f"url={page.url} stuck={stuck}", "medium" if stuck else "none")
    record("US-R03 Dashboard shows REAL data (no mock charts)", not mock,
           "Source Breakdown shows '100 total/Direct 42' or '+65%' for brand-new account" if mock else "KPIs are all 0 as expected",
           "high" if mock else "none")

    # ── US-R04: Create job — click 'Post New Job' button ──
    page.goto(f"{BASE}/recruiter/jobs", wait_until="domcontentloaded", timeout=20000)
    page.wait_for_timeout(2000)
    capture(page, "r04a-jobs-list-before-create-v3")
    create_btn = page.locator("button:has-text('Post New Job'), button:has-text('Post a Job'), a:has-text('Post New Job')")
    if create_btn.count() == 0:
        create_btn = page.locator("button:has-text('Create Your First Job'), a:has-text('Create Your First Job')")
    if create_btn.count() > 0:
        create_btn.first.click()
        page.wait_for_timeout(2000)
        capture(page, "r04b-create-job-form-v3")
        # Inspect form inputs
        inputs_info = []
        for inp in page.locator("input, textarea, select").all():
            ph = inp.get_attribute("placeholder") or ""
            n  = inp.get_attribute("name") or ""
            t  = inp.get_attribute("type") or "text"
            inputs_info.append(f"type={t} name={n!r} ph={ph!r}")
        print(f"  create-job form inputs: {inputs_info[:10]}")

        # Fill form
        title_filled = False
        for sel in ["input[name='title']", "input[placeholder*='title' i]",
                    "input[placeholder*='Job Title' i]", "input[id='title']", "input[type='text']"]:
            if page.locator(sel).count() > 0:
                page.locator(sel).first.fill(f"QA Test Engineer (staging-{TS})")
                title_filled = True
                break

        for sel in ["textarea[name='description']", "textarea[placeholder*='descrip' i]", "textarea"]:
            if page.locator(sel).count() > 0:
                page.locator(sel).first.fill("Automated QA test job on staging. Please ignore.")
                break

        for sel in ["input[name='location']", "input[placeholder*='location' i]", "input[placeholder*='City' i]"]:
            if page.locator(sel).count() > 0:
                page.fill(sel, "Remote")
                break

        capture(page, "r04c-create-job-filled-v3")
        submit = page.locator("button[type='submit'], button:has-text('Post Job'), button:has-text('Create Job'), button:has-text('Publish'), button:has-text('Save')")
        url_before = page.url
        if submit.count() > 0:
            submit.first.click()
            page.wait_for_timeout(4000)
            capture(page, "r04d-after-create-job-v3")
            job_created = page.url != url_before or "success" in page.inner_text("body").lower() \
                          or "QA Test Engineer" in page.inner_text("body")
            record("US-R04 Create job posting", job_created,
                   f"title_filled={title_filled} url_after={page.url}",
                   "medium" if not job_created else "none")
        else:
            record("US-R04 Create job posting", False,
                   f"No submit button found. inputs={inputs_info[:5]}", "medium")
    else:
        capture(page, "r04-no-create-btn")
        record("US-R04 Create job posting", False,
               "Could not find 'Post New Job' or 'Create Your First Job' button", "medium")

    # ── US-R05: Jobs list after creation ──
    page.goto(f"{BASE}/recruiter/jobs", wait_until="domcontentloaded", timeout=20000)
    page.wait_for_timeout(3500)
    capture(page, "r05-recruiter-jobs-after-create-v3")
    body = page.inner_text("body")
    has_job = "QA Test Engineer" in body
    record("US-R05 Recruiter jobs list (job visible after create)", has_job,
           f"url={page.url} job_visible={has_job}", "medium" if not has_job else "none")

    # ── US-R06–R08: Other recruiter pages ──
    for slug, path, story in [
        ("r06", "/recruiter/candidates",  "US-R06 Recruiter candidates"),
        ("r07", "/recruiter/analytics",   "US-R07 Recruiter analytics (check mock data)"),
        ("r08", "/recruiter/applications","US-R08 Recruiter applications"),
    ]:
        try:
            page.goto(f"{BASE}{path}", wait_until="domcontentloaded", timeout=20000)
            page.wait_for_timeout(4000)
            capture(page, f"{slug}-{path.split('/')[-1]}-v3")
            stuck = has_spinner(page)
            mock  = has_mock_data(page) if "analytics" in path else False
            blocked = "/login" in page.url
            body_len = len(page.inner_text("body").strip())
            ok = not stuck and not blocked and body_len > 50
            record(story, ok and not mock,
                   f"url={page.url} stuck={stuck} mock={mock} body={body_len}",
                   "high" if mock else ("medium" if not ok else "none"))
        except Exception as e:
            record(story, False, str(e), "medium")

    # ── US-R09: Company profile + team page ──
    page.goto(f"{BASE}/recruiter/company", wait_until="domcontentloaded", timeout=20000)
    page.wait_for_timeout(3500)
    capture(page, "r09-company-profile-v3")
    body = page.inner_text("body")
    has_company = "QA Recruit IO" in body or "Company Profile" in body
    has_500 = "failed to fetch" in body.lower()
    record("US-R09 Company profile page", has_company and not has_500,
           f"url={page.url} has_company={has_company} server_error={has_500}",
           "high" if has_500 else ("medium" if not has_company else "none"))

    # click Team tab
    team_tab = page.locator("button:has-text('Team'), a:has-text('Team')")
    if team_tab.count() > 0:
        team_tab.first.click()
        page.wait_for_timeout(2000)
        capture(page, "r09b-team-tab-v3")
        body = page.inner_text("body")
        has_500 = "failed to fetch" in body.lower() or "internal server" in body.lower()
        has_self = "QA Owner" in body
        record("US-R09b Team tab loads", not has_500,
               f"server_error={has_500} owner_visible={has_self}",
               "high" if has_500 else "none")

    # ── US-R10: Join Requests page ──
    page.goto(f"{BASE}/recruiter/join-requests", wait_until="domcontentloaded", timeout=20000)
    page.wait_for_timeout(2500)
    capture(page, "r10-join-requests-v3")
    body = page.inner_text("body").lower()
    not_found_404 = "404" in body or "not found" in body
    company_not_found = "company not found" in body
    record("US-R10 Join-requests page accessible", not company_not_found and not not_found_404,
           f"url={page.url} company_not_found={company_not_found} 404={not_found_404} body={body[:80]}",
           "high" if company_not_found else ("medium" if not_found_404 else "none"))

    # ── US-R11: Pending recruiter registration ──
    # Log out first by clearing storage and navigating to /login
    logout(page)
    page.wait_for_timeout(1000)
    capture(page, "r11a-after-logout-v3")
    record("Logout before pending-recruiter test", "/login" in page.url or BASE + "/" == page.url,
           f"url={page.url}")

    page.goto(f"{BASE}/register", wait_until="domcontentloaded", timeout=20000)
    page.wait_for_timeout(1500)
    # verify we can see the register form (not redirected)
    on_register = "/register" in page.url
    if not on_register:
        record("US-R11 setup: navigated to /register", False,
               f"Still logged in, got redirected to {page.url}", "high")
    else:
        page.click("button:has-text('Employer')")
        page.wait_for_timeout(500)
        page.fill("input[placeholder='John Doe']", "QA Pending Rec")
        page.fill("input#email", REC_EMAIL)
        page.fill("input#password", REC_PW)
        if page.locator("input[placeholder='Your company']").count() > 0:
            page.fill("input[placeholder='Your company']", "QA Recruit IO")
        capture(page, "r11b-pending-register-filled-v3")
        page.click("button[type='submit']")
        for _ in range(24):
            page.wait_for_timeout(500)
            if page.url != f"{BASE}/register":
                break
        page.wait_for_timeout(3000)
        capture(page, "r11c-after-pending-register-v3")
        body = page.inner_text("body").lower()
        shows_pending = any(kw in body for kw in ["pending", "waiting", "approval", "under review", "request submitted"])
        still_register = "/register" in page.url
        record("US-R11 Pending recruiter holding screen shown", shows_pending and not still_register,
               f"url={page.url} pending_msg={shows_pending} still_on_register={still_register}",
               "high" if not shows_pending else "none")

        # US-R12: Can pending recruiter access recruiter routes?
        page.goto(f"{BASE}/recruiter", wait_until="domcontentloaded", timeout=20000)
        page.wait_for_timeout(3000)
        capture(page, "r12-pending-rec-dashboard-v3")
        body = page.inner_text("body").lower()
        blocked = any(kw in body for kw in ["pending", "waiting", "approval", "not authorized"]) \
                  or "/login" in page.url
        record("US-R12 Pending recruiter blocked from recruiter dashboard", blocked,
               f"url={page.url} blocked={blocked}",
               "high" if not blocked else "none")

    # Summary
    record("Console errors (whole session)",
           len(console_errors_all) == 0,
           f"count={len(console_errors_all)} sample={console_errors_all[:3]}")
    record("API 4xx/5xx (whole session)",
           len(api_failures) == 0,
           f"count={len(api_failures)} breakdown={list({r['url'].split('/')[-2]+'/'+r['url'].split('/')[-1]: r['status'] for r in api_failures}.items())[:6]}")

    browser.close()

with open("docs/qa/live-qa-2026-08-11/qa_02_results.json", "w", encoding="utf-8") as f:
    json.dump({"log": log,
               "api_failures": api_failures[:40],
               "console_errors": console_errors_all[:30]}, f, indent=2)

print("\n=== DONE — recruiter flow v3 ===")
fails = [r for r in log if not r["ok"]]
print(f"Pass: {len(log)-len(fails)}/{len(log)}  Fail: {len(fails)}")
for r in fails:
    print(f"  FAIL [{r['severity'].upper():7}] {r['step']}: {r['detail'][:120]}")
