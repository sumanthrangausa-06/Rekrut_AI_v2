"""Shared harness for the 2026-08-08 end-to-end QA sweep.

Records console errors, failed network calls and stuck loading spinners for
every page visit so findings can be attached to GitHub issues as evidence.
"""

import json
import os
import re
import sys
import time
from datetime import datetime, timezone

from playwright.sync_api import TimeoutError as PWTimeout

# UI copy contains emoji; the Windows console defaults to cp1252 and would crash.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

STAGING = "https://rekrutai-staging.onrender.com"
PROD = "https://rekrutai.co"

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "screenshots")
RESULTS = os.path.join(HERE, "results")
os.makedirs(SHOTS, exist_ok=True)
os.makedirs(RESULTS, exist_ok=True)

# Analytics CSRF failures are a known, already-filed issue (#49). Tracked
# separately so they do not drown out new findings on every single page.
KNOWN_NOISE = re.compile(r"/api/analytics/events")


def stamp():
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def save_json(name, payload):
    path = os.path.join(RESULTS, name)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, default=str)
    return path


class Recorder:
    """Attaches listeners to a page and accumulates diagnostics."""

    def __init__(self, page):
        self.page = page
        self.console_errors = []
        self.page_errors = []
        self.failed = []
        self.api = []
        page.on("console", self._on_console)
        page.on("pageerror", self._on_pageerror)
        page.on("response", self._on_response)

    def _on_console(self, msg):
        if msg.type in ("error", "warning"):
            self.console_errors.append({"type": msg.type, "text": msg.text[:500]})

    def _on_pageerror(self, exc):
        self.page_errors.append(str(exc)[:500])

    def _on_response(self, resp):
        try:
            url = resp.url
            if "/api/" not in url:
                return
            entry = {"url": url, "status": resp.status, "method": resp.request.method}
            if resp.status >= 400:
                try:
                    entry["body"] = resp.text()[:400]
                except Exception:
                    entry["body"] = "<unreadable>"
                self.failed.append(entry)
            self.api.append(entry)
        except Exception:
            pass

    def reset(self):
        self.console_errors.clear()
        self.page_errors.clear()
        self.failed.clear()
        self.api.clear()

    def snapshot(self):
        real_failures = [f for f in self.failed if not KNOWN_NOISE.search(f["url"])]
        noise = [f for f in self.failed if KNOWN_NOISE.search(f["url"])]
        return {
            "console_errors": list(self.console_errors),
            "page_errors": list(self.page_errors),
            "failed_requests": real_failures,
            "analytics_csrf_failures": len(noise),
            "api_calls": [f"{a['method']} {a['url']} -> {a['status']}" for a in self.api],
        }


def settle(page, spinner_timeout=20000):
    """Wait for network + React render. Returns True if a spinner never cleared."""
    try:
        page.wait_for_load_state("networkidle", timeout=30000)
    except PWTimeout:
        pass
    spinner = page.locator(".animate-spin")
    try:
        if spinner.count() > 0:
            spinner.first.wait_for(state="detached", timeout=spinner_timeout)
    except PWTimeout:
        return True
    except Exception:
        pass
    page.wait_for_timeout(600)
    try:
        return page.locator(".animate-spin").count() > 0
    except Exception:
        return False


def page_summary(page):
    """Extract what a human would see: headings, visible text, error banners."""
    try:
        return page.evaluate(
            """() => {
            const txt = (document.body.innerText || '').trim();
            const heads = [...document.querySelectorAll('h1,h2')]
                .map(h => h.innerText.trim()).filter(Boolean).slice(0, 8);
            const errBanner = [...document.querySelectorAll('[role=alert],.text-destructive')]
                .map(e => e.innerText.trim()).filter(Boolean).slice(0, 5);
            const inputs = document.querySelectorAll('input,textarea,select').length;
            const buttons = [...document.querySelectorAll('button')]
                .map(b => b.innerText.trim()).filter(Boolean).slice(0, 25);
            const tables = document.querySelectorAll('table,[role=table]').length;
            return {
                text_len: txt.length,
                text_preview: txt.slice(0, 700),
                headings: heads,
                error_banners: errBanner,
                input_count: inputs,
                buttons: buttons,
                table_count: tables,
            };
        }"""
        )
    except Exception as exc:
        return {"error": str(exc)[:300]}


