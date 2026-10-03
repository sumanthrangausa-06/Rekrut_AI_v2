"""Dump the real DOM structure of the recruiter job-creation form."""

import json
import os
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qa_lib import HERE, STAGING, Recorder, new_context, save_json, settle

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    ctx = browser.new_context(
        viewport={"width": 1440, "height": 1200},
        storage_state=os.path.join(HERE, "recruiter-auth.json"),
    )
    page = ctx.new_page()
    Recorder(page)
    page.goto(STAGING + "/recruiter/jobs/new", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(6000)

    fields = page.evaluate(
        """() => [...document.querySelectorAll('input,textarea,select')].map((e,i) => ({
            i, tag: e.tagName, type: e.type||'', id: e.id||'', name: e.name||'',
            placeholder: e.placeholder||'',
            label: (document.querySelector(`label[for="${e.id}"]`)||{}).innerText||'',
            options: e.tagName==='SELECT' ? [...e.options].map(o=>o.value).slice(0,10) : undefined,
            visible: !!(e.offsetParent),
        }))"""
    )
    buttons = page.evaluate(
        """() => [...document.querySelectorAll('button')].map(b => ({
            text: b.innerText.trim(), type: b.type, visible: !!(b.offsetParent)
        })).filter(b => b.text)"""
    )
    steps = page.evaluate(
        "() => (document.body.innerText||'').slice(0, 1500)"
    )
    save_json("jobform-structure.json", {"fields": fields, "buttons": buttons, "text": steps})
    print(json.dumps([f for f in fields if f["visible"]], indent=1)[:3000])
    print("BUTTONS:", json.dumps([b for b in buttons if b["visible"]]))
    page.screenshot(path=os.path.join(HERE, "screenshots", "jobform-step1.png"), full_page=True)
    ctx.close()
    browser.close()
