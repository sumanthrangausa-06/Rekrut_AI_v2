# Rekrut AI Security Runbook

> **Purpose:** Operational guide for maintaining secure credentials, secret rotation, and verifying the absence of default passwords across the Rekrut AI codebase.
>
> **Owner:** Application Security / Platform Engineering
> **Last Updated:** 2026-08-07

---

## Table of Contents

1. [Password Policy](#1-password-policy)
2. [Setting Admin Password Securely](#2-setting-admin-password-securely)
3. [Generating Strong Secrets](#3-generating-strong-secrets)
4. [Rotating Secrets](#4-rotating-secrets)
5. [Verification Checklist](#5-verification-checklist)
6. [Incident Response: Credential Exposure](#6-incident-response-credential-exposure)

---

## 1. Password Policy

### Admin Password (Critical)

The admin panel **will refuse to start** if `ADMIN_PASSWORD` is missing or does not meet the following requirements:

| Requirement | Minimum |
|-------------|---------|
| Length | 8 characters |
| Uppercase letter | At least 1 (`A–Z`) |
| Lowercase letter | At least 1 (`a–z`) |
| Digit | At least 1 (`0–9`) |
| Special symbol | At least 1 (`!@#$%^&*...`) |
| Maximum length | 128 characters |

**Example valid admin password:** `Rekrut$2026!Admin`

### Regular User Password

Users registering via the public API must provide a password with:

| Requirement | Minimum |
|-------------|---------|
| Length | 8 characters |
| Maximum length | 128 characters |

> **Note:** Password reset and registration endpoints enforce role-aware validation. Admin users are held to the stronger policy; regular users (candidate, employer) are held to the minimum-length policy.

---

## 2. Setting Admin Password Securely

### Local Development

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Generate a strong admin password:
   ```bash
   node -e "console.log(require('crypto').randomBytes(16).toString('hex') + '!A1')"
   ```

3. Set the value in `.env`:
   ```bash
   ADMIN_PASSWORD=YOUR_GENERATED_VALUE_HERE
   ```

4. Start the server. It will **fail fast** with a clear error if `ADMIN_PASSWORD` is missing or weak.

### Production / Render

- `ADMIN_PASSWORD` is configured via Render dashboard with `sync: false` (never committed to git).
- The production service will crash-loop on startup if the variable is missing, making the misconfiguration immediately visible in logs.

### CI / GitHub Actions

The CI workflow generates ephemeral secrets at runtime:

```yaml
- name: Generate test secrets
  run: |
    echo "JWT_SECRET=$(openssl rand -hex 64)" >> $GITHUB_ENV
    echo "SESSION_SECRET=$(openssl rand -hex 64)" >> $GITHUB_ENV
    echo "ADMIN_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 16)!A1" >> $GITHUB_ENV
```

**Do NOT** hardcode `ADMIN_PASSWORD`, `JWT_SECRET`, or `SESSION_SECRET` in `.github/workflows/ci.yml`.

---

## 3. Generating Strong Secrets

### JWT Secret & Session Secret

Generate a 128-character hex string (64 bytes):

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Or using OpenSSL:

```bash
openssl rand -hex 64
```

### Database Password

If managing PostgreSQL credentials manually:

```bash
openssl rand -base64 24
```

### Stripe Webhook Secret

Use the Stripe CLI or Dashboard to generate a real secret. Never invent one:

```bash
stripe listen --print-secret
```

---

## 4. Rotating Secrets

### When to Rotate

| Trigger | Action |
|---------|--------|
| Suspected credential leak | Rotate **all** secrets immediately |
| Employee with access leaves | Rotate admin password and any shared API keys |
| Quarterly security review | Rotate JWT/Session secrets as routine hygiene |
| After security incident | Full rotation of all secrets |

### Rotation Procedure

#### 1. JWT & Session Secrets

1. Generate new secrets (see Section 3).
2. Update the environment variable in your deployment platform (Render dashboard, `.env` file, etc.).
3. **Do NOT** restart all instances simultaneously if you have multiple pods — this would invalidate all active sessions. Use a rolling restart or accept a brief logout window.
4. All existing user sessions will be invalidated and users must log in again.

#### 2. Admin Password

1. Generate a new strong password.
2. Update `ADMIN_PASSWORD` in the environment.
3. Restart the application.
4. Verify you can log in to `/admin` with the new password.
5. Delete any password manager entries containing the old password.

#### 3. Database Credentials

1. Create a new database user/role with identical permissions.
2. Update `DATABASE_URL` to use the new credentials.
3. Restart the application and verify health checks pass.
4. Revoke the old database user's access after confirming stability.

#### 4. Third-Party API Keys (Stripe, OpenAI, etc.)

1. Generate new keys in the provider dashboard.
2. Update environment variables.
3. Restart application.
4. Revoke old keys in the provider dashboard after 24 hours of stability.

---

## 5. Verification Checklist

Run this checklist after any deployment, credential change, or quarterly security review.

### ☐ Source Code Scan

```bash
# Search for hardcoded passwords across source, tests, and docs
grep -rnE "password.*['\"](Test|test|123|admin|changeme|pass|password)" \
  --include="*.js" --include="*.ts" --include="*.md" --include="*.json" \
  . 2>/dev/null | grep -v node_modules | grep -v ".git/" | grep -v "e2e-reports" | grep -v "test-results"
```

**Expected result:** Zero matches (except documentation discussing weak-password examples, which must use placeholders like `YOUR_STRONG_PASSWORD_HERE`).

### ☐ Environment File Audit

```bash
grep -E "(PASSWORD|SECRET|KEY)=" .env .env.example
```

**Expected result:**
- `.env` must NOT be committed to git (verify `.gitignore` includes `.env`).
- `.env.example` must contain only placeholder values (`YOUR_..._HERE`, `change...`).
- No real secrets in `.env.example`.

### ☐ Admin Startup Behavior

1. Unset `ADMIN_PASSWORD`:
   ```bash
   unset ADMIN_PASSWORD
   npm start
   ```
2. **Expected:** Server crashes immediately with:
   ```
   Error: ADMIN_PASSWORD environment variable is required.
   ```
3. Set a weak password (`ADMIN_PASSWORD=weak`):
   ```bash
   ADMIN_PASSWORD=weak npm start
   ```
4. **Expected:** Server crashes with:
   ```
   Error: ADMIN_PASSWORD does not meet strength requirements.
   ```

### ☐ Password Policy Enforcement

Test the registration endpoint:

```bash
# Should FAIL — too short
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"short","name":"Test","role":"candidate"}'

# Should SUCCEED — meets minimum policy
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test2@example.com","password":"ValidPass1!","name":"Test","role":"candidate"}'
```

### ☐ CI Workflow Verification

Open `.github/workflows/ci.yml` and confirm:
- [ ] No literal `JWT_SECRET: test-jwt-secret` or similar hardcoded values.
- [ ] Secrets are generated dynamically via a workflow step or referenced from `secrets.*`.
- [ ] `ADMIN_PASSWORD` meets the strong policy if hardcoded for any reason (should not be).

### ☐ Render Config Verification

Open `render.yaml` and confirm:
- [ ] Sensitive keys use `sync: false` or `generateValue: true`.
- [ ] No plaintext passwords, secrets, or API keys in the YAML.

### ☐ Secret Leak Scan (Optional but Recommended)

```bash
# Using truffleHog
truffleHog filesystem . --only-verified

# Or using gitLeaks
gitleaks detect --verbose
```

---

## 6. Incident Response: Credential Exposure

If you suspect any credential has been exposed (committed to git, logged, shared, etc.):

1. **Rotate immediately** — follow Section 4 for the exposed credential.
2. **Audit access** — check application logs for unauthorized use of the exposed credential.
3. **Scan repository history** — ensure the credential is not in git history:
   ```bash
   git log --all --full-history -- .env
   ```
4. **If committed to git:**
   - Rotate the credential (changing it is faster and safer than rewriting history).
   - Consider using [BFG Repo-Cleaner](https://rtyley.github.io/bfg-repo-cleaner/) or `git filter-repo` to scrub history for high-severity secrets.
5. **Document** — record the incident, root cause, and remediation in your security log.

---

## Appendix: Quick Reference Commands

```bash
# Generate admin password
cat /dev/urandom | tr -dc 'a-zA-Z0-9!@#$%^&*' | head -c 24; echo

# Generate JWT/Session secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Scan for hardcoded credentials
grep -rnE "password.*['\"].{4,}['\"]" --include="*.js" --include="*.ts" . | grep -v node_modules

# Verify .env is gitignored
git check-ignore .env
```
