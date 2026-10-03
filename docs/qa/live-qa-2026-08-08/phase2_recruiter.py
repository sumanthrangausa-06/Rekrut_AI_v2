"""Phase 2 - fresh recruiter signup on staging + sweep of every recruiter route."""

import os
import sys
import time

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qa_lib import HERE, STAGING, Recorder, login, new_context, register, save_json, visit

TS = int(time.time())
REC_EMAIL = f"qa.rec.{TS}@rekrutqa.test"
REC_PASS = "RekrutQA!2026x"
REC_NAME = "QA Recruiter Alpha"
REC_COMPANY = f"QA Staging Co {TS}"

ROUTES = [
    ("/recruiter", "rec-01-dashboard"),
    ("/recruiter/jobs", "rec-02-jobs"),
    ("/recruiter/jobs/new", "rec-03-jobs-new"),
    ("/recruiter/job-create", "rec-04-job-create"),
    ("/recruiter/applications", "rec-05-applications"),
    ("/recruiter/candidates", "rec-06-candidates"),
    ("/recruiter/assessments", "rec-07-assessments"),
    ("/recruiter/screening", "rec-08-screening"),
    ("/recruiter/interviews", "rec-09-interviews"),
    ("/recruiter/offers", "rec-10-offers"),
    ("/recruiter/analytics", "rec-11-analytics"),
    ("/recruiter/omniscore", "rec-12-omniscore"),
    ("/recruiter/trustscore", "rec-13-trustscore"),
    ("/recruiter/chat", "rec-14-chat"),
    ("/recruiter/communications", "rec-15-communications"),
    ("/recruiter/career-page", "rec-16-career-page"),
    ("/recruiter/company", "rec-17-company"),
    ("/recruiter/profile", "rec-18-profile"),
    ("/recruiter/onboarding", "rec-19-onboarding"),
    ("/recruiter/onboarding-ai", "rec-20-onboarding-ai"),
    ("/recruiter/onboarding-docs", "rec-21-onboarding-docs"),
    ("/recruiter/payroll", "rec-22-payroll"),
    ("/recruiter/payroll-dashboard", "rec-23-payroll-dashboard"),
    ("/recruiter/post-hire-feedback", "rec-24-post-hire-feedback"),
    ("/recruiter/compliance", "rec-25-compliance"),
]


def main():
    out = {
        "env": STAGING,
        "account": {"email": REC_EMAIL, "password": REC_PASS, "company": REC_COMPANY},
    }
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])
        ctx = new_context(pw, browser)
        page = ctx.new_page()
        rec = Recorder(page)

        print("== Registering fresh recruiter ==")
        out["signup"] = register(
            page, rec, STAGING, "employer", REC_EMAIL, REC_PASS, REC_NAME, REC_COMPANY
        )

        if out["signup"]["still_on_register"]:
            out["login_fallback"] = login(page, rec, STAGING, REC_EMAIL, REC_PASS)

        print("== Sweeping recruiter routes ==")
        out["routes"] = [visit(page, rec, STAGING, p, n) for p, n in ROUTES]

        ctx.storage_state(path=os.path.join(HERE, "recruiter-auth.json"))
        ctx.close()
        browser.close()

    # A page firing >25 API calls on a single load is a render loop, not normal.
    loops = [
        {"page": r["name"], "calls": len(r.get("api_calls", []))}
        for r in out["routes"]
        if len(r.get("api_calls", [])) > 25
    ]
    broken = [r["name"] for r in out["routes"] if r.get("looks_broken")]
    out["broken_summary"] = broken
    out["render_loops"] = loops
    save_json("phase2-recruiter.json", out)
    print(f"\nBroken/suspect ({len(broken)}/{len(out['routes'])}): {broken}")
    print(f"Render loops: {loops}")
    print(f"Account: {REC_EMAIL} / {REC_PASS}")


if __name__ == "__main__":
    main()
