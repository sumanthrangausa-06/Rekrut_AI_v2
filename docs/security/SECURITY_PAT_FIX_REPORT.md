# 🚨 CRITICAL SECURITY REPORT: Exposed GitHub Personal Access Token (PAT)

**Repository:** `Rekrut_AI_v2` (`/root/.openclaw/workspace/Rekrut_AI_v2`)  
**GitHub:** `https://github.com/sumanthrangausa-06/Rekrut_AI_v2`  
**Date:** 2026-06-08  
**Severity:** 🔴 **CRITICAL**  
**Status:** Partially fixed locally — owner action required on GitHub

---

## 1. What Was Exposed

### Primary Exposure: GitHub PAT in Git Remote URL & Global Credential Store

A GitHub Personal Access Token (PAT) was **embedded directly in the git remote URL** and persisted in the **global git credential store**.

| Field | Details |
|-------|---------|
| **Token Prefix** | `[REDACTED]` *(full token masked)* |
| **Location 1** | `.git/config` → `remote "origin"` URL (`https://sumanthrangausa-06:[REDACTED]`) |
| **Location 2** | `~/.git-credentials` (global git credential store) |
| **GitHub User** | `sumanthrangausa-06` |
| **Repository** | `sumanthrangausa-06/Rekrut_AI_v2` |
| **Scope** | Local filesystem + global system credential store |

**Impact:** Anyone with filesystem access (or a copy of the repo) can read the token and impersonate the GitHub user with full PAT permissions.

---

### Secondary Exposure: Additional PAT in Git History (Committed Agent Logs)

A **second** GitHub PAT was discovered in **committed git history** inside Polsia AI agent debug logs.

| Field | Details |
|-------|---------|
| **Token Prefix** | `[REDACTED]` *(full token masked)* |
| **Location** | Committed `.claude.json` and agent session logs (`.jsonl`, `.txt`) |
| **Commits** | `c56e768`, `9677f33`, `439838f` (all on `main` branch) |
| **Source** | Polsia AI agent attempting `git push` with embedded credentials |
| **Impact** | **Permanent** — even if branch is deleted, token remains in git history forever |

**Affected files in commits:**
- `.claude.json`
- `.claude.json.backup.*`
- `debug/acccd4fb-d5b6-4d46-8c7b-d62f696bf06a.txt`
- `debug/sessions/*.jsonl`
- `debug/snapshots/*.sh`
- `projects/*/*.jsonl`
- `shell-snapshots/*.sh`
- `todos/*.json`

**Note:** This token was exposed when the agent tried to push code using `git push https://[REDACTED]` — the error message containing the full URL was captured in debug logs and subsequently committed to the repository.

---

## 2. What Was Fixed Locally

### Immediate Actions Taken

1. **Fixed Git Remote URL** — Switched from HTTPS with embedded credentials to SSH:
   ```bash
   git remote set-url origin git@github.com:sumanthrangausa-06/Rekrut_AI_v2.git
   ```
   **Before:** `https://sumanthrangausa-06:[REDACTED]`  
   **After:** `git@github.com:sumanthrangausa-06/Rekrut_AI_v2.git`

2. **Cleared Global Git Credential Store** — Removed the exposed token from `~/.git-credentials`:
   - File backed up to `~/.git-credentials.BACKUP_EXPOSED_<timestamp>`
   - Original file deleted

3. **Verified `.git/config` not in git history** — Confirmed `.git/config` was never committed to the repository.

4. **Searched working directory** — Performed `grep -r "[REDACTED]` across the entire working directory (excluding `.git/`) to identify all committed instances.

5. **Checked git logs and reflog** — Verified no token traces in `.git/logs/` or reflog entries.

---

## 3. What the Owner MUST Do on GitHub

### Step 1: Revoke BOTH Exposed Tokens IMMEDIATELY

1. Navigate to **GitHub Settings → Developer Settings → Personal Access Tokens → Tokens (classic)** or **Fine-grained tokens**
2. Locate and **revoke** the following tokens:
   - Token starting with `[REDACTED]` (the one in `.git/config` and `~/.git-credentials`)
   - Token starting with `[REDACTED]` (the one in committed git history)
3. **Do not reuse these tokens** — they are permanently compromised.

### Step 2: Generate a New Token (if still needed for HTTPS/CI)

1. Create a new **Fine-grained Personal Access Token** with **minimum required permissions only**:
   - **Contents:** Read-only (if only pulling)
   - **Contents:** Read and write (if pushing code)
   - **Limit to:** `sumanthrangausa-06/Rekrut_AI_v2` repository only
2. **Never embed the token in a remote URL.** Use one of these methods instead:
   - **SSH (Recommended):** `git@github.com:sumanthrangausa-06/Rekrut_AI_v2.git` *(already configured locally)*
   - **Git Credential Manager:** `git config --global credential.helper manager` (macOS/Windows) or `libsecret` (Linux)
   - **Environment variable:** `GITHUB_TOKEN` in CI/CD or local `.env` (not committed)
   - **GitHub CLI:** `gh auth login` (uses secure OAuth flow)

### Step 3: Audit GitHub Access Logs

1. Go to **GitHub Settings → Security Log** (for the user account)
2. Check for any unauthorized API access, repository clones, or unexpected actions between:
   - **2026-02-07** (when agent logs suggest first exposure) through **2026-06-08** (today)
