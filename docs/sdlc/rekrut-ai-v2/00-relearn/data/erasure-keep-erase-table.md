# Erasure Keep/Erase Table — Formal Compliance Reference

**Status:** ADVISORY DESIGN REFERENCE. This document records the design
positions the build follows. It is **not a legal determination** — Lex is not
counsel, and every line marked COUNSEL stays open until a real lawyer answers
it (counsel tracker: #788 / S-086, Gate A determinations C-01–C-08, C-NEW
series from the return-recognition discussion). No outreach has been made or
is authorised by this document (Sumanth, 2026-10-13: "lets not send any mail
to anyone").

**Authority:** Sumanth's instruction, 2026-10-13 — "do as per compliance."
**Canonical location & owner (2026-10-14):** this file, in the data
documentation pack (`00-relearn/data/`), is the **single canonical copy** —
owner **Lex (Legal & Compliance)**, who updates it as the erasure GAP stories
(#1120–#1129) land. It was moved here from
`04-implementation/unified-interview-engine/` (where only a pointer remains)
because the table governs every module's candidate data, not just the
interview engine, and builders look for data references in this pack. Never
copy the table elsewhere — link to this file.
**Authors:** Lex (legal & compliance), on Scout's verified code evidence
(`origin/dev` @ `e5599900`, plus PR #1115's branch where marked), with the
privacy engineer's specialist review incorporated (2026-10-13; its BLOCKER
findings are reflected as the OPEN/clock discipline in §3 and the rulings in
§6 — the uncorrected table was **not** formalised).
**Scope:** what happens to a candidate's personal data when deletion is
requested — self-serve account deletion (`DELETE /delete-account`) and DSAR
fulfilment (`POST /api/compliance/gdpr/delete`), both of which run
`erasePersonalData()` in `lib/erasureService.js`. Age-based retention
(migration 253/257 policies, the purge cron) is cited only where it is the
implementing mechanism for a line.
**Verification posture:** this audit is a full code read + a 241-table
migration sweep. No real-DB run is possible from the build VM (Neon
unreachable, no local Postgres); live-DB policy values are NOT VERIFIED
where noted. Mocked-suite evidence posture applies throughout, as with
#780/#813/#829.

---

## 1. Governing principles

1. **Category-complete, not table-complete.** The table classifies *kinds of
   data*. Any table or store not yet classified defaults to **MUST ERASE**
   until Lex classifies it here. A new feature that stores candidate data
   and does not update this table is non-compliant by construction.
2. **Retain the fact, delete the content** — the house pattern (S-078:
   `recording_consent` fact kept, PII redacted; `conversations` shell kept,
   content deleted). A kept *fact* is itself personal data while it is
   linkable; it is never "anonymous."
3. **No MAY-KEEP line is settled until it names three things:** the exact
   fields kept, the linkage that survives, and a **clock** (a deletion date
   or period tied to a limitation period). Lines missing a clock are marked
   **CLOCK OPEN — counsel** and must not be quoted as settled policy.
4. **All copies.** A disposition applies to every copy: derived copies
   (parsed text, thumbnails, frames, snapshots), second indexes, ledger and
   registry rows, and processor-side copies (§4.3). Erasure that reaches
   only the primary table has not happened.
5. **Erasure ≠ retention.** An exercised erasure right is executed at
   request time. Age-based expiry (e.g. the 90-day recording purge) never
   substitutes for it, absent a named Art. 17(3)-class exception on that
   line.
6. **Fail-closed.** The legal-hold gate runs before any destruction and
   aborts the whole erasure on doubt (shipped, #799). Held material is
   preserved *instead of* erased — never partially erased in silence; the
   DSAR fulfilment note must disclose surviving held rows (#1116).

---

## 2. MUST ERASE

Basis key: GDPR Art. 17(1) (erasure) with Art. 5(1)(c)/(e) (minimisation /
storage limitation); India DPDP Act s.8(7)–(8) class duty (erase when the
purpose is served / consent withdrawn, unless law requires retention) —
pinpoint DPDP subsection numbering is ⚠-verify per the compliance skill;
CCPA/CPRA §1798.105 (delete) for California residents; BIPA §15(a)/(b)
(730 ILCS 14) for biometric identifiers (written release + destruction when
the initial purpose is satisfied or within 3 years of last interaction,
whichever first).

| # | Category | Implementing mechanism (shipped) | Audit status |
|---|----------|----------------------------------|--------------|
| E-1 | **Profile content** — bio, headline, resume file + parsed text, photos, work/education history, skills, LinkedIn profile data, career diagnoses, CV analyses/reviews | 13 in-tx DELETEs (`cv_uploads`, `parsed_resumes`, `candidate_profiles`, `identity_verifications`, `cv_analyses`, `cv_reviews`, `work_experience`, `education`, `candidate_skills`, `linkedin_profiles`, `career_diagnoses`, `user_memory`, `messages` attachments) + storage objects via the crash-safe `pending_storage_deletions` ledger → Phase 2 (S-075/S-076) | **COVERED** — except leftovers at E-11 |
| E-2 | **OmniScore & all derived/inferred data** — score value, factor breakdown, history, role scores, composites, snapshots, match results, recommendations, extracted skills, behavioural/stress measurements, appeals | DELETEs: `omni_scores`, `role_scores`, `score_components`, `score_history`, `interview_composite_scores`, `match_results`, `job_recommendations` (S-078) + GAP-B (#1121): DELETEs `score_snapshots`, `omniscore_results`, `score_appeals` (by `user_id`), `mutual_matches`, `screening_logs` (by `candidate_id`) | **COVERED by GAP-B (#1121, mocked-suite evidence + real-DB dry run at the PR gate (local PG 18.6, 47/47 assertions incl. held-row variants — PR #1153 database review)):** the five leftover tables are hard-deleted in `erasePersonalData` with per-row legal-hold consults (fail-closed; `mutual_matches` on its on-row `company_id`, `screening_logs` via `job_id` → `jobs.company_id`), counts in the result's `gapB`. **Zero-writer finding (evidence, #1121 STOP 1 §3, repo-wide grep):** `omniscore_results` (a *separate* table from `omni_scores`) and `mutual_matches` have **no writers anywhere in the repo** — the DELETEs are still issued (production rows from any out-of-repo write are not verified away), and the compliance-critical readers of `omniscore_results` (bias detection, score explainer, DSAR export, fairness audit) are reading an in-repo always-empty table; that dead-reader problem is a separate follow-up via Lead, outside GAP-B. *(Lex may amend this wording at the gate.)* |
| E-3 | **Interview content** — recordings, frames, transcripts, evaluations, Observer reports, session Q&A content | DELETEs: `interview_transcripts` (event-join + session branch, GAP-A), `interview_evaluations`, `ai_observer_reports`, `observer_jobs`, Gate A audio chunks / speech measurements / capture outcomes (S-085); **GAP-A (#1120):** `interview_sessions` content strip (whole-column resets `conversation`/`frame_analysis`/`invite_token` + `config` allowlist reset keeping only `biometric_collection`), recording/frame objects ledgered per E-4 — all with per-row legal-hold consults | **COVERED by GAP-A (#1120, mocked-suite evidence — no live-DB run, per §Verification posture):** the three violations are fixed in `erasePersonalData()` — (a) session content no longer survives on the kept row; (b) session-linked transcripts are reached by the DELETE's session branch; (c) recordings — see E-4. Session *skeleton* disposition remains ruling R-1 (K-4) — the content strip proceeded regardless, per the #1120 entry note |
| E-4 | **Recording objects (LiveKit egress path)** | The live egress writes MP4 **directly to R2/S3, not DEK-encrypted** (`server/services/livekit.js:524-560`); only the storage *pointer* is encrypted, under a shared `default` key label — **not** the candidate DEK. The DEK-encrypted store (`lib/r2RecordingStore.js`) has **no production call site** (retired, S-074). **GAP-A2 (#1130) mechanism at completion (new recordings only):** `completeRecordingRecord()` encrypts the landed object at completion under the candidate's DEK (new AAD namespace binding candidate + recording id, `lib/sessionRecordingStore.js`), uploads the `.enc` object, registers it in `recording_objects` (candidate-keyed, 90-day expiry), verified-deletes the plaintext original — **egress-bucket versioning is UNVERIFIED for this path, so the verified delete establishes expungement of the current version only** (joining §4.2's generic bucket-versioning statement to this path) — and only then marks the recording `completed` — fail-closed: any failure leaves the recording non-completed/failed, with the plaintext key ledgered (`source_family='livekit_recording'`) for the Phase-2 drain **unless the plaintext was already verified-deleted** (a post-verified-delete failure ledgers no plaintext row), **and with the `.enc` location also ledgered** (same source family) whenever the `.enc` upload may have occurred; at quarantine the failed row is stamped with the shared-key-encrypted plaintext pointer so the GAP-A enumeration below reaches quarantined plaintext by construction. There is always a transient plaintext interval between egress landing and completion encryption — this shrinks at-rest plaintext from the 90-day clock to that window; it does not make recordings never-plaintext. **GAP-A (#1120) mechanism at erasure:** recordings enumerated via both attributions (event join + session branch), pointer decrypted, object ledgered in-tx into `pending_storage_deletions` (`source_family='livekit_recording'`) for the Phase-2 drain; row keep-redacted (`status='deleted'`, `storage_path=NULL` — hard delete forbidden, `recording_consent.recording_id` is ON DELETE CASCADE, mig 128); candidate-keyed `recording_objects` type `frame` rows ledgered (`/api/files/…` encoding) + stamped `deleted_at` | **COVERED at erasure (ledger + row redact — NOT object-deleted) by GAP-A (#1120, mocked-suite evidence), with a named Phase-2 caveat:** read this line as ledger-covered, not object-deleted, while egress-bucket identity is unverified — the object itself is deleted only in Phase 2, and only when addressable there. Phase 2 deletes a ledgered egress object using ONLY the existing primitives (`deleteFile` / `deleteStorageObject`) and only when the egress location's bucket is a configured file-storage provider bucket (bucket-matched, never guessed; a location with no parseable bucket likewise fails closed); an unaddressable bucket fails **visibly** in Phase 2 (entry marked `failed`, disclosed), never silently as success. Verified 2026-10-14: `RECORDING_STORAGE_*` is not set on the Render services, so whether the egress bucket coincides with a file-storage bucket is **NOT VERIFIED** — the STOP 1 §6 re-estimate trigger (new storage primitive / egress-bucket configuration) remains open for Sumanth's ruling. The 90-day retention purge remains not live (#805) and is unchanged by GAP-A. Legacy plaintext frames in R2 (#721 / S-068, still OPEN) are a remediation item, never an erasure mechanism. Crypto-shredding is **not** an answer on this path. **GAP-A2 (#1130) status addendum:** recordings completed after GAP-A2 ships are additionally crypto-shreddable via `destroyDEK()` (defence in depth) — ledger/object deletion above remains the erasure mechanism of record, and crypto-shredding is not claimed as erasure. Pre-GAP-A2 recordings remain plaintext objects on this line's GAP-A mechanism (backlog: GAP-A3). **Named residuals (GAP-A2):** (1) **joint-media asymmetry** — the room-composite recording is a joint object (candidate, recruiter and panel voices/images in one file) encrypted under the **candidate's DEK alone**, so candidate DEK destruction renders **every party's** contribution to that recording unrecoverable, not only the candidate's; (2) **recruiter/panel-subject erasure asymmetry** — the GAP-A enumeration above is **candidate-attributed only** (event join + session candidate), so a recruiter or panel member exercising their **own** erasure right has **no erasure reach to this object family** through that mechanism. |
| E-5 | **Biometrics** — templates, embeddings (both copies), voice/face-derived data | DEK destruction first (`lib/biometricCrypto.js:301-306`, atomic in the erasure tx; tombstone on DEKNotFound) renders `biometric_templates` (mig 246, AES-256-GCM under the candidate DEK) unrecoverable; DELETEs: `candidate_embeddings` + `candidate_search_index` (second copy + plaintext PII, S-075), Gate A measurement family | **COVERED for content.** Template *rows* and `biometric_session_map` linkage rows remain (content unrecoverable) until the gated 90-day template purge — recorded as skeleton line K-8, not silence |
| E-6 | **Application content** — cover letter, screening answers, resume pointer, application-time derived scores, **recruiter notes** | PR #1115 (built, at merge gate, **not on `dev`**): one UPDATE redacting exactly `cover_letter, screening_answers→'{}'::jsonb, resume_url, match_score, omniscore_at_apply, screening_score, assessment_score, assessment_result, recruiter_notes` → NULL, per-row legal-hold consult first; row retained per K-3 | **COVERED when #1115 merges.** Content is erased *by redaction*; `recruiter_notes` is the recruiter's authored text **about** the candidate — it is the candidate's personal data and erases with the application (Sumanth's ruling, 2026-10-13) |
| E-7 | **Application-keyed content beyond the application row** — screening responses, screening records, outreach messages | #813 / S-094 (designed, unbuilt): `screening_responses`, `job_application_screenings`, `ai_screenings`, `outreach_attempts` | **GAP — owned by #813** (entry: #1115 merged + D-1/D-3/D-4 ruled) |
| E-8 | **Auto-apply profile** — whole row incl. `profile_data` | #813 scope; **Sumanth's D-2 ruling (2026-10-13): DELETE the whole row** ("candidate deleted his account — as per policy we will not keep that data with us"); the consent *fact* survives only as the tombstone at K-1 | **GAP — owned by #813** |
| E-9 | **Assessment content** — aptitude/coding attempts + answers, submitted code + AI review text, AI decision explanations, proctoring records | #829 / S-105 (designed, unbuilt): `aptitude_test_attempts`, `coding_submissions`, `ai_decision_explanations`, `proctoring_sessions` + children | **GAP — owned by #829.** Two children need the disposition at K-9 / ruling R-5: `human_overrides` and `ai_screening_audit_logs` are accountability records *about* the candidate — privacy position: **redact to a de-linked structured skeleton, never whole-keep, never silent whole-delete** |
| E-10 | **Verification documents** — government IDs, selfies, verification payloads | DELETEs: `verification_requests` (RETURNING gov-ID + selfie paths → local-disk deletion), `verification_documents` (+ four CASCADE children), `identity_verifications` (S-076) | **COVERED** for the shipped family — except the BGV family at E-12. Whether a verification *outcome fact* survives is ruling **R-4** (§6) |
| E-11 | **Profile-adjacent & career data** — portfolio, endorsements, coach/AI-tool sessions, optimised cover letters, saved jobs, notes/comments about the candidate | GAP-E (#1124) in `erasePersonalData`: explicit counted whole-row DELETEs for all 19 tables, per-row legal-hold consults via a GAP-E-local three-way partition (unheld / genuinely held / lookup-failed — failures counted separately in `holdLookupFailed`/`lookupFailedTables`, never as holds) — `candidate_demographics` FIRST, standalone (DELETE + rowCount only; values never selected, never a join key), third-party set (`recruiter_feedback` + `shared_notes` by `candidate_id`, `skill_endorsements` STRICTLY by `candidate_id` — never `recruiter_id`, `candidate_invites` whole row incl. recruiter message), mig-131/136 cluster by own `user_id` (children before `career_coach_sessions`; SET NULL never relied on), `application_optimizations` (holds cover-letter copies and AI-rewritten outputs — an E-1 copy under Principle 4; originals AND AI-rewritten outputs die with the row — no skeleton), `comments`/`comment_mentions` (ONE recursive scan: application branch via the candidate's application ids + reply children via `parent_id`; mentions DELETE by id set before comments DELETE by id set; a mention naming the candidate on another comment is deleted row-only and inherits its parent comment's partition) | **COVERED by GAP-E (#1124, mocked-suite evidence; real-DB dry run comes at the PR gate — database reviewer, #1153 precedent — and is not claimed here) — with ONE NAMED RESIDUAL:** comments with `entity_type='candidate'` are **not** deleted by GAP-E — what `entity_id` denotes for that branch is UNVERIFIABLE from the repo (migration 128: no FK/DDL comment; sole writer is a branch-blind pass-through; no frontend/test/seed creates one; Scout build-entry re-verification, #1124 steering, superseding comment 6172041587), and the `users.id` / `candidate_profiles.id` spaces overlap, so no guessed join ships; the subset is blocked pending a live-DB join check or a recorded ruling adopting `users.id` as a decided interpretation. All other 19 E-11 tables, per-table counts in the result's `gapE`, held survivals disclosed in `gapE.rowsHeld`/`heldTables`, lookup-failed survivals in `gapE.holdLookupFailed`/`lookupFailedTables`. **Build check (STOP 1 §7):** `portfolio_projects.image_url` is a free-form client-supplied URL (no storage writer) — not storage-bearing as a class; any `/api/files/`-shaped value on an unheld row is ledgered in-tx (`source_family='portfolio_project_image'`). *(Lex may amend this wording at the gate.)* |
| E-12 | **Background-check & onboarding documents** — BGV payloads + discrepancies, reference checks (incl. referee PII), onboarding data (SSN/bank details, DOB, I-9 fields), onboarding documents + signatures, offers (salary, signed letter) | #1123 implementation (PR #1136, merged to `dev` 2026-10-14): explicit per-table erasure in `erasePersonalData` — HARD DELETE `candidate_onboarding_data`, `bg_verification_requests` (incl. `response_token`), `education_history`, `employment_history`, `discrepancies` (explicitly by parent ids first), `reference_checks`, `onboarding_checklists`/`onboarding_documents`/`onboarding_plans`/`onboarding_tasks`/`onboarding_chats`, `verified_credentials` (deleted before `verification_documents` — its `document_id` FK has no ON DELETE action), candidate-as-party `signature_requests`, candidate-scoped `signature_documents` (+ explicit `document_hash_records`/`signature_audit_events`); `offers` REDACT-to-skeleton (salary/benefits/template_data/offer_letter_html/signature fields/decline_reason → NULL, K-3 precedent; **migration 259 relaxes the `offers.salary` NOT NULL constraint (migration 014) to nullable** so the ruled skeleton NULL can execute — PR-gate fix P-1, without it the UPDATE aborts the whole erasure transaction); `signing_parties` DELETE or REDACT by surviving-document split; 3 storage families via the `pending_storage_deletions` ledger (non-`/api/files/` URLs named in the result, never silently skipped); per-row legal-hold consults passing the row's own `company_id` (fail-closed) | **COVERED — #1123 merged to `dev` (PR #1136, 2026-10-14).** Ruled by Sumanth (2026-10-14): outcome-fact keeps NOTHING (R-4 answered for this family), referees hard-delete, offers skeleton, payroll boundary confirmed out of scope. **Named residual:** `signature_audit_events` on surviving company documents are never rewritten (hash chain) — residual `actor_email` is counted in the erasure result (`gapD.signatureAuditResidual` — a **lower bound**, PR-gate P-2: actor-linked events on surviving documents only; events with `actor_id` NULL attributable via parties are not counted), clock **OPEN — counsel** |
| E-13 | **Scheduling & human-interview records** — scheduled interviews (feedback, notes, AI evaluation, meeting links), panels/scorecards/notes, mock-interview sessions (full conversations + feedback), the legacy `interviews` table (questions, responses, AI feedback, video URLs — created in `migrate.js`, outside `migrations/`) | GAP-C (#1122) in `erasePersonalData`: explicit counted DELETEs, children before parents, per-row legal-hold consults (fail-closed; own/derived company per table) — `interview_analysis` → legacy `interviews` (video URLs: `/api/files/` entries ledgered in-tx as `legacy_interview_video`, non-pattern entries named in the result), `scorecard_items` → `scorecards` → `panel_notes`/`panel_members` → `interview_panels` → `scheduled_interviews` (with `interview_reminders` + `interview_feedback`), `proposed_slots` + event-linked `interview_rooms` → `interview_events`; whole DELETE of recruiter-authored feedback/panel content (Lex panel Q1 — no K-9 skeleton); `candidate_feedback`, `mock_interview_sessions`, `human_interview_requests`; `interview_events` split per Q2(b)/K-12: whole-DELETE where no `interview_recordings` child survives, REDACT to the K-12 skeleton where one does | **COVERED by GAP-C (#1122, mocked-suite evidence; real-DB dry run comes at the PR gate — database reviewer, #1153 precedent — and is not claimed here):** all 13 E-13 tables plus `panel_members`, `scorecard_items`, and the two Q3-confirmed adjacents classified under Principle 1 by the Lex panel (#1122) — **`interview_reminders`** and **event-linked `interview_rooms`** (only rows with `interview_session_id IS NULL`; session-linked rooms remain spine territory, untouched). Per-table counts in the result's `gapC` (incl. `interviewEventsRedacted` + `interviewEventsDeleted`), held survivals disclosed in `gapC.rowsHeld`/`heldTables`. **#1964 amendment (Lex panel, 2026-10-29):** the no-recording whole-DELETE branch is further partitioned by panel consent — an event carrying `event_labelling_consent` rows is REDACTED under K-12's panel-consent clause, not deleted (migration 299's RESTRICT would otherwise abort and roll back the candidate's entire erasure); counted as `gapC.interviewEventsKeptForPanelConsent`. Build = follow-up story filed from #1964 (not yet built). **Referenced rooms survive under K-12 (Lex ruling, #1122, comment 6169043564):** an event-linked `interview_rooms` row referenced by a surviving `interview_recordings` row (`room_id`, mig 128 ON DELETE CASCADE) is **not** deleted — it survives whole under the K-12 referenced-room clause and is counted separately in `gapC.interviewRoomsKeptForRecordings`, never as deleted; only rooms referenced by no surviving recording are whole-DELETED. *(Lex may amend this wording at the gate.)* |
| E-14 | **Assessment sessions & attempts (non-application)** | GAP-B (#1121) in `erasePersonalData`: hard DELETEs `skill_assessments` (by `user_id`, before `assessment_sessions`), `assessment_results` (by `user_id`, #1340 — table created by migration 270 after the GAP-B sweep; Lex classification ERASE under legal hold, STOP 1 on #1340; **named residual:** the table has no `company_id`, so a company-only hold reachable only via an assessment/application — with no `interview_sessions` row — cannot be honoured for this table, the same accepted exposure as `skill_assessments`/`omniscore_results`), `job_assessment_attempts` (by `candidate_id`) + child `assessment_conversations` (explicitly, by unheld attempt ids, before the parent), `assessment_sessions` (by `user_id`) + child `assessment_events` (explicitly, by unheld session ids, before the parent); per-row legal-hold consults (fail-closed), counts in the result's `gapB` | **COVERED by GAP-B (#1121, mocked-suite evidence + real-DB dry run at the PR gate (local PG 18.6, 47/47 assertions incl. held-row variants — PR #1153 database review)):** `skill_assessments` (incl. `behavioral_flags`, `anti_cheat_score`), `job_assessment_attempts` (answers, AI summary, anti-cheat signals) + child `assessment_conversations` (deleted explicitly with the parent's hard delete — never cascade-assumed), `assessment_sessions` + `assessment_events`; `assessment_results` (per-skill score rows — migration 270 shape: `user_id`/`skill_name`/`score` only, no company/job/application linkage, no consent fact) **COVERED by #1340** (mocked-suite evidence; real-DB verification is Quinn's E2E-on-dev closure gate for #1340, and a live-shape check of the out-of-band-created table is required pre-promotion — migration 270 does not reconcile a divergent live shape) |
| E-15 | **Communications content authored by the candidate** — messages, outreach, notification bodies | `messages` DELETE by `sender_id` (S-078); the rest untouched | **PARTIAL — GAP → GAP-F (§5):** `communications`, `sequence_enrollments`, `email_queue`, `notification_queue`, `notification_logs`, `user_notifications`. Counterparty copies are governed by K-7, not this line |
| E-16 | **Account residuals on the `users` row itself** | Tombstone (`routes/auth.js:1742-1758`): email rewritten to a synthetic `deleted_*@deleted.local`, name → "Deleted User", password/OAuth ids nulled, `oauth_connections` + `password_reset_tokens` deleted, `refresh_tokens` revoked (rows kept) | **COVERED by GAP-G (#1126, mocked-suite evidence; real-DB dry run comes at the PR gate — database reviewer, #1153 precedent — and is not claimed here):** all GAP-G writes land inside `erasePersonalData` (DSAR parity — the admin path previously applied no tombstone at all): users-row completion strip (`linkedin_data`, `title`, `github_username`, `company_name`, `suspended_at` → NULL plus the tombstone parity fields; `company_id` NULL for candidate subjects only), whole-row DELETEs for `calendar_connections`, `oauth_exchange_codes` (expired AND unexpired), `refresh_tokens` (DELETE-at-erasure), `oauth_connections`, `password_reset_tokens`, `user_settings`, `user_roles`, `usage_limits`, `assessment_referrals` (all three linkages: email / `claimed_by_user_id` / `created_by`), `api_keys`; `user_roles.assigned_by` severance on other users' rows counted as a redaction, never a deletion. Per-table counts in the result's `gapG`, held survivals disclosed in `gapG.rowsHeld`/`heldTables`, lookup-failed survivals in `gapG.holdLookupFailed`/`lookupFailedTables`. Flow A (`DELETE /delete-account`) also destroys the caller's session post-commit. **Named residuals (not erased, not claimed):** `user_sessions` (no user key — mechanism unverifiable, unblock = a user-keyed session index), employer-side `company_id` (Lex to confirm), the K-6 billing fields on the users row untouched by reference to K-6, and the tombstone skeleton itself — K-line proposal owed, clock OPEN — counsel. *(Lex may amend this wording at the gate.)* |
| E-17 | **Panel labelling consent (BR-7)** — a panel speaker's own speaker-labelling decisions for an interview event (`decision`, `notice_version`, `decided_at`, evidence-only `ip_address` + `user_agent_hash`) | S-D19 (#1956) step in `erasePersonalData()`: whole-row DELETE from `event_labelling_consent` keyed by `user_id` across **all** events (enumeration via `idx_event_labelling_consent_user`, design §10 / privacy C-8) — IP/UA die with the row, no separate redaction. **Two directions kept separate:** this DELETE keys only on the subject's own `user_id`, so a *candidate's* erasure never deletes, alters, or cascades a panel speaker's rows (they are the other users' records). **Documented tombstone exception:** the `panel_consent_snapshot` copies on `diarization_jobs`/`diarization_runs` (user id + decision + timestamps only — no IP/UA) may be retained on the consent-record retention clock, access-restricted, as the evidence that labels were authorized when written (privacy C-2) — the same documented exception the existing consent tombstone carries. **Consequence for the candidate's erasure (#1964, Lex panel 2026-10-29):** because these rows survive a candidate's erasure untouched, an event whose only surviving child is panel rows is kept as a K-12 skeleton under K-12's panel-consent clause instead of being whole-deleted under E-13 | **COVERED by S-D19 (#1956, real-DB integration evidence — I5 on the fresh-install rig: panel user's rows deleted across two events, count in the result's `panelLabellingConsentDeleted`; candidate erasure left the panel row byte-identical).** Retention clock for the tombstone snapshots: consent-record clock, **OPEN — counsel** (same status as K-1's clock) |
| `threat_intel_checks` — payload tier (`subject_fingerprint`, `signal_payload`) — **MUST ERASE** | ERASE: whole-row DELETE in `erasePersonalData()` (C2 position) keyed by the #780 unheld application set; held applications' rows survive whole and are counted (`threatIntelRowsHeld`), resuming this disposition on hold release. `subject_fingerprint` is pseudonymised (company-siloed HMAC), still personal data, never a raw identifier; erasure is row deletion, not crypto-shredding. **ADVISORY / DESIGN-DEFAULT — pending counsel (#788).** |
| `threat_intel_checks` — audit-metadata tier (`id`, `source`, `checked_at`, `sources_checked`, `sources_failed`, `severity`, `company_id`, `job_application_id`, `created_at`) — **MUST ERASE by default; no MAY-KEEP line created** | ERASE with the whole row by default — retained no longer than the parent application's lifecycle (#807 default, pending counsel). **No 90-day period is adopted and no purge is built.** If counsel sets a period, this tier may convert — only by a follow-up story — to a payload-stripped row retained for that counsel-set period (presumed to run from `checked_at`, total retention capped, unless counsel expressly directs otherwise), then purged; that conversion requires no schema change. Clock: **OPEN — counsel (#788)**. **ADVISORY / DESIGN-DEFAULT — pending counsel.** |

---

## 3. MAY KEEP — only with basis, named fields, and a clock

Basis key: GDPR Art. 7(1) (demonstrability of consent) + Art. 17(3)(b)
(legal obligation); Art. 17(3)(e) (establishment/exercise/defence of legal
claims — *necessity tied to a limitation period*, never a free-standing
"joint record" basis); Art. 5(2) (accountability); CCPA §1798.105(d)
exceptions; DPDP retention-where-law-requires class. **A line whose clock
reads OPEN is a design direction, not a settled retention.**

| # | Kept item | Fields kept / linkage | Basis | Clock | Status |
|---|-----------|------------------------|-------|-------|--------|
| K-1 | **Consent facts** — that consent was given, its value, its date | `recording_consent` row with `ip_address`/`user_agent` **redacted to NULL** (shipped, S-078); auto-apply consent tombstone `{profile existed, gdpr_consent value, consent_date}` inside erasure-audit metadata only (D-2 ruling); `interview_sessions.config.biometric_collection` flag | Art. 7(1) + 17(3)(b) | **OPEN — counsel** (life of the related record + contestability period is the design direction) | **COVERED by GAP-H (#1127, mocked-suite evidence + local-PG dry run under the BEGIN…COMMIT production caller shape — scratch PG 16.15, full migrate.js schema, seeded unheld / held (static + mid-run) / lookup-failing-in-the-GAP-H-window postures, 44/44 assertions, keep columns byte-identical; per-row hold consults are savepoint-contained, so a lookup failure inside the caller's transaction counts the row lookup-failed, preserves it, and the erasure completes — the pre-fix code aborted that same posture with 25P02, and an autocommit (no-surrounding-transaction) posture also passes via the bare-consult guard; database reviewer re-runs at the PR gate):** `consent_records` and `consent_history` are now redacted on erasure in `erasePersonalData`, adjacent to the shipped `recording_consent` redaction, with per-row legal-hold consults (post-#799 pattern, fail-closed, three-way partition counted in the result's `gapH`). Ruled field sets are per-table (the GAP-H filing's symmetry was wrong — `consent_records` has no `user_agent` column, mig 013/133): `consent_records` — `ip_address` → NULL, `metadata` → `'{}'::jsonb`, `revocation_reason` → NULL (`metadata` + `revocation_reason` ruled IN at STOP 1: caller-supplied / free-text PII, neither a named fact field on this line, Principle 3); `consent_history` — `ip_address`/`user_agent` → NULL. All fact fields kept byte-identical (rows never deleted — a `consent_records` DELETE would CASCADE history; no NOW() churn). **Named residual:** actor FKs `revoked_by` / `changed_by` are KEPT (the actor's accountability data, not the subject's device metadata; GAP-D actor_email precedent), named in `gapH.actorFkResidualColumns` and counted in `gapH.actorFkResidual`. Kept rows remain **LINKABLE personal data** under this line's clock (OPEN — counsel) — they are **not** anonymised. `consent_receipts` (hash only, mig 244) conform as designed |
| K-2 | **The erasure / audit record itself** | `audit_logs` entry (incl. `target_user_id` + minimised erasure-result metadata — the counts form only, no storage keys, per #1128); `compliance_audit_trail` (hash-chained; written by purges + hold conflicts, **and** during a normal erasure by the #1337 dead-letter drain — reconstructed, provenance-labelled replays of previously failed trail writes, inserted in-transaction before the source rows are deleted; the drain is fail-closed: any drain failure aborts the whole erasure, nothing deleted — the abort-vs-proceed trade-off against the Art. 17 clock is Sumanth's to rule, F-2 on #1867); `biometric_audit_log` (append-only by DB trigger, mig 243) | Art. 5(2) accountability | Seeded policy: `audit_logs` 2555 days, `auto_delete=false` (mig 013 — **live values NOT VERIFIED**); mig 243 notes 7 years for `biometric_audit_log`. Formal adoption: **OPEN — counsel** | **KEPT, with two recorded defects:** (i) **MINIMISED FORWARD-ONLY by #1128 (GAP-I):** the Phase-2 drain audit is now one aggregate key-free entry per drain run (counts by family/type + error classes only, no `file_url`, no raw error strings); the admin DSAR path and the self-serve path persist/return only the sanitised counts form of the erasure result (raw `storageKeys` / `gapC`/`gapD.nonPatternStorageUrls` never persisted — counts only, **no hash of any key or identifier**); and drained `pending_storage_deletions` rows are terminally purged into a bounded key-free fold record (see the §5 ledger-terminal-state row). **Historical residual, named in substance and NOT rewritten:** historical `biometric_audit_log` / DSAR-path `audit_logs` entries written before #1128 retain raw storage keys in metadata until the K-2 clock expires; they are not rewritten (append-only integrity — the mig 243 trigger means existing `biometric_audit_log` entries cannot be rewritten without a migration). No DSAR/candidate-facing wording may claim all storage keys were deleted while this residual stands; (ii) `biometric_audit_log.candidate_id` is a plain INTEGER (mig 243 itself notes DEK-encryption as an un-done follow-up) — **OPEN, owned by #1170**. Defect (i) → **GAP-I (#1128)**; defect (ii) → **#1170** |
| K-3 | **Application skeleton** | The `job_applications` row post-#1115: candidate linkage (`candidate_id`), job/company linkage, status, timestamps. All content columns NULL/empty per E-6 | Art. 17(3)(e) — the employer's hiring record; the fact-of-application is often the legally sensitive fact, so this line is **not** anonymous and **not** indefinite by default | **OPEN — counsel** (tie to the applicable hiring-claims limitation period) | **DESIGNED (PR #1115), clock unset** — ships only with the clock question carried openly, per Principle 3 |
| K-4 | **Interview session skeleton** — *proposed line, not yet a shipped disposition* | Bare row only: session id, job/company linkage, timestamps, status, consent fact (K-1). **All content must be stripped**: `conversation`, `frame_analysis`, residual `config` content keys, `invite_token` | Product/audit continuity + consent demonstrability for the consent fact only | **OPEN — counsel**, if kept at all | **RULING R-1 (§6):** does the product keep a session skeleton? Today the row is kept *with content* (E-3 violation — GAP-A fixes the content regardless of R-1's answer) |
| K-5 | **Legal-hold material** | Whatever the hold identifies, unaltered | Art. 17(3)(e); the hold itself (migration 258, #799) | Until hold release, then the normal disposition resumes automatically | **SHIPPED** (fail-closed erasure gate + per-entry Phase-2 consult + per-row consult in #1115's design). Discipline terms — hold scoped to identified material, access-frozen, logged, re-reviewed on a cadence: **OPEN — counsel** (procedure, #799/#917 family) |
| K-6 | **Billing / financial records** | Employer's own subscription/billing records (not the erasing candidate's data). Candidate-side: the migrations contain **no billing tables**; candidate-linked Stripe identifiers live on the `users` row (`stripe_subscription_id`, plan, status) and survive the tombstone today | Statutory retention (tax/accounting — statute + period per jurisdiction: **OPEN — counsel**) | **OPEN — counsel** | **KEPT by default, basis to be named.** Do not cite this line to keep any other candidate-linked transaction data — it has no statutory home here |
| K-7 | **Joint conversation shell + counterparty messages** | `conversations` row (verified content-free: `last_message` is never written; previews are computed from `messages`). The candidate's **own sent messages are deleted** (E-15); the **counterparty's messages remain** in the retained conversation | Art. 17(3)(e) joint record (S-078 precedent) | Same clock as K-3: **OPEN — counsel** | **SHIPPED as described.** The UX consequence (a recruiter keeps their side of a thread with a departed candidate) is ruling **R-2** |
| K-8 | **Biometric template rows after DEK destruction** | `biometric_templates` rows + `biometric_session_map` linkage: ciphertext only, unrecoverable once the DEK is destroyed; `subject_ref` is opaque with no `users` FK by design | Content erased by crypto-shredding (E-5); rows are a registry skeleton | Rows removed by the 90-day template purge (`purgeExpiredTemplates`) — **gated, not live** (same arming state as §7) | **KEPT as ciphertext skeleton; purge not armed.** Crypto-shredding sufficiency as an erasure answer: **OPEN — counsel** (cf. C-L2 class) |
| K-9 | **Accountability skeletons for AI/human decisions** — *proposed line* | De-linked structured fields only: decision type, override flag, timestamps, actor role. **No** candidate identifiers, **no** free text (reasons are content, E-9) | Non-discrimination accountability / Art. 17(3)(e) direction (privacy-engineer position on #829's `human_overrides` + `ai_screening_audit_logs`) | Discrimination/legal-claims limitation period: **OPEN — counsel** | **RULING R-5 (§6)** — decided at #813's D-1 gate; #829 inherits it |
| K-10 | **The DSAR request record itself** | `data_requests` row, updated in place to `status='completed'` with the erasure summary appended to `notes` | Art. 5(2) / Art. 12 handling record | **OPEN — counsel** (with K-2) | **SHIPPED as described** |
| K-11 | **Truly anonymised aggregates** | Aggregates that pass a singling-out test: minimum cohort size / suppression; **an n=1 "aggregate" is the score, and is MUST ERASE (E-2)**. Pseudonymised ≠ anonymised, everywhere in this table | Outside GDPR/DPDP personal-data scope only if irreversibly anonymous | n/a if truly anonymous | **No mechanism exists today.** Cohort threshold = ruling **R-3** |
| K-12 | **Scheduling-event skeleton (recording- or panel-consent-linked events only)** | The `interview_events` row **only where an `interview_recordings` child survives** under GAP-A / E-4: kept — row id, `job_application_id`, `candidate_id`, `recruiter_id`, `scheduled_at`, `duration_minutes`, `timezone`, `status`, `created_at`/`updated_at` (the linkage columns are NOT NULL, mig 126 — this line is **linkable like K-3, not anonymous**). Stripped at erasure: `notes`, `meeting_link`, `livekit_room_url`, `calendar_event_ids` → NULL, `panel_member_ids` → `'{}'`. Events with **no** surviving recording child are whole-DELETED under E-13 — no skeleton. **Referenced-room clause:** an event-linked `interview_rooms` row referenced by a surviving `interview_recordings` row (`room_id`, mig 128 ON DELETE CASCADE) is kept whole — row id, `interview_event_id`, `room_name`, `livekit_room_id`, `status`, `created_at`/`closed_at` — on this line's structural-parentage basis only, for exactly as long as the referencing recording row survives; when that recording row is lawfully hard-deleted, the deleting path must delete the room in the same operation (the FK cascade does not run in that direction), and if it was the event's last surviving recording, the K-12 event skeleton with it; a room referenced by no surviving recording is whole-DELETED under E-13/Q3, and no room is kept under this clause once its referencing recording is gone. **Panel-consent clause (Lex panel, #1964, 2026-10-29):** an event with **no** surviving recording child but **with** `event_labelling_consent` rows is likewise REDACTED to this skeleton, never whole-DELETED — migration 299's `ON DELETE RESTRICT` FK and §10/E-17 forbid deleting or cascading a panel speaker's rows on a candidate erasure, so the event survives exactly as long as its last panel row does, kept on the identical field set (no additions), counted separately in `gapC.interviewEventsKeptForPanelConsent`, and disclosed in the erasure result (a candidate must never be told "everything deleted" while this skeleton stands). The skeleton is excluded from UI/search/matching/scoring/analytics surfaces (compliance/audit access only). It dies via the cleanup-sweep story filed from #1964 (its own STOP 1): a redacted skeleton carries **no reliable marker** today, so no in-transaction cleanup is built — the sweep re-derives every condition at sweep time (no recording, no remaining panel rows, tombstoned candidate, fresh fail-closed legal-hold partition) or an explicit keep-marker is designed as a separately gated schema story; the sweep must never report panel consent evidence as gone while `panel_consent_snapshot` copies remain on their own clock. | Structural parentage of the kept recording row and its K-1 consent fact: `interview_recordings.interview_event_id` is ON DELETE CASCADE (mig 128) and mig 130's XOR check forbids unlinking, so the event row must survive exactly as long as — and only as long as — the recording/consent record it parents survives. Art. 17(3)(b)/(e) direction via K-1; **not** a free-standing "scheduling record" keep | **OPEN — counsel** (no longer than the K-1 consent fact / recording row it parents; when that recording row is lawfully deleted, this skeleton's basis ends and the row must be deleted with it; for a panel-kept skeleton, no longer than its last surviving panel row under the E-17 consent-record clock) | **RULED — Lex panel, #1122, 2026-10-14.** Built in the GAP-C PR, which adds this line and updates the E-13 status cell in the same PR. **Panel-consent clause RULED — Lex panel, #1964, 2026-10-29** (Lex + privacy engineer + database reviewer + Lead concurring; the one mechanical dissent — in-transaction cleanup — was resolved for a separate sweep story on the database reviewer's evidence). Build = the follow-up stories filed from #1964 |

---

## 4. Not in the table's promise

### 4.1 UNSETTLED — do not build
**The HMAC integrity marker for return recognition** (hashed identifier +
"prior account existed" marker for duplicate-prevention / score-continuity):
**counsel-gated and not built.** It may never be smuggled in as a `users`-row
residual, an unsalted hash, or a tombstone field. Gating questions C-NEW-01
(does Art. 6(1)(f) sustain even a minimised marker post-erasure in an
employment-scoring context?) and C-NEW-03 (DPDP s.7(i) reach) — counsel
tracker, unsent per the no-outreach rule. Lex's safe order stands: two-track
deletion UX + full erasure on the statutory track + marker **on paper only**.

### 4.2 Backups & replicas — window NOT VERIFIED
Erased rows persist in Neon point-in-time-recovery snapshots / replicas
until rotation. The window is **not verified** (C-L2 — this VM cannot reach
Neon; bucket versioning likewise unverified). Until it is verified and
stated here, no erasure may be reported "complete" — the honest wording is
*"erased from live systems; expunged from backups within [window] on
rotation; backup data is never used except for restore, and the erasure
ledger is re-applied after any restore."* Disclosure wording: **counsel**.
Verification of the window: **Relay/Suga, activation-blocking (C-L2)**.

### 4.3 Processors, logs, and disclosed data
- **Sub-processors:** email (Brevo), AI model providers (transcripts /
  evaluations submitted for processing), LiveKit/SFU — each needs either a
  short fixed retention making erasure-by-expiry true, or a deletion
  propagation path. Inventory + retentions: **GAP-J (code-fix class)**;
  contract wording: **counsel**.
- **Application/error logs & telemetry** will contain ids, IPs, file URLs.
  No line in §2 reaches them; they are governed by the same rule as §4.3
  above (fixed short retention or propagation) — inventoried in GAP-J.
- **Already disclosed data** (reports/scores a recruiter has exported —
  PDFs, emails, their own systems) is outside this erasure's reach. The
  candidate-facing erasure confirmation must say so; over-promising, not
  the limitation, is the exposure. Confirmation wording: **counsel**.

**Status after GAP-J (#1129):** A processor & log retention inventory
now exists ([processor-log-retention-inventory.md](processor-log-retention-inventory.md)).
Each entry records the data classes sent, the first-party control, the
designed disposition, and the evidence state. Dispositions are
DESIGNED, NOT IMPLEMENTED: no processor-side deletion is performed by
erasePersonalData() today, and no vendor retention period, deletion
SLA, training use, or DPA state in the inventory is verified — every
vendor-side entry is marked NOT VERIFIED pending vendor-terms review
(tracked, §6.2 / #788 pattern; nothing sent). Follow-on builds filed
from the inventory: #1179, #1180, #1181, #1182. Until a follow-on
lands and its entry is re-marked, no erasure may be described —
internally or to a candidate — as reaching processor copies,
application/error logs, or telemetry. Counsel-open items unchanged
and named: processor-deletion contract wording; erasure-confirmation
wording (including the already-disclosed-data limitation in this
section).

### 4.4 Out of candidate-erasure scope — stated, not silent
**Payroll / employee records** (`employees`, `paychecks`, `payroll_configs`
— incl. bank routing last-4, salary, tax status — `tax_documents`) are the
**employer's** statutory employment records (the M17 post-hire module), keyed
to the employment relationship with the company, not to the candidate's
platform account. They are **not** erased by candidate account deletion, and
no line above should be read to reach them. Whether a platform-level
disposition is ever needed is ruling **R-6** (ties to the M17 inventory).
Candidate-*supplied* onboarding data collected pre-employment is different in
kind and is in scope — E-12 / GAP-D.

---

## 5. Audit register — built erasure vs this table (2026-10-13)

Method: full read of `lib/erasureService.js` + callers, programmatic sweep
of all 241 tables in `migrations/` (+ `migrate.js`-created tables),
cross-checked against PR #1115's branch and the #813/#829 scopes. Every
MUST-ERASE line's verdict:

| Line | Verdict | Where the remainder lives |
|------|---------|---------------------------|
| E-1 Profile content | **COVERED** (shipped) | Leftovers via GAP-E |
| E-2 Scores & derived | **COVERED by GAP-B (#1121)** — leftovers hard-deleted in `erasePersonalData` (mocked-suite evidence) | **GAP-B** (§5) |
| E-3 Interview content | **COVERED by GAP-A (#1120)** — session strip + session-branch transcript DELETE (mocked-suite evidence) | **GAP-A** (§5) |
| E-4 Recording objects | **COVERED at erasure (ledger + keep-redacted row — NOT object-deleted) by GAP-A (#1120)** — ledger-covered while egress-bucket identity is unverified; Phase-2 bucket-addressability caveat at E-4 (§2) remains an open re-estimate trigger; **new recordings encrypt-at-completion under the candidate DEK (GAP-A2, #1130)** — transient plaintext interval, quarantine ledgering (plaintext unless already verified-deleted, plus the `.enc` whenever its upload may have occurred), verified delete = current version only (egress-bucket versioning unverified), and the two named residuals (joint-media asymmetry; recruiter/panel-subject erasure asymmetry) at E-4 (§2) | **GAP-A** (§5) + **GAP-A2** (#1130) |
| E-5 Biometrics | **COVERED** (content, by DEK destruction) | Rows/linkage per K-8 |
| E-6 Application content | **COVERED on merge of PR #1115** | At Sumanth's merge gate |
| E-7 Application-keyed tables | **GAP — designed** | **#813** (existing) |
| E-8 Auto-apply profile | **GAP — designed, D-2 ruled DELETE** | **#813** (existing) |
| E-9 Assessment content | **GAP — designed** | **#829** (existing) + R-5 for two children |
| E-10 Verification documents | **COVERED** (shipped family) | BGV family via GAP-D; outcome fact = R-4 |
| E-11 Profile-adjacent / career | **COVERED by GAP-E (#1124)** — hard-deleted in `erasePersonalData` (mocked-suite evidence; real-DB dry run at the PR gate); **named residual:** `entity_type='candidate'` comments not deleted (entity_id join UNVERIFIABLE — pending live-DB check or a recorded users.id ruling) | **GAP-E** (§5) |
| E-12 BGV & onboarding documents | **COVERED — #1123 merged (PR #1136, 2026-10-14)** | Signature-audit residual clock OPEN — counsel |
| E-13 Scheduling & human interviews | **COVERED by GAP-C (#1122)** — hard-deleted in `erasePersonalData`, `interview_events` split per K-12 (mocked-suite evidence; real-DB dry run at the PR gate) | **GAP-C** (§5) |
| E-14 Assessment sessions/attempts | **COVERED by GAP-B (#1121)** — hard-deleted in `erasePersonalData` (mocked-suite evidence) | **GAP-B** (§5) |
| E-15 Communications | COVERED by GAP-F (#1125, mocked-suite evidence; real-DB dry run comes at the PR gate — database reviewer, #1153 precedent — and is not claimed here): `messages` DELETE by `sender_id` (S-078, pre-existing) + explicit counted whole-row DELETEs in `erasePersonalData` for `communications` (**all rows by `candidate_id`, draft and sent alike**), `sequence_enrollments`, `email_queue`, `notification_queue`, `notification_logs`, `user_notifications`, `notification_preferences`, and `notification_audio_cache` (**added to this family at GAP-F STOP 1**: mig 046, `notification_log_id` → `notification_logs` — the audio rendering of a notification body, a derived copy under Principle 4; deleted explicitly by parent log ids, cascade never assumed; **named residual R-F1:** cache rows with NULL `notification_log_id` are not deleted, not counted, and not claimed as erased — they hold `audio_data`, a rendering of a notification body, but no candidate attribution is reachable for them, and the table has no writer at HEAD), per-row legal-hold consults (fail-closed), per-table counts in the result's `gapF`, held survivals disclosed in `gapF.rowsHeld`/`heldTables`. **Sent-`communications` disposition — RULED by Lex at GAP-F STOP 1 (#1125, 2026-10-14): DELETE under E-6/E-13** (recruiter-authored, candidate-subject content; Sumanth's E-6 ruling and the E-13 whole-delete govern). **K-7 is not extended to `communications`. R-2 flag:** the K-7 counterparty analogy for sent rows was raised at STOP 1 and ruled as above; **R-2 itself remains OPEN for Sumanth, scoped to `conversations`/`messages` only, and is neither resolved nor prejudged by this ruling.** *(Lex may amend this wording at the gate.)* | **GAP-F** (new) |
| E-16 Account residuals | **COVERED by GAP-G (#1126, mocked-suite evidence; real-DB dry run comes at the PR gate — database reviewer, #1153 precedent — and is not claimed here):** users-row completion strip + whole-row DELETEs for `calendar_connections`, `oauth_exchange_codes`, `refresh_tokens`, `oauth_connections`, `password_reset_tokens`, `user_settings`, `user_roles`, `usage_limits`, `assessment_referrals`, `api_keys` in `erasePersonalData`, per-row legal-hold consults (fail-closed), per-table counts in the result's `gapG`; `user_roles.assigned_by` severed to NULL on other users' rows (redaction count). **Named residuals:** (i) `user_sessions` — the table has **no user key** (linkage exists only inside the `sess` JSON), so no targeted-delete mechanism is verifiable from the repo and the rows are **NOT claimed erased**; unblock = a user-keyed session index (7-day cookie expiry caps the residue, and post-GAP-G `authMiddleware` rejects tokens for `deleted_at` users, which defangs without erasing); (ii) employer-side `users.company_id` — retained on employer-side subjects and counted in `gapG.companyIdResidual` (Lex to confirm); (iii) K-6 billing fields on the users row (`stripe_subscription_id`, `subscription_plan`, `subscription_status`, `is_paid`) — untouched by GAP-G, by reference to **K-6** (clock OPEN — counsel), not claimed erased; (iv) the tombstone skeleton itself (row `id`, `role`, synthetic email, `deleted_at`, `created_at`) — a **K-line proposal is owed** for it (clock OPEN — counsel) | **GAP-G** (§5) |
| K-1 Consent facts | **COVERED by GAP-H (#1127, mocked-suite evidence + local-PG dry run under the BEGIN…COMMIT production caller shape with savepoint-contained per-row hold consults — the lookup-failure posture completes with rows preserved and counted in `gapH`, 44/44 assertions; real-DB dry run re-run at the PR gate — database reviewer, #1153 precedent):** `consent_records` / `consent_history` PII redacted on erasure per the §3 K-1 field sets (per-table: `consent_records` has no `user_agent`; `metadata` + `revocation_reason` ruled IN), fact fields byte-identical, per-row hold consults fail-closed, counts in `gapH`; **named residual:** actor FKs `revoked_by` / `changed_by` kept and disclosed in `gapH.actorFkResidual` / `actorFkResidualColumns`; kept rows remain linkable personal data under K-1's clock (OPEN — counsel), not anonymised | **GAP-H** (§5) |
| K-2 Audit record | **KEPT — defect (i) minimised forward-only by #1128 (Phase-2 aggregate audit + sanitised DSAR/self-serve audit copies, counts only); historical raw-key residual named at K-2 §3, not rewritten (append-only integrity); defect (ii) OPEN** | **GAP-I (#1128)**; defect (ii) → **#1170** |
| K-3/K-4/K-7/K-9 skeletons | **Clocks/bases open; K-4/K-9 need rulings** | §6 (R-1, R-2, R-5) + counsel |
| Ledger terminal state | **SHIPPED (#1128):** drained `pending_storage_deletions` rows (`status='deleted'`, `updated_at` older than the 7-day grace) are terminally purged by `purgeDrainedStorageDeletions` (per-user transactions, legal-hold consult fail-closed before and inside the tx), folded into one bounded key-free `audit_logs` record per user (`storage_deletion_ledger_purged` — counts, family/type breakdowns, attempts total, timestamp bounds, SHA-256 digest of the purged ledger **IDs**); `pending`/`failed` rows are never purged and never folded as deleted (`failed` rows remain a dead letter until #1171) | **GAP-I (#1128)** |
| §4.2 Backups | **NOT VERIFIED** | C-L2 (existing, activation-blocking) |
| §4.3 Processors/logs | **INVENTORY DESIGNED — propagation NOT BUILT; vendor retentions NOT VERIFIED** | **GAP-J (#1129); builds: #1179–#1182; counsel: §6.2** |

### Gap register for Lead to file (one story per root-cause family — the
### S-076/S-078/#813 filing pattern; this doc is the spec basis for each)
- **GAP-A — Interview content survives erasure (P1, launch-blocking class).**
  (1) Strip `interview_sessions` content at erasure (`conversation`,
  `frame_analysis`, residual content keys, `invite_token`) — independent of
  ruling R-1; (2) fix the transcript delete to reach session-linked
  recordings (the mig-130 XOR join defect); (3) ledger `interview_recordings`
  storage objects at erasure for immediate Phase-2 deletion and dispose of
  the row per R-1's family decision; `recording_objects` rows of type
  `frame` (candidate-keyed) enter the same path — type `recording` rows are
  written with NULL `candidate_id` (dormant writer; note, don't build on it).
  Privacy engineer mandatory (erasure-story rule).
- **GAP-B — Score & assessment leftovers.** `score_snapshots`,
  `omniscore_results`, `score_appeals`, `mutual_matches`, `screening_logs`,
  `skill_assessments`, `job_assessment_attempts` + `assessment_conversations`,
  `assessment_sessions` + `assessment_events`. Per-table delete-vs-redact
  scoping at STOP 1 (#780 pattern); note `assessment_conversations` only
  dies with a hard parent DELETE — specify, don't assume cascades.
- **GAP-C — Scheduling & human-interview family.** Tables at E-13.
- **GAP-D — BGV & onboarding documents (highest sensitivity).** Tables at
  E-12; SSN/I-9/bank-class data named in the story body; privacy engineer +
  Lex seated at STOP 1; coordinates with the M17 data inventory (R-6).
- **GAP-E — Profile-adjacent & career leftovers.** Tables at E-11;
  `candidate_demographics` (special category) named first.
- **GAP-F — Communications & notifications family.** Tables at E-15;
  counterparty treatment follows K-7/R-2.
- **GAP-G — Account residuals & tokens.** `users.linkedin_data`/`title`/
  `github_username` tombstone completion; `calendar_connections`,
  `oauth_exchange_codes`, `user_settings`, `user_roles`, `usage_limits`,
  `assessment_referrals`, `refresh_tokens` terminal disposition.
- **GAP-H — Consent-fact redaction consistency.** Redact
  `consent_records`/`consent_history` PII (IP/UA) on erasure, mirroring
  `recording_consent` (K-1).
- **GAP-I — Erasure-ledger & audit hygiene.** Terminal purge for drained
  `pending_storage_deletions` rows (fold into the bounded K-2 record);
  Phase-2 audit metadata minimisation going forward (no raw storage keys).
- **GAP-J — Processor & log retention inventory.** Brevo, AI providers,
  LiveKit, app/error logs, telemetry: per-processor retention or deletion
  propagation (§4.3). Inventory first; build follows the inventory.

Existing homes confirmed, **not** re-filed: #780 (E-6, PR #1115 at gate),
#813 (E-7/E-8), #829 (E-9), #805 (purge arming gate), #1116 (DSAR held-row
disclosure), #721 (legacy plaintext frames remediation — a remediation plan,
never an erasure mechanism), #917-class hold-audit items.

---

## 6. Decisions this table needs

### 6.1 Sumanth's rulings (policy choices — not code fixes, not counsel)
- **R-1 — Interview session skeleton:** keep a content-stripped session row
  (K-4) or delete the row at erasure? (GAP-A's content strip proceeds
  either way.)
- **R-2 — Counterparty messages:** confirm the shipped K-7 treatment
  (candidate's sent messages deleted; recruiter's side of the thread
  remains) or change it — a product/UX call with a compliance floor.
- **R-3 — Anonymisation threshold:** the cohort/suppression bar an
  "aggregate" must clear to be kept at all (K-11).
- **R-4 — Verification outcome fact:** does "was verified (yes/no, date)"
  survive erasure under the K-1 consent-fact regime, or erase with the
  documents (E-10)?
- **R-5 — Decision-accountability skeletons:** adopt the privacy position
  (K-9: redact `human_overrides` / `ai_screening_audit_logs` to de-linked
  skeletons) — decided at **#813's D-1 gate**, where the current tentative
  direction (whole-delete via cascade) differs; #829 inherits the answer.
- **R-6 — Payroll/employee family:** confirm §4.4's scope statement
  (employer statutory records, outside candidate erasure) as the standing
  disposition, tied to the M17 inventory.

### 6.2 Counsel (legal determinations — tracker only, nothing sent)
Retention clocks for K-1, K-2, K-3, K-7, K-9, K-10 · Art. 17(3)(e)
necessity/limitation mapping for the skeletons · crypto-shredding
sufficiency (K-8) · backup-expunge disclosure wording + the PITR window
(§4.2, with C-L2 verification) · billing statute/period per jurisdiction
(K-6) · legal-hold discipline cadence (K-5) · processor-deletion contract
wording (§4.3) (inventory: #1129; tracker items C-P*) ·
erasure-confirmation wording (§4.3) · B-J3 — expiry-only reliance
(GAP-J boundary register, #1129) · B-J4 — AI-provider
retention/training acceptance (GAP-J boundary register, #1129) ·
C-NEW-01 / C-NEW-03
(§4.1) · the standing tracker (C-01–C-08, #788) is unchanged by this doc.

---

## 7. Machinery caveats (read before quoting any line above)

1. **The retention purge is not armed.** `RETENTION_PURGE_LIVE` has never
   been flipped (Sumanth's decision, pending), and the arming gate
   (`server.js:1011-1012`: flag **and** `NODE_ENV === 'production'`) can
   never pass on the Render services as configured — `NODE_ENV` is unset on
   both (Scout-verified; defect filed as #805, unbuilt). Every line whose
   mechanism is a *purge* (K-8 rows, recording expiry) is therefore
   design-true and operationally dormant today. **Erasure (§2) is the only
   live deletion path**, which is why GAP-A is P1-class.
2. **The purge soft-deletes.** Even armed, `purgeExpiredRecordings`
   soft-deletes `interview_recordings` rows (`status='deleted'`) and
   anonymises transcript text to `'[purged]'` — row disposition under a
   future arming decision must be stated then, not assumed now.
3. **Ordering invariant (verified by code read):** object inventory is
   enumerated from DB rows inside the erasure transaction (RETURNING
   clauses) — never from decrypted content — and DEK destruction rides the
   same transaction (`lib/biometricCrypto.js:~300-315`). A crash
   mid-erasure rolls back both; crypto-shredding cannot orphan
   un-inventoried ciphertext on the shipped paths.
4. **Fresh stories inherit the entry condition:** any story widening
   deletion consults the legal hold per row/object (the #799 pattern:
   erasure gate → Phase-2 per-entry → #1115 per-row), fail-closed.
5. **This table is versioned with the build.** It describes
   `origin/dev @ e5599900` + PR #1115's branch. When #1115 merges and
   #813/#829/GAP stories land, the affected lines' status cells are updated
   in the same PRs — a status cell that disagrees with the code is a defect
   in this doc, filed like any other.

*— Lex, 2026-10-13. Specialist review: privacy engineer (findings
incorporated; its net position is §1 Principle 3 and the §3 clock
discipline). Evidence: Scout's 241-table sweep + Lex's full read of
`lib/erasureService.js`. Advisory only — not a legal determination.*
