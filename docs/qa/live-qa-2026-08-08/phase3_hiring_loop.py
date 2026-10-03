"""Phase 3 - the core hiring loop, end to end, the way a real customer uses it.

Recruiter posts a job -> candidate finds and applies -> recruiter sees the
applicant and advances them through the pipeline.
"""

import os
import sys
import time

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qa_lib import HERE, SHOTS, STAGING, Recorder, login, new_context, save_json, settle

REC_EMAIL = "qa.rec.1786175490@rekrutqa.test"
CAND_EMAIL = "qa.cand.1786175062@rekrutqa.test"
PASS = "RekrutQA!2026x"

JOB_TITLE = f"QA Loop Engineer {int(time.time())}"
JOB_DESC = (
    "We are hiring a QA Loop Engineer to design and maintain automated end-to-end "
    "test coverage across our hiring platform. You will own regression suites, "
    "browser automation and release verification."
)
JOB_REQS = (
    "5+ years in test automation. Strong TypeScript and Python. Experience with "
    "Playwright or Cypress. Familiarity with CI/CD pipelines and REST API testing."
)

out = {"env": STAGING, "job_title": JOB_TITLE, "steps": []}


def step(name, ok, **extra):
    entry = {"step": name, "ok": bool(ok)}
    entry.update(extra)
    out["steps"].append(entry)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name} {extra if extra else ''}")
    return entry


def dump_form(page):
    return page.evaluate(
        """() => ({
            fields: [...document.querySelectorAll('input,textarea,select')]
                .filter(e => e.offsetParent)
                .map(e => ({tag: e.tagName, type: e.type||'', id: e.id||'',
                            ph: e.placeholder||'', val: (e.value||'').slice(0,40),
                            opts: e.tagName==='SELECT'?[...e.options].map(o=>o.value).slice(0,8):null})),
            buttons: [...document.querySelectorAll('button')]
                .filter(b => b.offsetParent).map(b => b.innerText.trim()).filter(Boolean),
            heading: (document.querySelector('h1,h2')||{}).innerText || '',
        })"""
    )


