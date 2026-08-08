"""Phase 5b - retest Stripe checkout, password-reset email and AI generation correctly."""

import os
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qa_lib import SHOTS, STAGING, Recorder, login, new_context, save_json, settle

CAND_EMAIL = "qa.cand.1786175062@rekrutqa.test"
PASS = "RekrutQA!2026x"
JOB_ID = 174

out = {"steps": []}


def step(name, ok, **extra):
    out["steps"].append({"step": name, "ok": bool(ok), **extra})
    print(f"  [{'PASS' if ok else 'FAIL'}] {name} {extra if extra else ''}")


with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])

    # ---------- Stripe: the real "Start checkout" CTA ----------
    print("== Stripe checkout ==")
    ctx = new_context(pw, browser)
    page = ctx.new_page()
    rec = Recorder(page)
    login(page, rec, STAGING, CAND_EMAIL, PASS)
    page.goto(STAGING + "/pricing", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(6000)
    settle(page)
    rec.reset()
    sc = page.get_by_role("button", name="Start checkout", exact=False)
    print(f"  'Start checkout' buttons: {sc.count()}")
    if sc.count():
        sc.first.click()
        page.wait_for_timeout(20000)
        snap = rec.snapshot()
        out["stripe_url"] = page.url
        out["stripe_api"] = snap["api_calls"]
        out["stripe_failed"] = snap["failed_requests"]
        out["stripe_body"] = page.evaluate("() => (document.body.innerText||'').slice(0,600)")
        page.screenshot(path=os.path.join(SHOTS, "retest-01-stripe.png"), full_page=True)
        on_stripe = "stripe" in page.url.lower() or "checkout" in page.url.lower()
        step(
            "stripe_checkout_opens",
            on_stripe,
            url=page.url,
            api=[a for a in snap["api_calls"] if "POST" in a][:4],
            failed=snap["failed_requests"][:3],
        )
        print("  body:", out["stripe_body"][:250].replace("\n", " | "))

    # ---------- Password reset email ----------
    print("== Password reset (longer window) ==")
    ectx = new_context(pw, browser)
    epage = ectx.new_page()
    erec = Recorder(epage)
    epage.goto(STAGING + "/forgot-password", wait_until="domcontentloaded", timeout=60000)
    epage.wait_for_timeout(4000)
    erec.reset()
    epage.locator("input[type=email]").first.fill(CAND_EMAIL)
    epage.get_by_role("button", name="Send", exact=False).first.click()
    epage.wait_for_timeout(35000)
    esnap = erec.snapshot()
    out["reset_api"] = esnap["api_calls"]
    out["reset_failed"] = esnap["failed_requests"]
    out["reset_body"] = epage.evaluate("() => (document.body.innerText||'').slice(0,600)")
    epage.screenshot(path=os.path.join(SHOTS, "retest-02-reset.png"), full_page=True)
    step(
        "password_reset_request",
        any("-> 20" in a for a in esnap["api_calls"]),
        api=esnap["api_calls"][:4],
        failed=esnap["failed_requests"][:3],
    )
    print("  body:", out["reset_body"][:250].replace("\n", " | "))

    # ---------- AI generation inside the apply form ----------
    print("== AI cover letter generation ==")
    page.goto(f"{STAGING}/candidate/jobs/{JOB_ID}", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(7000)
    settle(page)
    body = page.evaluate("() => (document.body.innerText||'')")
    out["job_page_state"] = body[:400]
    # Already applied earlier, so the apply form may be replaced by an Applied badge
    ab = page.get_by_role("button", name="Apply Now", exact=False)
    print(f"  Apply Now present: {ab.count()} | 'Applied' on page: {'Applied' in body}")
    if ab.count():
        ab.first.click()
        page.wait_for_timeout(4000)
    allb = page.evaluate(
        """() => [...document.querySelectorAll('button')].filter(b=>b.offsetParent)
            .map(b=>b.innerText.trim()).filter(Boolean)"""
    )
    out["job_buttons"] = allb
    print("  buttons:", allb)
    rec.reset()
    gen = page.get_by_role("button", name="Generate with AI", exact=False)
    if gen.count() and gen.first.is_visible():
        gen.first.click()
        page.wait_for_timeout(30000)
        snap = rec.snapshot()
        ta = page.locator("textarea").first
        content = ta.input_value() if ta.count() else ""
        out["ai_api"] = [a for a in snap["api_calls"] if "POST" in a]
        out["ai_failed"] = snap["failed_requests"]
        page.screenshot(path=os.path.join(SHOTS, "retest-03-ai.png"), full_page=True)
        step(
            "ai_cover_letter_generation",
            len(content) > 80,
            chars=len(content),
            api=out["ai_api"][:3],
            failed=snap["failed_requests"][:3],
        )
    else:
        step("ai_cover_letter_generation", False, reason="Generate with AI not available", buttons=allb[:12])

    save_json("phase5b-retest.json", out)
    ctx.close()
    ectx.close()
    browser.close()

print("\nSummary:")
for s in out["steps"]:
    print(f"  {'PASS' if s['ok'] else 'FAIL'}  {s['step']}")
