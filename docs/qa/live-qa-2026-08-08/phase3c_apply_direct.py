"""Compare Apply on the standalone job page vs the slide-out drawer, then submit for real."""

import os
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qa_lib import SHOTS, STAGING, Recorder, login, new_context, save_json, settle

CAND_EMAIL = "qa.cand.1786175062@rekrutqa.test"
PASS = "RekrutQA!2026x"
JOB_ID = 174

out = {}


def visible_buttons(page):
    return page.evaluate(
        """() => [...document.querySelectorAll('button')].filter(b=>b.offsetParent)
            .map(b=>b.innerText.trim()).filter(Boolean)"""
    )


def form_present(page):
    return page.evaluate(
        """() => {
            const t = document.body.innerText || '';
            return {
                has_apply_for_heading: /Apply for/i.test(t),
                textareas: [...document.querySelectorAll('textarea')].filter(e=>e.offsetParent).length,
                has_submit: [...document.querySelectorAll('button')]
                    .some(b => b.offsetParent && /submit application|submit/i.test(b.innerText)),
            };
        }"""
    )


with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])
    ctx = new_context(pw, browser)
    page = ctx.new_page()
    rec = Recorder(page)
    login(page, rec, STAGING, CAND_EMAIL, PASS)

    # ---- Standalone job detail page ----
    print(f"== Standalone page /candidate/jobs/{JOB_ID} ==")
    page.goto(f"{STAGING}/candidate/jobs/{JOB_ID}", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(7000)
    settle(page)
    out["standalone_url"] = page.url
    out["standalone_before"] = form_present(page)
    print("  before click:", out["standalone_before"])
    print("  buttons:", visible_buttons(page))

    rec.reset()
    btn = page.get_by_role("button", name="Apply Now", exact=False)
    if btn.count():
        btn.first.click()
        page.wait_for_timeout(5000)
        out["standalone_after"] = form_present(page)
        out["standalone_buttons_after"] = visible_buttons(page)
        print("  after click:", out["standalone_after"])
        print("  buttons after:", out["standalone_buttons_after"])
        page.screenshot(path=os.path.join(SHOTS, "apply-02-standalone.png"), full_page=True)

        # If the form opened, complete a genuine application
        if out["standalone_after"]["textareas"] > 0:
            ta = page.locator("textarea").first
            ta.fill(
                "I am excited to apply for this role. I have extensive experience building "
                "Playwright based regression suites and shipping reliable CI pipelines."
            )
            page.wait_for_timeout(800)
            rec.reset()
            submitted = False
            for label in ("Submit Application", "Submit", "Send Application"):
                sb = page.get_by_role("button", name=label, exact=False)
                if sb.count() and sb.first.is_visible():
                    sb.first.click()
                    submitted = True
                    break
            page.wait_for_timeout(8000)
            settle(page)
            snap = rec.snapshot()
            out["submit_api"] = snap["api_calls"]
            out["submit_failed"] = snap["failed_requests"]
            out["submit_clicked"] = submitted
            out["body_after_submit"] = page.evaluate(
                "() => (document.body.innerText||'').slice(0,900)"
            )
            page.screenshot(path=os.path.join(SHOTS, "apply-03-submitted.png"), full_page=True)
            print("  submit clicked:", submitted)
            print("  API:", [a for a in snap["api_calls"] if "POST" in a] or "NO POST")
            print("  failed:", snap["failed_requests"][:3])
    else:
        out["standalone_no_apply_button"] = True
        print("  NO Apply Now button on standalone page")

    # ---- Confirm the application landed ----
    print("== Candidate applications ==")
    page.goto(STAGING + "/candidate/applications", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(7000)
    settle(page)
    apps = page.evaluate("() => (document.body.innerText||'')")
    out["applications_page"] = apps[:900]
    out["application_listed"] = "QA Loop Engineer" in apps
    page.screenshot(path=os.path.join(SHOTS, "apply-04-applications.png"), full_page=True)
    print("  application listed:", out["application_listed"])

    save_json("phase3c-apply-direct.json", out)
    ctx.close()
    browser.close()
