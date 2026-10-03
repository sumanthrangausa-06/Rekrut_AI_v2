"""Re-test with known-good owner account that has company_id set"""
import requests

BASE = "https://rekrutai-staging.onrender.com"

r = requests.post(f"{BASE}/api/auth/login",
    json={"email": "qa.owner.1786410000@qarecruit.io", "password": "QaStagingOwner!2026"},
    headers={"X-CSRF-Token": "test"}, timeout=20)
print(f"Owner login: {r.status_code}")
if r.status_code == 200:
    tok = r.json().get("token")
    h = {"Authorization": f"Bearer {tok}"}
    print(f"Token: {tok[:30]}...")

    for label, path in [
        ("#157 team/members",    "/api/company/team/members"),
        ("#154 join-requests",   "/api/company/join-requests"),
        ("#156 audit-log",       "/api/company/audit-log"),
        ("#155 notifications",   "/api/notifications"),
        ("#155 unread-count",    "/api/notifications/unread-count"),
    ]:
        r2 = requests.get(f"{BASE}{path}", headers=h, timeout=20)
        status = "PASS" if r2.status_code == 200 else "FAIL"
        print(f"  [{status}] {label}: {r2.status_code} {r2.text[:120]}")

    # suspend endpoint (should return 404 for non-existent member, NOT 404 for missing route)
    r3 = requests.post(f"{BASE}/api/company/team/members/9999/suspend",
        json={"reason": "QA test"}, headers=h, timeout=20)
    exists = r3.status_code != 404 or "Member not found" in r3.text
    print(f"  [{'PASS' if exists else 'FAIL'}] #157 suspend-endpoint: {r3.status_code} {r3.text[:100]}")

    # reinstate endpoint
    r4 = requests.post(f"{BASE}/api/company/team/members/9999/reinstate",
        headers=h, timeout=20)
    exists4 = r4.status_code != 404 or "Member not found" in r4.text
    print(f"  [{'PASS' if exists4 else 'FAIL'}] #157 reinstate-endpoint: {r4.status_code} {r4.text[:100]}")
else:
    print(r.text[:200])

# Also test LinkedIn import with candidate token
cand_r = requests.post(f"{BASE}/api/auth/login",
    json={"email": "qa.cand.1786410000@proton.me", "password": "QaStagingCand!2026"},
    headers={"X-CSRF-Token": "test"}, timeout=20)
print(f"\nCandidate login: {cand_r.status_code}")
if cand_r.status_code == 200:
    ctok = cand_r.json().get("token")
    ch = {"Authorization": f"Bearer {ctok}"}
    r5 = requests.post(f"{BASE}/api/candidate/linkedin/import",
        json={"linkedin_url": "https://linkedin.com/in/test"},
        headers={**ch, "Content-Type": "application/json"}, timeout=20)
    print(f"  [{'PASS' if r5.status_code != 404 else 'FAIL'}] #165 linkedin/import: {r5.status_code} {r5.text[:120]}")
