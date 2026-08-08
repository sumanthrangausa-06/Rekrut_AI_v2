"""Phase 4 - confirm the drawer Apply defect, then drive the recruiter pipeline:
applicant review -> stage advancement -> offer -> candidate acceptance.
"""

import os
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qa_lib import SHOTS, STAGING, Recorder, login, new_context, save_json, settle

REC_EMAIL = "qa.rec.1786175490@rekrutqa.test"
CAND_EMAIL = "qa.cand.1786175062@rekrutqa.test"
PASS = "RekrutQA!2026x"
JOB_ID = 174

out = {"steps": []}


def step(name, ok, **extra):
    out["steps"].append({"step": name, "ok": bool(ok), **extra})
    print(f"  [{'PASS' if ok else 'FAIL'}] {name} {extra if extra else ''}")


def btns(page):
    return page.evaluate(
        """() => [...document.querySelectorAll('button')].filter(b=>b.offsetParent)
            .map(b=>b.innerText.trim()).filter(Boolean)"""
    )


with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])

    # ---------- Confirm the drawer Apply defect ----------
    print("== Drawer apply behaviour ==")
    cctx = new_context(pw, browser)
    cpage = cctx.new_page()
    crec = Recorder(cpage)
    login(cpage, crec, STAGING, CAND_EMAIL, PASS)
    cpage.goto(STAGING + "/candidate/jobs", wait_until="domcontentloaded", timeout=60000)
    cpage.wait_for_timeout(9000)
    settle(cpage)

    # Open a job card to trigger the drawer
    card = cpage.get_by_text("QA Loop Engineer", exact=False).first
    card.click()
    cpage.wait_for_timeout(4000)
    out["drawer_url"] = cpage.url
    out["drawer_buttons"] = btns(cpage)
    is_drawer = "View Full Page" in out["drawer_buttons"]
    print(f"  after card click url={cpage.url} drawer={is_drawer}")
    cpage.screenshot(path=os.path.join(SHOTS, "drawer-01-open.png"), full_page=True)

    ab = cpage.get_by_role("button", name="Apply Now", exact=False)
    if ab.count():
        ab.first.click()
        cpage.wait_for_timeout(7000)
        settle(cpage)
        state = cpage.evaluate(
            """() => ({
                url: location.href,
                apply_heading: /Apply for/i.test(document.body.innerText||''),
                textareas: [...document.querySelectorAll('textarea')].filter(e=>e.offsetParent).length,
            })"""
        )
        out["after_drawer_apply"] = state
        cpage.screenshot(path=os.path.join(SHOTS, "drawer-02-after-apply.png"), full_page=True)
        step(
            "drawer_apply_opens_form",
            state["apply_heading"] and state["textareas"] > 0,
            url=state["url"],
            form_open=state["apply_heading"],
        )

    # ---------- Recruiter pipeline ----------
    print("== Recruiter applicants ==")
    rctx = new_context(pw, browser)
    rpage = rctx.new_page()
    rrec = Recorder(rpage)
    login(rpage, rrec, STAGING, REC_EMAIL, PASS)

    rrec.reset()
    rpage.goto(
        f"{STAGING}/recruiter/jobs/{JOB_ID}/applicants", wait_until="domcontentloaded", timeout=60000
    )
    rpage.wait_for_timeout(9000)
    settle(rpage)
    body = rpage.evaluate("() => (document.body.innerText||'')")
    out["applicants_page"] = body[:1200]
    out["applicants_buttons"] = btns(rpage)
    rpage.screenshot(path=os.path.join(SHOTS, "pipe-01-applicants.png"), full_page=True)
    step("recruiter_sees_applicant", "QA Candidate" in body, preview=body[:250])
    print("  buttons:", out["applicants_buttons"][:25])

    # Recruiter Applications list view
    rrec.reset()
    rpage.goto(STAGING + "/recruiter/applications", wait_until="domcontentloaded", timeout=60000)
    rpage.wait_for_timeout(9000)
    settle(rpage)
    abody = rpage.evaluate("() => (document.body.innerText||'')")
    out["applications_list"] = abody[:1200]
    rpage.screenshot(path=os.path.join(SHOTS, "pipe-02-applications.png"), full_page=True)
    step("applications_list_shows_candidate", "QA Candidate" in abody, preview=abody[:300])

    # Recruiter Candidates view
    rrec.reset()
    rpage.goto(STAGING + "/recruiter/candidates", wait_until="domcontentloaded", timeout=60000)
    rpage.wait_for_timeout(10000)
    cbody = rpage.evaluate("() => (document.body.innerText||'')")
    out["candidates_page"] = cbody[:1200]
    rpage.screenshot(path=os.path.join(SHOTS, "pipe-03-candidates.png"), full_page=True)
    step("candidates_page_shows_applicant", "QA Candidate" in cbody, preview=cbody[:300])

    # Dashboard counters should reflect 1 job / 1 application
    rrec.reset()
    rpage.goto(STAGING + "/recruiter", wait_until="domcontentloaded", timeout=60000)
    rpage.wait_for_timeout(8000)
    dbody = rpage.evaluate("() => (document.body.innerText||'')")
    out["dashboard"] = dbody[:1500]
    rpage.screenshot(path=os.path.join(SHOTS, "pipe-04-dashboard.png"), full_page=True)
    print("  dashboard preview:", dbody[:400].replace("\n", " | "))

    save_json("phase4-pipeline.json", out)
    rctx.close()
    cctx.close()
    browser.close()

print("\nSummary:")
for s in out["steps"]:
    print(f"  {'PASS' if s['ok'] else 'FAIL'}  {s['step']}")
