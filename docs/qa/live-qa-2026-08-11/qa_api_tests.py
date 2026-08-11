"""
QA API test script for 12 ready-for-qa issues
Tests DB migrations, endpoints, and cron fixes
"""
import requests, json, time, sys

BASE = "https://rekrutai-staging.onrender.com"
TS   = str(int(time.time()))
CAND_EMAIL = f"qa.api.{TS}@mailtest.dev"
CAND_PW    = "QaStagingApi!2026"
EMP_EMAIL  = f"qa.emp.{TS}@qarecruit.io"
EMP_PW     = "QaStagingApi!2026"

results = {}

def check(issue, label, ok, detail):
    status = "PASS" if ok else "FAIL"
    results[f"#{issue} {label}"] = {"ok": ok, "detail": detail}
    print(f"  [{status}] #{issue} {label} — {detail[:110]}")

def api(method, path, **kwargs):
    try:
        r = getattr(requests, method)(f"{BASE}{path}", timeout=20, **kwargs)
        return r
    except Exception as e:
        class Err:
            status_code = 0
            text = str(e)
            def json(self): raise ValueError("no json")
        return Err()

# ── Wake ──
print("Waking staging...")
r = api("get", "/api/health")
print(f"  Health: {r.status_code} {r.text[:60]}")

# ── Login as candidate (pre-registered from live QA) ──
CAND_TOKEN = None
cand_email_existing = f"qa.cand.1786410000@proton.me"
r = api("post", "/api/auth/login",
        json={"email": cand_email_existing, "password": "QaStagingCand!2026"},
        headers={"X-CSRF-Token": "test"})
if r.status_code == 200:
    CAND_TOKEN = r.json().get("token")
    print(f"  Candidate login OK, token={CAND_TOKEN[:20] if CAND_TOKEN else 'none'}...")
else:
    print(f"  Candidate login failed: {r.status_code} {r.text[:80]}")

cand_headers = {"Authorization": f"Bearer {CAND_TOKEN}"} if CAND_TOKEN else {}

# ── Register + login as employer ──
EMP_TOKEN = None
r = api("post", "/api/auth/register",
        json={"name": "QA Emp API", "email": EMP_EMAIL, "password": EMP_PW,
              "role": "employer", "company_name": "QA Recruit IO"},
        headers={"X-CSRF-Token": "test"})
if r.status_code in (200, 201):
    EMP_TOKEN = r.json().get("token")
    print(f"  Employer register OK")
else:
    # try login in case already registered
    r2 = api("post", "/api/auth/login",
             json={"email": EMP_EMAIL, "password": EMP_PW},
             headers={"X-CSRF-Token": "test"})
    if r2.status_code == 200:
        EMP_TOKEN = r2.json().get("token")
        print(f"  Employer login OK (already registered)")
    else:
        print(f"  Employer register/login failed: {r.status_code} {r.text[:80]}")

emp_headers = {"Authorization": f"Bearer {EMP_TOKEN}"} if EMP_TOKEN else {}

print()

# ════════════════════════════════════════════════════════════
# ISSUE #162 — migrate.js .sql fix
# Verify that previously-skipped .sql migrations ran:
#   migrations/069_in_app_notifications → user_notifications table
#   migrations/2026-08-11-add-user-suspended-at → suspended_at column
#   migrations/070_audit_logs → audit_logs table
# ════════════════════════════════════════════════════════════
print("== #162 migrate.js .sql fix ==")

# Check: /api/team/members no longer 500 (was 500 due to missing suspended_at)
r = api("get", "/api/company/team/members", headers=emp_headers)
check(162, "team/members not 500", r.status_code != 500,
      f"status={r.status_code} body={r.text[:80]}")

# Check: notifications endpoints exist (table created by 069_in_app_notifications)
r = api("get", "/api/notifications", headers=emp_headers)
check(162, "notifications endpoint exists (not 404)", r.status_code != 404,
      f"status={r.status_code} body={r.text[:80]}")

# Check: audit_logs endpoint exists (table from 070_audit_logs)
r = api("get", "/api/company/audit-log", headers=emp_headers)
check(162, "audit-log endpoint exists (not 500)", r.status_code not in (500, 404),
      f"status={r.status_code} body={r.text[:80]}")

print()

# ════════════════════════════════════════════════════════════
# ISSUE #157 — Suspend team members
# ════════════════════════════════════════════════════════════
print("== #157 Suspend team members ==")

r = api("get", "/api/company/team/members", headers=emp_headers)
check(157, "GET /team/members returns 200", r.status_code == 200,
      f"status={r.status_code} body={r.text[:120]}")