# Signals that a page rendered a shell but no real content.
EMPTY_MARKERS = ("something went wrong", "failed to load", "unable to load", "error loading")


def visit(page, rec, base, path, name, wait_ms=1200, shot=True):
    """Navigate to a route and capture a full diagnostic record."""
    rec.reset()
    url = base.rstrip("/") + path
    record = {"name": name, "path": path, "url": url}
    t0 = time.time()
    try:
        resp = page.goto(url, wait_until="domcontentloaded", timeout=60000)
        record["http_status"] = resp.status if resp else None
    except Exception as exc:
        record["nav_error"] = str(exc)[:300]
        record["http_status"] = None
    page.wait_for_timeout(wait_ms)
    record["spinner_stuck"] = settle(page)
    record["load_seconds"] = round(time.time() - t0, 2)
    record["final_url"] = page.url
    record["redirected"] = not page.url.rstrip("/").endswith(path.rstrip("/")) if path != "/" else False
    record.update(page_summary(page))
    record.update(rec.snapshot())

    body = (record.get("text_preview") or "").lower()
    record["looks_broken"] = bool(
        record.get("spinner_stuck")
        or record.get("page_errors")
        or record.get("text_len", 0) < 200
        or any(m in body for m in EMPTY_MARKERS)
    )

    if shot:
        fname = f"{name}.png"
        try:
            page.screenshot(path=os.path.join(SHOTS, fname), full_page=True)
            record["screenshot"] = fname
        except Exception:
            pass
    flag = "BROKEN" if record["looks_broken"] else "ok"
    print(
        f"  [{flag:6}] {name:38} {record.get('http_status')} "
        f"{record['load_seconds']}s spin={record['spinner_stuck']} "
        f"txt={record.get('text_len')} err={len(record.get('failed_requests', []))}"
    )
    return record


def register(page, rec, base, role, email, password, name, company=None):
    """Register through the real signup UI. role: 'candidate' | 'employer'."""
    rec.reset()
    page.goto(base + "/register", wait_until="domcontentloaded", timeout=60000)
    settle(page)
    page.select_option("#role", role)
    page.fill("#name", name)
    page.fill("#email", email)
    page.fill("#password", password)
    if role == "employer" and company:
        try:
            page.fill("#company", company)
        except Exception:
            pass
    t0 = time.time()
    page.click("button[type=submit]")
    landed = None
    for _ in range(60):
        page.wait_for_timeout(1000)
        if "/register" not in page.url:
            landed = page.url
            break
    elapsed = round(time.time() - t0, 2)
    settle(page)
    out = {
        "email": email,
        "role": role,
        "redirect_seconds": elapsed,
        "landed_on": landed or page.url,
        "still_on_register": "/register" in page.url,
    }
    out.update(rec.snapshot())
    page.screenshot(path=os.path.join(SHOTS, f"signup-{role}.png"), full_page=True)
    print(f"  register({role}) -> {out['landed_on']} in {elapsed}s")
    return out


def login(page, rec, base, email, password, tag="login"):
    rec.reset()
    page.goto(base + "/login", wait_until="domcontentloaded", timeout=60000)
    settle(page)
    page.fill("#email", email)
    page.fill("#password", password)
    t0 = time.time()
    page.click("button[type=submit]")
    landed = None
    for _ in range(60):
        page.wait_for_timeout(1000)
        if "/login" not in page.url:
            landed = page.url
            break
    elapsed = round(time.time() - t0, 2)
    settle(page)
    out = {
        "email": email,
        "redirect_seconds": elapsed,
        "landed_on": landed or page.url,
        "success": "/login" not in page.url,
    }
    out.update(rec.snapshot())
    print(f"  login({email}) -> {out['landed_on']} in {elapsed}s success={out['success']}")
    return out


def new_context(pw, browser, video_dir=None, permissions=None):
    ctx = browser.new_context(
        viewport={"width": 1440, "height": 900},
        permissions=permissions or [],
        record_video_dir=video_dir,
    )
    ctx.set_default_timeout(30000)
    return ctx
