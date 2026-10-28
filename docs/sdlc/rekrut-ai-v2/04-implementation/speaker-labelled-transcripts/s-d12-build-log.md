# S-D12 Build Log — Operator visibility of labelling health (#1914)

**Story:** S-D12 · Epic #1900 · PRD FR-D04, J6 · Architecture §7 (+ §4.1, §6.3)
**Persona:** Nova (implementation), Lead coordinating, Rex design (§7 governs)
**Base:** dev `cbad6fbc3` · Branch `nova/1914-operator-visibility`
**Gate state:** `DIARIZATION_ENABLED` OFF throughout; synthetic fixtures only; no new migration (migration 296 already provides `interview_recordings.diarization_status` + `diarization_jobs`).

## STOP 1 summary

Posted on #1914 before building (comment 6479144912). Comprehension verified live: the list service already `SELECT *`s recordings (the route map dropped the field); the detail payload is built from the full recording row; the admin pattern to mirror is `GET /api/admin/agents/stats` (`requireAdmin` + `safeQuery`, `{success, data}` envelope, denial `401 {error:'Admin authentication required'}`).

Specialist decision: **security reviewer YES** (new admin-only aggregate + auth boundary); **privacy engineer YES at review** (AC-3 is a §6.3 surface); **database reviewer NO, with reason** (two bounded GROUP BY aggregates on the existing jobs table, parameterized window, no schema/index/write change; correctness proven against seeded ground truth on the rig).

## Design choices

- **AC-1:** list map + detail payload in `server/routes/recordings.js` add `diarization_status` (`?? null`, so the key is present and explicitly null for pre-feature recordings). Client `recordings.tsx`: `Recording.diarization_status` typed as the §4.1 value set + null; a `Speaker labels: <Value>` secondary badge renders beside the recording-status badge **only when non-NULL** — NULL renders exactly today's UI.
  - §7 vs §4.1 — **as corrected by the privacy BLOCK (see Review history):** the first build read §7 as exempting "recording-management surfaces" wholesale. The privacy reviewer ruled that exemption covers surfaces only operators reach (the recruiter list qualifies: `interviews:read` + event recruiter/company gate; candidates hold no such permission). The **detail payload is dual-audience** — the owning candidate reads it (S-D11 parity) — so it is NOT management-only: the detail handler now returns the raw value only to recruiter-side/admin roles (`isRecruiterRole(user.role)`) and the §5.1 folded value to everyone else (`failed`/`unavailable` → `unavailable`; other states and NULL pass through). A regression test pins candidate failed ≡ candidate unavailable ≡ `'unavailable'` while recruiter failed stays `'failed'`.
- **AC-2:** `GET /api/admin/diarization/stats?days=N` in `routes/admin.js`, gated by the file's own `requireAdmin` exactly like siblings, plain SQL via `safeQuery`: counts by job `status` (zero-filled over the six CHECK values), failure counts by `error_class`, plus oldest-pending age (§7 queue health; `null` when no pending job — never a fabricated 0). Window: default 30 days, integer-parsed, clamped 1–365, invalid → default. `error_message` is never selected; no recording/user linkage leaves the endpoint.
- **AC-3:** no user-facing code changed in behaviour — the leak is prevented by construction (user surfaces receive only the status string) and pinned by a sentinel test: failed jobs seeded with distinctive `error_class`/`error_message` values; list, detail, and transcript responses (recruiter **and** candidate) are asserted to contain neither the keys nor any sentinel/class value, and the transcript still folds `failed` → `unavailable`.

## Red evidence (pristine dev cbad6fbc3, before the build)

- Server journey suite (`recordings-operator-visibility-1914.integration.test.js`): **5 failed / 1 passed** — AC-1 fields `undefined`; AC-2 endpoint `404` (incl. the denial test: 404 ≠ 401). AC-3 passed pre-build by design: it is a guard — no leak exists until a careless implementation creates one; it must stay green.
- Client suite (`RecruiterRecordingsDiarization1914.test.tsx`): **2 failed / 0 passed** — no badge rendered.

## E2E gate evidence (HL-003, fresh-install rig)