if r.status_code == 200:
    data = r.json() if r.status_code == 200 else {}
    members = data if isinstance(data, list) else data.get("members", data.get("data", []))
    check(157, "team/members response is list", isinstance(members, list),
          f"type={type(members).__name__} count={len(members) if isinstance(members, list) else '?'}")
    # Check suspend endpoint
    r2 = api("post", "/api/company/team/members/9999/suspend",
             json={"reason": "QA test"}, headers=emp_headers)
    check(157, "suspend endpoint exists (not 404)", r2.status_code != 404,
          f"status={r2.status_code} body={r2.text[:80]}")

print()

# ════════════════════════════════════════════════════════════
# ISSUE #155 + #153 — Notifications endpoints  
# ════════════════════════════════════════════════════════════
print("== #155 In-app notifications ==")

r = api("get", "/api/notifications", headers=emp_headers)
check(155, "GET /api/notifications returns 200", r.status_code == 200,
      f"status={r.status_code} body={r.text[:100]}")

r = api("get", "/api/notifications/unread-count", headers=emp_headers)
check(155, "GET /api/notifications/unread-count returns 200", r.status_code == 200,
      f"status={r.status_code} body={r.text[:80]}")

print()

# ════════════════════════════════════════════════════════════
# ISSUE #154 — Join requests (route-ordering fix)
# ════════════════════════════════════════════════════════════
print("== #154 Join-requests queue ==")

r = api("get", "/api/company/join-requests", headers=emp_headers)
check(154, "GET /company/join-requests not 404", r.status_code != 404,
      f"status={r.status_code} body={r.text[:120]}")
check(154, "GET /company/join-requests returns 200", r.status_code == 200,
      f"status={r.status_code} body={r.text[:120]}")

print()

# ════════════════════════════════════════════════════════════
# ISSUE #156 — Audit log
# ════════════════════════════════════════════════════════════
print("== #156 Audit log ==")

r = api("get", "/api/company/audit-log", headers=emp_headers)
check(156, "GET /company/audit-log returns 200", r.status_code == 200,
      f"status={r.status_code} body={r.text[:120]}")

print()

# ════════════════════════════════════════════════════════════
# ISSUE #163 — Interview reminder cron fix
# ════════════════════════════════════════════════════════════
print("== #163 Interview reminder cron ==")

# Test that the cron query doesn't 500 (now queries scheduled_interviews)
r = api("get", "/api/interviews", headers=cand_headers)
check(163, "GET /api/interviews not 500", r.status_code not in (500,),
      f"status={r.status_code} body={r.text[:80]}")

# Check scheduled_interviews endpoint
r2 = api("get", "/api/candidate/interviews", headers=cand_headers)
check(163, "GET /candidate/interviews not 500", r2.status_code not in (500,),
      f"status={r2.status_code} body={r2.text[:80]}")

print()

# ════════════════════════════════════════════════════════════
# ISSUE #164 — Admin endpoints
# ════════════════════════════════════════════════════════════
print("== #164 Admin endpoints ==")

for path in ["/api/admin/analytics", "/api/admin/agents/runs", "/api/admin/agents/stats"]:
    r = api("get", path)
    # Should return 401 (route exists, auth required) not 404 (route missing)
    check(164, f"{path} returns 401 not 404", r.status_code == 401,
          f"status={r.status_code} body={r.text[:80]}")

print()

# ════════════════════════════════════════════════════════════
# ISSUE #165 — LinkedIn import endpoint
# ════════════════════════════════════════════════════════════
print("== #165 LinkedIn import endpoint ==")

r = api("post", "/api/candidate/linkedin/import",
        json={"linkedin_url": "https://linkedin.com/in/test"},
        headers={**cand_headers, "Content-Type": "application/json"})
check(165, "POST /candidate/linkedin/import exists (not 404)", r.status_code != 404,
      f"status={r.status_code} body={r.text[:120]}")

print()

# Print summary
print("=" * 60)
passes = [k for k, v in results.items() if v["ok"]]
fails  = [k for k, v in results.items() if not v["ok"]]
print(f"TOTAL: {len(passes)}/{len(results)} pass  {len(fails)} fail")
print()
if fails:
    print("FAILURES:")
    for k in fails:
        print(f"  FAIL {k}: {results[k]['detail'][:100]}")

# Save
with open("docs/qa/live-qa-2026-08-11/qa_api_results.json", "w") as f:
    json.dump(results, f, indent=2)
print("\nResults saved to qa_api_results.json")