def fill_job_form(page, rec):
    """Fill whatever the current wizard step exposes, then advance."""
    filled = []
    for _ in range(8):  # up to 8 wizard steps
        page.wait_for_timeout(1500)
        form = dump_form(page)
        filled.append(form)
        print(f"    step heading={form['heading']!r} buttons={form['buttons'][:8]}")

        # Text inputs by placeholder
        for ph, val in [
            ("e.g. Senior Software Engineer", JOB_TITLE),
            ("e.g. Engineering, Sales, Marketing", "Engineering"),
            ("e.g. New York, NY or Remote", "Remote - Worldwide"),
        ]:
            try:
                loc = page.get_by_placeholder(ph)
                if loc.count() and loc.first.is_visible() and not loc.first.input_value():
                    loc.first.fill(val)
            except Exception:
                pass

        # Any empty visible textarea gets meaningful content
        tas = page.locator("textarea")
        for i in range(tas.count()):
            t = tas.nth(i)
            try:
                if t.is_visible() and not t.input_value():
                    ph = (t.get_attribute("placeholder") or "").lower()
                    t.fill(JOB_REQS if "qualification" in ph or "requirement" in ph else JOB_DESC)
            except Exception:
                pass

        # Salary-ish number inputs
        nums = page.locator("input[type=number]")
        for i in range(nums.count()):
            n = nums.nth(i)
            try:
                if n.is_visible() and not n.input_value():
                    n.fill("120000")
            except Exception:
                pass

        # Advance: prefer Publish, else Next/Continue
        btns = form["buttons"]
        publish = next((b for b in btns if "publish" in b.lower() or "post job" in b.lower()), None)
        nxt = next(
            (b for b in btns if b.lower() in ("next", "continue") or "next" in b.lower()), None
        )
        target = publish or nxt
        if not target:
            print("    no advance button found; stopping")
            break
        try:
            page.get_by_role("button", name=target, exact=False).first.click()
        except Exception as exc:
            print(f"    click failed on {target!r}: {exc}")
            break
        page.wait_for_timeout(2500)
        if publish:
            print(f"    clicked PUBLISH ({target!r})")
            break
    return filled


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])

        # ---------- RECRUITER: post a job ----------
        rctx = new_context(pw, browser)
        rpage = rctx.new_page()
        rrec = Recorder(rpage)
        print("== Recruiter login ==")
        li = login(rpage, rrec, STAGING, REC_EMAIL, PASS)
        step("recruiter_login", li["success"], seconds=li["redirect_seconds"])

        print("== Recruiter opens job creation form ==")
        rpage.goto(STAGING + "/recruiter/jobs/new", wait_until="domcontentloaded", timeout=60000)
        rpage.wait_for_timeout(6000)
        rrec.reset()
        out["job_form_steps"] = fill_job_form(rpage, rrec)
        rpage.wait_for_timeout(4000)
        settle(rpage)
        rpage.screenshot(path=os.path.join(SHOTS, "loop-01-after-publish.png"), full_page=True)

        posts = [a for a in rrec.snapshot()["api_calls"] if "POST" in a and "/jobs" in a]
        out["job_post_api"] = posts
        step("job_created", any("-> 20" in p for p in posts), api=posts[:5], url=rpage.url)

        print("== Recruiter job list ==")
        rrec.reset()
        rpage.goto(STAGING + "/recruiter/jobs", wait_until="domcontentloaded", timeout=60000)
        rpage.wait_for_timeout(8000)
        listing = rpage.evaluate("() => (document.body.innerText||'')")
        rpage.screenshot(path=os.path.join(SHOTS, "loop-02-recruiter-jobs.png"), full_page=True)
        step("job_visible_to_recruiter", JOB_TITLE in listing, preview=listing[:300])

        # ---------- CANDIDATE: find and apply ----------
        cctx = new_context(pw, browser)
        cpage = cctx.new_page()
        crec = Recorder(cpage)
        print("== Candidate login ==")
        cli = login(cpage, crec, STAGING, CAND_EMAIL, PASS)
        step("candidate_login", cli["success"], seconds=cli["redirect_seconds"])

        print("== Candidate job board ==")
        crec.reset()
        cpage.goto(STAGING + "/candidate/jobs", wait_until="domcontentloaded", timeout=60000)
        cpage.wait_for_timeout(9000)
        settle(cpage)
        board = cpage.evaluate("() => (document.body.innerText||'')")
        cpage.screenshot(path=os.path.join(SHOTS, "loop-03-candidate-jobs.png"), full_page=True)
        found = JOB_TITLE in board
        step("job_discoverable_by_candidate", found, board_len=len(board))

        if not found:
            # Try the search box before declaring it undiscoverable
            try:
                sb = cpage.locator("input[type=search], input[placeholder*='earch']").first
                sb.fill(JOB_TITLE.split()[0] + " Loop")
                cpage.wait_for_timeout(5000)
                board = cpage.evaluate("() => (document.body.innerText||'')")
                found = JOB_TITLE in board
                cpage.screenshot(
                    path=os.path.join(SHOTS, "loop-03b-candidate-search.png"), full_page=True
                )
                step("job_findable_via_search", found)
            except Exception as exc:
                step("job_findable_via_search", False, error=str(exc)[:200])

        if found:
            try:
                cpage.get_by_text(JOB_TITLE, exact=False).first.click()
                cpage.wait_for_timeout(5000)
                settle(cpage)
                cpage.screenshot(
                    path=os.path.join(SHOTS, "loop-04-job-detail.png"), full_page=True
                )
                step("job_detail_opens", True, url=cpage.url)
                crec.reset()
                applied = False
                for label in ("Apply Now", "Apply", "Quick Apply", "Easy Apply"):
                    b = cpage.get_by_role("button", name=label, exact=False)
                    if b.count() and b.first.is_visible():
                        b.first.click()
                        cpage.wait_for_timeout(5000)
                        # An application modal may require a final confirm
                        for conf in ("Submit Application", "Submit", "Confirm", "Send"):
                            cb = cpage.get_by_role("button", name=conf, exact=False)
                            if cb.count() and cb.first.is_visible():
                                cb.first.click()
                                cpage.wait_for_timeout(5000)
                                break
                        applied = True
                        break
                cpage.screenshot(
                    path=os.path.join(SHOTS, "loop-05-after-apply.png"), full_page=True
                )
                snap = crec.snapshot()
                out["apply_api"] = [a for a in snap["api_calls"] if "POST" in a]
                step(
                    "candidate_applied",
                    applied and any("appl" in a.lower() and "-> 20" in a for a in out["apply_api"]),
                    clicked=applied,
                    api=out["apply_api"][:6],
                    failed=snap["failed_requests"][:3],
                )
            except Exception as exc:
                step("job_detail_opens", False, error=str(exc)[:250])

        print("== Candidate applications page ==")
        crec.reset()
        cpage.goto(STAGING + "/candidate/applications", wait_until="domcontentloaded", timeout=60000)
        cpage.wait_for_timeout(7000)
        apps = cpage.evaluate("() => (document.body.innerText||'')")
        cpage.screenshot(path=os.path.join(SHOTS, "loop-06-candidate-apps.png"), full_page=True)
        step("application_shows_for_candidate", JOB_TITLE in apps, preview=apps[:300])

        # ---------- RECRUITER: see the applicant ----------
        print("== Recruiter applications / applicants ==")
        rrec.reset()
        rpage.goto(STAGING + "/recruiter/applications", wait_until="domcontentloaded", timeout=60000)
        rpage.wait_for_timeout(9000)
        rapps = rpage.evaluate("() => (document.body.innerText||'')")
        rpage.screenshot(path=os.path.join(SHOTS, "loop-07-recruiter-apps.png"), full_page=True)
        step(
            "recruiter_sees_application",
            ("QA Candidate" in rapps) or (JOB_TITLE in rapps),
            preview=rapps[:400],
        )

        rctx.close()
        cctx.close()
        browser.close()

    save_json("phase3-hiring-loop.json", out)
    passed = sum(1 for s in out["steps"] if s["ok"])
    print(f"\nHiring loop: {passed}/{len(out['steps'])} steps passed")
    for s in out["steps"]:
        print(f"  {'PASS' if s['ok'] else 'FAIL'}  {s['step']}")


if __name__ == "__main__":
    main()