- Rig: PostgreSQL 16.15 + pgvector 0.8.7 on 127.0.0.1:55433 (rebuilt this run from the on-VM PGDG extract — `/tmp/sd10pg` was gone; HL-009 context). Fresh DBs `sd12_fresh` / `sd12_e2e`: `node migrate.js` **exit 0** on both.
- Journey suite = the E2E gate: REAL recordings + admin routers, REAL `lib/db`, REAL JWT auth over HTTP (supertest), seeded ground truth read back through the operator's own surfaces. **6/6 pass pre-review; 7/7 after the privacy-BLOCK fix** (fresh DB `sd12_fix`, migrate exit 0; full recordings batch 42/42):
  1. Recruiter list: `complete`/`failed` recordings carry their `diarization_status` beside `status`; legacy recording carries explicit `null`.
  2. Detail: value and NULL both carried (recruiter raw; candidate folded — step 7).
  7. Privacy folding: candidate detail for `failed` and for `unavailable` recordings both read `'unavailable'`; recruiter keeps raw `'failed'`; candidate `complete` passes through.
  3. Admin aggregate (default 30d): by_status `{complete 1, pending 1, processing 1, failed 2}`, failures `{engine_failed 1, decode_failed 1}`, oldest-pending age a non-negative number.
  4. Window: `?days=60` pulls the 40-day-old `engine_timeout` failure in (failed 3); `?days=99999` clamps to 365; `?days=abc` defaults to 30.
  5. Denial parity: anonymous, recruiter, and candidate all get the sibling `401 {error:'Admin authentication required'}`.
  6. Leak check (AC-3) across list/detail/transcript × recruiter/candidate — clean; transcript `diarization.status === 'unavailable'`.
- Client suite: **2/2 pass** (badge for non-NULL; exactly 2 badges across 3 rows — none for the NULL recording).

## Regression counts (same rig)

| Suite | Result |
|---|---|
| S-D09 transcript composition (1911, integration) + S-D10 mapping (1912) + S-D11 parity (1913) + 1904 realdb | 35/35 |
| diarizationJobs unit + speakerMapping integration + transcriptStitch integration + migration 296 | 45/45 |
| Admin route suites (9 files, mocked-DB pattern) | 115/115 |
| Recordings unit suites (encryption, purged-sentinel, session, transcribe-claim, whisper-confidence) | 38/38 |
| Diarization worker integration (own fresh DB) | 5/5 |
| Client playback suites (1911/1912/1913) | 21/21 |
| **Known pre-existing failure** | `diarizationEngine.integration` AC-2/AC-3 (real engine child returns `failed` instead of `complete` in this VM) — **reproduced identically on pristine dev cbad6fbc3 with this story's changes stashed (1 failed / 1 passed)**, so it is environmental and not a regression of this diff. The other engine test passes. |

## Out-of-scope observation (flagged at STOP 1, not fixed here)

`routes/interview-sessions.js` returns an **observer** job's `error_message` in a session payload — a pre-existing, different feature's surface (observer, not diarization). S-D12's AC-3 covers diarization surfaces; Lead may file separately.

## Review history — privacy BLOCK and its fix

