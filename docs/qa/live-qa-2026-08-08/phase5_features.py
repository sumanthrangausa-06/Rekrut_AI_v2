"""Phase 5 - pipeline advancement, offers, and the paid / side-effecting features:
AI generation, Stripe checkout, transactional email, and the video interview.
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


def text(page):
    return page.evaluate("() => (document.body.innerText||'')")


with sync_playwright() as pw:
    browser = pw.chromium.launch(
        headless=True,
        args=[
            "--disable-dev-shm-usage",
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
        ],
    )

    # ================= RECRUITER: pipeline + offer =================
    rctx = new_context(pw, browser, permissions=["camera", "microphone"])
    rpage = rctx.new_page()
    rrec = Recorder(rpage)
    print("== Recruiter pipeline advancement ==")
    login(rpage, rrec, STAGING, REC_EMAIL, PASS)

    rpage.goto(
        f"{STAGING}/recruiter/jobs/{JOB_ID}/applicants", wait_until="domcontentloaded", timeout=60000
    )
    rpage.wait_for_timeout(9000)
    settle(rpage)
    before = text(rpage)
    rrec.reset()
    adv = rpage.get_by_role("button", name="Advance", exact=False)
    if adv.count():
        adv.first.click()
        rpage.wait_for_timeout(6000)
        after = text(rpage)
        snap = rrec.snapshot()
        rpage.screenshot(path=os.path.join(SHOTS, "feat-01-advance.png"), full_page=True)
        posts = [a for a in snap["api_calls"] if "POST" in a or "PATCH" in a or "PUT" in a]
        step(
            "pipeline_advance",
            bool(posts) and not snap["failed_requests"],
            api=posts[:4],
            failed=snap["failed_requests"][:2],
            changed=before != after,
        )
    else:
        step("pipeline_advance", False, reason="no Advance button")

    # Offers
    print("== Recruiter offers ==")
    rrec.reset()
    rpage.goto(STAGING + "/recruiter/offers", wait_until="domcontentloaded", timeout=60000)
    rpage.wait_for_timeout(9000)
    ob = btns(rpage)
    out["offer_buttons"] = ob
    rpage.screenshot(path=os.path.join(SHOTS, "feat-02-offers.png"), full_page=True)
    create = [b for b in ob if "offer" in b.lower() or "create" in b.lower()]
    step("offers_page_has_create", bool(create), buttons=ob[:15])

    # ================= CANDIDATE: AI + video + billing =================
    cctx = new_context(pw, browser, permissions=["camera", "microphone"])
    cpage = cctx.new_page()
    crec = Recorder(cpage)
    print("== Candidate login ==")
    login(cpage, crec, STAGING, CAND_EMAIL, PASS)

    # --- AI: cover letter generation on the job page ---
    print("== AI: generate cover letter ==")
    cpage.goto(f"{STAGING}/candidate/jobs/{JOB_ID}", wait_until="domcontentloaded", timeout=60000)
    cpage.wait_for_timeout(7000)
    settle(cpage)
    ab = cpage.get_by_role("button", name="Apply Now", exact=False)
    if ab.count():
        ab.first.click()
        cpage.wait_for_timeout(3000)
    crec.reset()
    gen = cpage.get_by_role("button", name="Generate with AI", exact=False)
    if gen.count() and gen.first.is_visible():
        gen.first.click()
        cpage.wait_for_timeout(25000)
        snap = crec.snapshot()
        cpage.screenshot(path=os.path.join(SHOTS, "feat-03-ai-cover.png"), full_page=True)
        ta = cpage.locator("textarea").first
        content = ta.input_value() if ta.count() else ""
        step(
            "ai_cover_letter_generation",
            len(content) > 80 and not snap["failed_requests"],
            chars=len(content),
            failed=snap["failed_requests"][:2],
            api=[a for a in snap["api_calls"] if "POST" in a][:3],
        )
    else:
        step("ai_cover_letter_generation", False, reason="button not found")

    # --- AI: coaching page ---
    print("== AI: coaching ==")
    crec.reset()
    cpage.goto(STAGING + "/candidate/ai-coaching", wait_until="domcontentloaded", timeout=60000)
    cpage.wait_for_timeout(8000)
    settle(cpage)
    cb = btns(cpage)
    out["coaching_buttons"] = cb
    cpage.screenshot(path=os.path.join(SHOTS, "feat-04-coaching.png"), full_page=True)
    start = [b for b in cb if "start" in b.lower() or "practice" in b.lower() or "begin" in b.lower()]
    step("ai_coaching_loads", len(text(cpage)) > 1000, buttons=cb[:12])

    # --- Video interview with a fake webcam ---
    print("== Video interview ==")
    crec.reset()
    cpage.goto(STAGING + "/candidate/video-interview", wait_until="domcontentloaded", timeout=60000)
    cpage.wait_for_timeout(10000)
    settle(cpage)
    vtext = text(cpage)
    vsnap = crec.snapshot()
    out["video_text"] = vtext[:700]
    out["video_buttons"] = btns(cpage)
    has_video_el = cpage.evaluate("() => document.querySelectorAll('video').length")
    cpage.screenshot(path=os.path.join(SHOTS, "feat-05-video.png"), full_page=True)
    step(
        "video_interview_page",
        len(vtext) > 300,
        video_elements=has_video_el,
        failed=vsnap["failed_requests"][:3],
        preview=vtext[:250],
    )

    # --- Stripe checkout ---
    print("== Stripe / pricing ==")
    crec.reset()
    cpage.goto(STAGING + "/pricing", wait_until="domcontentloaded", timeout=60000)
    cpage.wait_for_timeout(6000)
    settle(cpage)
    pb = btns(cpage)
    out["pricing_buttons"] = pb
    cpage.screenshot(path=os.path.join(SHOTS, "feat-06-pricing.png"), full_page=True)
    upgrade = None
    for b in pb:
        if any(k in b.lower() for k in ("upgrade", "get pro", "subscribe", "choose", "start")):
            upgrade = b
            break
    if upgrade:
        crec.reset()
        cpage.get_by_role("button", name=upgrade, exact=False).first.click()
        cpage.wait_for_timeout(12000)
        snap = crec.snapshot()
        out["stripe_url"] = cpage.url
        out["stripe_api"] = [a for a in snap["api_calls"] if "POST" in a]
        cpage.screenshot(path=os.path.join(SHOTS, "feat-07-stripe.png"), full_page=True)
        on_stripe = "stripe.com" in cpage.url or "checkout" in cpage.url.lower()
        step(
            "stripe_checkout_opens",
            on_stripe,
            clicked=upgrade,
            url=cpage.url,
            api=out["stripe_api"][:3],
            failed=snap["failed_requests"][:2],
        )
    else:
        step("stripe_checkout_opens", False, reason="no upgrade button", buttons=pb[:12])

    # --- Transactional email: password reset ---
    print("== Email: password reset ==")
    ectx = new_context(pw, browser)
    epage = ectx.new_page()
    erec = Recorder(epage)
    epage.goto(STAGING + "/forgot-password", wait_until="domcontentloaded", timeout=60000)
    epage.wait_for_timeout(4000)
    erec.reset()
    try:
        epage.fill("#email", CAND_EMAIL)
    except Exception:
        epage.locator("input[type=email]").first.fill(CAND_EMAIL)
    epage.get_by_role("button", name="Send", exact=False).first.click()
    epage.wait_for_timeout(10000)
    esnap = erec.snapshot()
    out["reset_api"] = esnap["api_calls"]
    epage.screenshot(path=os.path.join(SHOTS, "feat-08-reset.png"), full_page=True)
    step(
        "password_reset_request",
        any("-> 20" in a for a in esnap["api_calls"]) and not esnap["failed_requests"],
        api=esnap["api_calls"][:3],
        failed=esnap["failed_requests"][:2],
        body=text(epage)[:250],
    )

    save_json("phase5-features.json", out)
    rctx.close()
    cctx.close()
    ectx.close()
    browser.close()

print("\nSummary:")
for s in out["steps"]:
    print(f"  {'PASS' if s['ok'] else 'FAIL'}  {s['step']}")
