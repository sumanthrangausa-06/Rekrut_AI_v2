"""Phase 6 - read-only smoke pass on production. No accounts created, no writes."""

import os
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qa_lib import PROD, Recorder, new_context, save_json, visit

PAGES = [
    ("/", "prod-01-home"),
    ("/pricing", "prod-02-pricing"),
    ("/about", "prod-03-about"),
    ("/contact", "prod-04-contact"),
    ("/blog", "prod-05-blog"),
    ("/terms", "prod-06-terms"),
    ("/privacy", "prod-07-privacy"),
    ("/login", "prod-08-login"),
    ("/register", "prod-09-register"),
    ("/recruiter-register", "prod-10-recruiter-register"),
    ("/forgot-password", "prod-11-forgot-password"),
    ("/admin/login", "prod-12-admin-login"),
    ("/this-route-does-not-exist", "prod-13-404"),
    ("/candidate/jobs", "prod-14-protected-redirect"),
]

out = {"env": PROD}
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])
    ctx = new_context(pw, browser)
    page = ctx.new_page()
    rec = Recorder(page)
    out["pages"] = [visit(page, rec, PROD, p, n) for p, n in PAGES]

    # Mobile spot-check
    mctx = browser.new_context(
        viewport={"width": 390, "height": 844},
        user_agent=(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
            "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        ),
        is_mobile=True,
        has_touch=True,
    )
    mpage = mctx.new_page()
    mrec = Recorder(mpage)
    out["mobile"] = [
        visit(mpage, mrec, PROD, p, "mobile-" + n)
        for p, n in [("/", "prod-home"), ("/pricing", "prod-pricing"), ("/login", "prod-login")]
    ]
    # Horizontal overflow is the classic mobile regression
    for m in out["mobile"]:
        pass
    out["mobile_overflow"] = mpage.evaluate(
        "() => ({scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth})"
    )
    mctx.close()
    ctx.close()
    browser.close()

broken = [p["name"] for p in out["pages"] if p.get("looks_broken")]
out["broken"] = broken
save_json("phase6-prod-smoke.json", out)
print(f"\nProd broken/suspect: {broken}")
print("Mobile overflow check:", out["mobile_overflow"])
print("404 route status:", [p["http_status"] for p in out["pages"] if p["name"] == "prod-13-404"])