- **Security reviewer — PASS, no blocking findings.** Verified from source: the new endpoint sits behind the identical `requireAdmin` reference as its siblings (no wrapper/drift), both auth paths sound, `?days=` cannot inject (parseInt → Date → parameterized `$1`; garbage yields Invalid Date → zero rows, never a 500 or a widened window), counts-only output (`error_message` never selected, no linkage), and the recordings payload changes widen no access (same `canAccessRecording`/event checks; candidates receive the field only on recordings already visible to them — the point the privacy BLOCK then narrowed further). Two low notes, both pre-existing sibling patterns, not introduced here: the `status in byStatus` whitelist guard (correct as built) and `safeQuery`'s fail-open-to-empty fallback (shared with `/agents/stats`; a diarization outage reads as zeros rather than an error).
- **Privacy engineer — PASS-WITH-BLOCK, one BLOCK-severity finding:** the dual-audience detail payload carried the raw status, so a candidate could distinguish their own recording's `failed` from `unavailable` — the consent-posture signal §4.1/§6.3 prohibits. Also required: correcting this log's original claim that candidate-reachable surfaces received "only the status string" as if that settled AC-3 (corrected above).
- **Fix (same PR):** detail handler folds for non-recruiter-side viewers as described in Design choices; new integration test (candidate failed ≡ unavailable; recruiter raw preserved; complete passes through for candidates). Re-proof on a fresh DB (`sd12_fix`, migrate exit 0): **42/42** recordings integration tests (1914 suite now 7 tests + 1911/1912/1913/1904). Note: the first re-run attempt failed 26/26 because the migration-296 suite's down-checks had damaged the earlier shared DB's schema — all suites were re-run on the fresh DB; the 296-suite result itself (45/45 batch) was recorded before that damage and its own DB usage is its designed behaviour.
- **Delta re-review 1 — BLOCK STANDS, on two grounds; one refuted first-hand, one accepted and closed:** (1) the reviewer held that the fix gates on a JWT-claim role while access is DB-derived. Verified first-hand (HL-007 cuts both ways): `lib/auth.js` `authMiddleware` SELECTs the full user row and sets `req.user` to it — `user.role` in the handler **is** the database role, the identical source `canAccessRecording` uses; there is no JWT-claim role in the chain and no separate `fullUser` re-derivation in this handler. That ground does not hold against the shipped code. (2) Accepted: the folding test covered only the event-linked branch. Closed by adding session-linked fixtures (session candidate + same-company recruiter): candidate session-failed ≡ session-unavailable ≡ `'unavailable'`, recruiter session-failed = `'failed'` raw. Re-proof on fresh DB `sd12_fix2` (migrate exit 0): **42/42** again. A final delta ruling was requested on this evidence; its verdict is recorded in the PR's Specialist Reviews section.
- **Delta re-review 2 — narrowed to one evidentiary item, then closed:** the reviewer accepted ground 1's correction in substance (role source = the DB row `authMiddleware` loads) but held the BLOCK until the session branch carried the full viewer chain **through the handler**: (i) session's candidate folded, (ii) a candidate who is NOT the session's candidate receives no status at all, (iii) company recruiter raw. (i) and (iii) already ran over HTTP; (ii) was added: new fixture user `U_OUT` (candidate, not the session candidate) asserts **403 on both** session-linked recordings. Full chain now proven through the real handler. Suite hygiene fixed on the way: the AC-2 aggregate is global by design, so the suite clears all `diarization_jobs` in `beforeAll` on its dedicated rig DB — final proof on fresh DB `sd12_final` (migrate exit 0): **7/7, twice consecutively**; full recordings batch on fresh `sd12_batch` (serialized): **42/42**.
- **Delta re-review 3 — one further item, closed:** the reviewer then required the event-linked branch's viewer classes proven the same way (its access derives from event/company, not the session): same-company peer recruiter (not of record, not panel) → **200, raw `'failed'`**; other-company recruiter → **403**. Both added to the folding test (fixtures `U_PEER`/`U_OTHERCO`, companies 19141/19142); suite re-proven **7/7** on `sd12_final`. Final ruling requested on the reviewer's own stated completion condition; verdict in the PR body.
- **Delta re-review 4 — the LIST route, a real residual path, fixed by folding there too:** the reviewer verified in `middleware/rbac.js` that `interviews:read` is grantable via `user_roles` (a candidate so granted loses the legacy fallback and uses assigned permissions), and that an internal candidate (candidate's `company_id` = the event recruiter's company) would then pass BOTH list gates and receive raw statuses for the whole event. Verified first-hand — the path is real (the new test's candidate list call returns 200). Fix: the list map now applies the same `isRecruiterRole` gate as detail (raw for operator-side, §5.1 fold otherwise) — costless, since the list's legitimate audience is operator-side. Handler-level proof added (test 'list folding'): RBAC-granted internal candidate reaches the list and sees failed ≡ unavailable ≡ `'unavailable'`, complete raw, legacy null; recruiter list stays raw. Suite **8/8** on `sd12_final`; full recordings batch **43/43** on fresh `sd12_batch`; client **2/2**. Final ruling requested; verdict in the PR body.
- **Privacy NOTE (non-blocking, follow-up for S-D17):** the recruiter list badge mirrors the raw value including `Unavailable`, on the reading that the list is an §7 operator surface. Before enablement, product should confirm the recruiter-facing list is intended as an operator surface for this distinction; if not, folding the badge to match §5.1 is a one-line change.

## Specialist reviews

Security: PASS (no blocking findings). Privacy: PASS-WITH-BLOCK → **BLOCK CLEARED** on the final delta ruling, after four delta rounds (one reviewer ground refuted first-hand on `lib/auth.js`; the test-evidence grounds accepted and closed — non-owner-candidate 403 chain, peer/other-company classes, and the list-route fold for RBAC-granted candidate-class viewers). Full history in the Review history section above and the PR body.
