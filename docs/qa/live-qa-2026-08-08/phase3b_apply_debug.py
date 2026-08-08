"""Focused investigation of the candidate Apply action, which produced no network call."""

import os
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qa_lib import SHOTS, STAGING, Recorder, login, new_context, save_json, settle

CAND_EMAIL = "qa.cand.1786175062@rekrutqa.test"
PASS = "RekrutQA!2026x"
JOB_MATCH = "QA Loop Engineer"

out = {}

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])
    ctx = new_context(pw, browser)
    page = ctx.new_page()
    rec = Recorder(page)
    page.on("dialog", lambda d: (out.setdefault("dialogs", []).append(d.message), d.accept()))

    login(page, rec, STAGING, CAND_EMAIL, PASS)

    page.goto(STAGING + "/candidate/jobs", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(9000)
    settle(page)

    page.get_by_text(JOB_MATCH, exact=False).first.click()
    page.wait_for_timeout(6000)
    settle(page)
    out["detail_url"] = page.url
    print("detail url:", page.url)

    # Full inventory of every button, including disabled state
    out["buttons_before"] = page.evaluate(
        """() => [...document.querySelectorAll('button')].filter(b=>b.offsetParent).map(b=>({
            text: b.innerText.trim(), disabled: b.disabled,
            cls: b.className.slice(0,90),
            aria: b.getAttribute('aria-disabled'),
        }))"""
    )
    print("APPLY buttons:", [b for b in out["buttons_before"] if "appl" in b["text"].lower()])

    rec.reset()
    apply_btn = page.get_by_role("button", name="Apply Now", exact=False).first
    out["apply_visible"] = apply_btn.is_visible()
    out["apply_enabled"] = apply_btn.is_enabled()
    print(f"apply visible={out['apply_visible']} enabled={out['apply_enabled']}")

    apply_btn.click()
    page.wait_for_timeout(9000)
    page.screenshot(path=os.path.join(SHOTS, "apply-01-clicked.png"), full_page=True)

    snap = rec.snapshot()
    out["after_click"] = snap
    out["modal_text"] = page.evaluate(
        """() => [...document.querySelectorAll('[role=dialog],.fixed')]
            .filter(e=>e.offsetParent).map(e=>e.innerText.trim().slice(0,600))"""
    )
    out["buttons_after"] = page.evaluate(
        """() => [...document.querySelectorAll('button')].filter(b=>b.offsetParent)
            .map(b=>b.innerText.trim()).filter(Boolean)"""
    )
    out["body_after"] = page.evaluate("() => (document.body.innerText||'').slice(0,1500)")

    print("\nAPI calls after clicking Apply:", snap["api_calls"] or "NONE")
    print("Console errors:", snap["console_errors"][:5] or "none")
    print("Page errors:", snap["page_errors"][:3] or "none")
    print("Modals:", [m[:200] for m in out["modal_text"]] or "none")
    print("Buttons after:", out["buttons_after"][:20])

    save_json("phase3b-apply-debug.json", out)
    ctx.close()
    browser.close()
