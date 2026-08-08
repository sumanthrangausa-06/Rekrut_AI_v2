"""Phase 1 - fresh candidate signup on staging + sweep of every candidate route."""

import os
import sys
import time

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qa_lib import HERE, STAGING, Recorder, login, new_context, register, save_json, visit

TS = int(time.time())
CAND_EMAIL = f"qa.cand.{TS}@rekrutqa.test"
CAND_PASS = "RekrutQA!2026x"
CAND_NAME = "QA Candidate Alpha"

# (path, label) for every candidate route declared in client/src/App.tsx
ROUTES = [
    ("/candidate", "cand-01-dashboard"),
    ("/candidate/jobs", "cand-02-jobs"),
    ("/candidate/applications", "cand-03-applications"),
    ("/candidate/profile", "cand-04-profile"),
    ("/candidate/assessments", "cand-05-assessments"),
    ("/candidate/assessment-results", "cand-06-assessment-results"),
    ("/candidate/interviews", "cand-07-interviews"),
    ("/candidate/ai-coaching", "cand-08-ai-coaching"),
    ("/candidate/omniscore", "cand-09-omniscore"),
    ("/candidate/documents", "cand-10-documents"),
    ("/candidate/interview-practice", "cand-11-interview-practice"),
    ("/candidate/interview-analysis", "cand-12-interview-analysis"),
    ("/candidate/history", "cand-13-history"),
    ("/candidate/feedback", "cand-14-feedback"),
    ("/candidate/offers", "cand-15-offers"),
    ("/candidate/offers/manage", "cand-16-offers-manage"),
    ("/candidate/company-profile", "cand-17-company-profile"),
    ("/candidate/chat", "cand-18-chat"),
    ("/candidate/onboarding", "cand-19-onboarding"),
    ("/candidate/payroll", "cand-20-payroll"),
    ("/candidate/settings", "cand-21-settings-redirect"),
    ("/settings", "cand-22-settings"),
    # Routes wired to _PlaceholderPage in App.tsx - confirming they are dead ends
    ("/candidate/saved-jobs", "cand-23-saved-jobs-PLACEHOLDER"),
    ("/candidate/top-matches", "cand-24-top-matches-PLACEHOLDER"),
    ("/candidate/company-matches", "cand-25-company-matches-PLACEHOLDER"),
    ("/candidate/ai-search", "cand-26-ai-search-PLACEHOLDER"),
    ("/candidate/cv-review", "cand-27-cv-review-PLACEHOLDER"),
    ("/candidate/linkedin-optimizer", "cand-28-linkedin-optimizer-PLACEHOLDER"),
    ("/candidate/career-diagnosis", "cand-29-career-diagnosis-PLACEHOLDER"),
]


def main():
    out = {"env": STAGING, "account": {"email": CAND_EMAIL, "password": CAND_PASS}}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])
        ctx = new_context(pw, browser)
        page = ctx.new_page()
        rec = Recorder(page)

        print("== Registering fresh candidate ==")
        out["signup"] = register(page, rec, STAGING, "candidate", CAND_EMAIL, CAND_PASS, CAND_NAME)

        # If signup did not auto-authenticate, fall back to explicit login.
        if out["signup"]["still_on_register"] or "/login" in page.url:
            print("== Signup did not land authenticated, logging in ==")
            out["login_fallback"] = login(page, rec, STAGING, CAND_EMAIL, CAND_PASS)

        print("== Sweeping candidate routes ==")
        out["routes"] = [visit(page, rec, STAGING, p, n) for p, n in ROUTES]

        ctx.storage_state(path=os.path.join(HERE, "candidate-auth.json"))
        ctx.close()
        browser.close()

    broken = [r["name"] for r in out["routes"] if r.get("looks_broken")]
    out["broken_summary"] = broken
    save_json("phase1-candidate.json", out)
    print(f"\nBroken/suspect pages ({len(broken)}/{len(out['routes'])}): {broken}")
    print(f"Account: {CAND_EMAIL} / {CAND_PASS}")


if __name__ == "__main__":
    main()