3. Look for suspicious IP addresses, unknown devices, or unauthorized repo access.

### Step 4: Scan Git History for Additional Secrets (if repo is public or shared)

If this repository has been pushed to a public or shared remote, the `[REDACTED]` token is permanently in the git history. Consider:

- Running `git-filter-repo` or BFG Repo-Cleaner to purge the token from history (rewrites all commit hashes — disruptive for collaborators)
- Rotating the token (revoke + regenerate) is the **minimum** required action

---

## 4. Additional Instances Found in the Codebase

### Working Directory (excluding `.git/`)

| Token Prefix | File Path | Status |
|--------------|-----------|--------|
| `[REDACTED]` | `~/.git-credentials` | **Cleared** ✅ |
| `[REDACTED]` | `.git/config` → `remote.origin.url` | **Fixed to SSH** ✅ |
| `[REDACTED]` | `projects/-tmp-polsia-workspaces-.../acccd4fb-...jsonl` | **In committed history** ⚠️ |
| `[REDACTED]` | `.claude.json` (committed) | **In committed history** ⚠️ |
| `[REDACTED]` | `debug/acccd4fb-d5b6-...txt` (committed) | **In committed history** ⚠️ |

### Git History Search Results

- `git log --all --full-history -S "[REDACTED]` — **No matches** (primary token was NOT committed to history)
- `git log --all --full-history -S "[REDACTED]` — **3 commits found** (`c56e768`, `9677f33`, `439838f`) containing the secondary token

---

## 5. Root Cause Analysis

### How the Primary Token Got Exposed

1. Git was configured with `credential.helper = store` in `.git/config`
2. The `store` helper saves credentials in plaintext to `~/.git-credentials`
3. The remote URL was set to HTTPS with embedded credentials: `https://user:token@github.com/...`
4. This combination meant the token was stored in **two plaintext locations**: the remote URL and the global credential file

### How the Secondary Token Got Exposed

1. A Polsia AI agent attempted to push code using `git push https://[REDACTED]`
2. The push failed (likely due to authentication or permission issues)
3. The error message containing the full URL with the token was captured in agent debug logs (`.claude.json`, `.jsonl`, `.txt`)
4. These debug logs were **committed to the repository** as part of the agent's work, permanently embedding the token in git history

---

## 6. Recommendations for Preventing Future Leaks

### Immediate (Do Today)

1. **Revoke both tokens** on GitHub (see Section 3)
2. **Switch to SSH** for all local repositories (already done for this repo)
3. **Remove `credential.helper = store`** from all `.git/config` files — it stores passwords in plaintext
4. **Delete or `.gitignore` all agent debug logs** (`.claude.json`, `.jsonl`, `debug/`, `projects/` with agent logs) before committing

### Short-term (This Week)

1. **Install a secret scanner** in your pre-commit hooks:
   ```bash
   # Using detect-secrets
   pip install detect-secrets
   detect-secrets scan > .secrets.baseline
   detect-secrets audit .secrets.baseline
   
   # Or use git-secrets
   git secrets --install
   git secrets --register-aws
   ```

2. **Add `.gitignore` rules** to prevent agent logs and credential files from being committed:
   ```gitignore
   # Agent debug logs (contain sensitive memory & tokens)
   .claude.json
   .claude.json.backup*
   debug/
   debug/sessions/
   debug/snapshots/
   debug/agents/
   projects/
   shell-snapshots/
   todos/
   
   # Credentials
   .git-credentials
   .env
   .env.local
   .env.*.local
   ```

3. **Use GitHub's secret scanning** (free for public repos, available for private repos with GitHub Advanced Security)

4. **Never use `git push https://token@github.com/...`** — always use SSH or GitHub CLI (`gh auth login`)

### Long-term (Ongoing)

1. **Use GitHub Fine-grained PATs** with repository-scoped permissions instead of classic PATs
2. **Rotate tokens every 90 days** or upon any suspicion of exposure
3. **Use a password manager** or GitHub CLI for authentication instead of storing tokens in files
4. **Review CI/CD secrets** — if tokens are used in GitHub Actions, store them as encrypted secrets (Settings → Secrets and variables → Actions), never in `.env` files or code
5. **Enable 2FA on the GitHub account** to prevent unauthorized access even if a token is compromised
6. **Consider git-secrets or TruffleHog** in CI pipelines to catch secrets before merge

---

## 7. Checklist for Owner

- [ ] **Revoke** `[REDACTED]` on GitHub
- [ ] **Revoke** `[REDACTED]` on GitHub
- [ ] **Generate new token** (if needed) with Fine-grained permissions
- [ ] **Switch to SSH** for all local repos (already done for this one)
- [ ] **Remove** `credential.helper = store` from `.git/config`
- [ ] **Check GitHub Security Log** for unauthorized access (2026-02-07 to 2026-06-08)
- [ ] **Review** if repo is public or shared — if so, consider history rewriting for the `[REDACTED]` token
- [ ] **Install** secret scanning pre-commit hooks
- [ ] **Add `.gitignore`** for agent debug logs and credential files
- [ ] **Enable 2FA** on GitHub account if not already active

---

*Report generated by Application Security Engineer on 2026-06-08.*  
*No commits were made to the repository. Only local configuration changes were applied (git remote URL + global credential cleanup).*
