# PRD — M2: Companies, Teams & RBAC

**State (verified, Scout §2): WORKS with drift.** **Surfaces:** `routes/company.js`, `departments.js`, `audit.js` · client: recruiter/company, team, join-requests, pending-approval.

## 1. Purpose & users
The employer's organisational home: company creation, team membership, departments, and the permission model every recruiter surface obeys. Users: company owner/admin, recruiters, hiring managers.

## 2. End-to-end journey
Employer registers (email/password, company-email domain enforced) → company created → invites team via `POST /api/company/team/invite` → recruiter joins → shared pipeline (M6) → departments organise larger teams (#139 hierarchy, built).

## 3. Current state (verified)
Company/team flows work. The role model has **drifted from any decision**: `users.role` CHECK (migration 047) allows `employer`, but the RBAC map (migration 128) has **no `employer` entry**; `recruiter` holds near-owner permissions; platform `admin` and company `owner` are conflated in places. This is #766 — open since 2026-10-11 with Rex's recommendations on file.

## 4. Gap to launch-ready
The gap is a **decision**, then a small migration: whichever model Sumanth rules must be true in both the CHECK constraint and the RBAC map, with existing users migrated and the invite flow's authority unambiguous (who may invite — under Rex's recommendation, only `owner`).

## 5. Functional requirements
- FR-M02-1: One role model, stated once, enforced in both the DB CHECK and the RBAC map; no unmappable role value may be creatable.
- FR-M02-2: Company-scope authorisation on team/company mutations must use the platform's object-authorisation convention (overview §5.1), not per-route improvisation.
- FR-M02-3: Existing `employer`-role users are migrated to the ruled model with an auditable migration; nobody loses company access silently.

## 6. Non-functional
- Security: permission changes are audit-logged (company audit surface exists).
- Privacy: team visibility stays inside the company boundary — no cross-company member discovery.

## 7. Dependencies (verified states)
M1 (registration/roles — exists) · M6 pipeline scoping (exists; its authorisation holes are Sprint 11 scope, not this module's).

## 8. Sprint 11 overlap
None directly; Sprint 11's M6 fixes assume today's scoping middleware (`requireCompanyOwnerOrRecruiter`) and must not be invalidated by a mid-sprint role migration — sequencing note for Lead.

## 9. ⚠ Unverified
How many live `employer`-role users exist (needs a DB read this environment cannot do); every place `admin` vs `owner` is conflated (Scout: "in places" — not enumerated).

## 10. ▣ DECISIONS FOR SUMANTH
- **D-M02-1 (#766): the role model.** Options on file since 2026-10-11 (Rex): (1) strip company-admin powers from `recruiter`; (2) retire `employer`, migrate those users → `owner`; (3) never conflate platform `admin` with company `owner`; (4) consequence to accept: only `owner` invites team members.
  **Rex's recommendation: adopt all four as one ruling.** The drift is already the de-facto product; leaving it undecided into launch means the first enterprise customer's security review finds it before we fix it.
