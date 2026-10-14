# Rekrut AI — Data Model Simplification Assessment

*Assessment only — no code, no schema changes, nothing dropped, no stories filed.
Produced 2026-10-14 under Sumanth's strengthened mandate: **"for the data model i want
it to be more better not complicated."** The centre of this document is therefore the
**target simplified model and the safe path to it** — the verdict on today's model is
in §4, supporting.*

**Seats:** Rex (architecture — owns the target design and the verdict) · Sage
(modernize — owns every migration path) · Scout (evidence — reader/writer
verification) · Lead (points and sequencing; all points are **SKETCH**, assessment-
grade, not commitments). Coordinated under Sumanth's no-solo-recommendation rule: the
positions below are the discussed team positions, with dissent preserved where it
exists (see C-04).

**Evidence base:** the merged data pack in this folder ([data-model.md](./data-model.md),
[schema.md](./schema.md), [migrations.md](./migrations.md),
[rls-policies.md](./rls-policies.md), [seed-data.md](./seed-data.md), PR #1118), the
erasure keep/erase table (PR #1119), and fresh reader/writer verification against
`origin/dev` @ `b7dcfe8b` for this assessment. **Standing caveat:** no live database
is reachable from the build environment. Every liveness claim below is *code*
evidence; live row counts and live-only objects are **NOT VERIFIED** wherever marked,
and no drop in this document is authorised by code evidence alone (§3 proof standard).

**Premise corrections found by this assessment** (the pack's suspicions did not all
survive verification — these corrections change the plan, so they lead):

1. **`ai_prompts` is not dead.** `server.js:1267–1470` implements live, admin-gated
   CRUD + A/B-test endpoints over `ai_prompts` / `ai_prompt_versions` / `ai_ab_tests`.
   What *is* true: **no AI inference path reads the registry** — prompts the product
   actually runs do not come from it. It is a control plane that controls nothing:
   live endpoints, dead purpose. (Scout, Rex, Sage, Lead — independently verified.)
2. **The 013 consent family is not superseded.** `consent_records` / `consent_history`
   are written today by `routes/compliance.js:166` and
   `services/euComplianceService.js:1090–1165`, and read by compliance, admin, and
   DSAR paths — *while* the 244 family (`consent_texts` / `consent_receipts`) is
   concurrently written by `lib/consentService.js` for session/observer consent.
   **Both consent families are live and writing, and neither is a superset of the
   other.** This is split-brain in the one domain where two partial truths are a
   legal exposure, not an inconvenience.
3. **`omniscore_results` has readers but no writer.** Zero `INSERT`/`UPDATE` against
   it exists anywhere in the repo; five reader files remain, including
   compliance-critical ones (`services/biasDetection.js`, `services/scoreExplainer.js`,
   `services/euComplianceService.js`, `routes/compliance.js`). It is read-only legacy,
   not a live duplicate — the fix is re-pointing readers after a parity proof, not
   merging two live engines.

---

## 1. The better model — target design

### 1.1 Design principles

The target is **not a new architecture**. The current centre — three hubs
(`users`, `jobs`, `companies`), one interview spine, one erasure choke point,
per-candidate crypto — is sound and stays. The target is the same architecture with
**one home per concept**, plus rules that stop the sediment from re-forming.

1. **One concept, one home.** A second table for an existing concept is a defect
   filing, not a design choice.
2. **Derived data is rebuildable or it doesn't exist.** Any copy must be regenerable
   from a named canonical source, with its sync mechanism and rebuild path declared.
3. **Complexity is admitted only where the domain or the law charges for it** —
   joint candidate×company records, consent evidence, biometric segregation,
   per-candidate crypto. Everywhere else, boring wins.
4. **A table is born with its death story.** No new table ships without a registered
   erasure disposition and retention behaviour (§2, rule R-5).

### 1.2 Entity groups and canonical homes

**IDENTITY & ACCESS** — `users` (account + soft-delete tombstone) · `companies`
(`owner_id` is the ownership truth, never a role string) · **RBAC is the only role
system**: `roles` / `permissions` / `role_permissions` / `user_roles`. `users.role`,
if it survives at all, is a derived coarse class (candidate / recruiter-side /
admin) — never a source of truth, never written `'owner'`.
*New work lands here:* any new role or permission → RBAC tables only.

**CANDIDATE** — `candidate_profiles` (+ `candidate_skills`, `work_experience`,
`education`) · the CV pipeline as ordered stages: `cv_uploads` → `parsed_resumes` →
`cv_analyses` → `cv_reviews` · `candidate_data_keys` (per-candidate DEK) ·
`candidate_embeddings` = the **only** embedding store.
*New work lands here:* candidate facts → the profile family. Anything searchable must
be derivable from these tables, never a new hand-maintained copy.

**HIRING PIPELINE (joint candidate × company)** — `jobs` → `job_applications`
(joint row: candidate content redactable, company skeleton retainable — the #780
design) → **`interview_sessions` (migration 129) is the only session table**:
screening, AI interview, practice, human, and scheduled interviews are `type`
values on the spine, with recordings, transcripts, and observer artefacts hanging
off it. `offers` → `employees` (post-hire).
*New work lands here:* any new interview flavour = a new `type` + `config`, never a
new session table. Legacy session tables are read-only history until their runtimes
retire onto the spine.

**SCORING (one architecture, two names — Sumanth's 2026-10-13 ruling)** —
Candidate: **`omni_scores`** (current value) + `score_components` (why) +
`score_history` / `score_snapshots` (defensibility) + `score_appeals` (the
candidate's right to appeal). One table answers "what is the score."
Company: **`trust_scores`** + `trust_score_components` + `trust_score_history`,
engine `services/trustscore.js`. `services/trustscore-standalone.js` stays separate
**by design** — supplementary metrics, promotable into the product without ever
diluting the v2 denominator (the #175 finding: its "duplicate engine" premise was
false). No score is ever shown without data — "Insufficient data", never a
fabricated number; practice scores live in a readiness panel beside OmniScore,
never inside it.
*New work lands here:* a new factor → components of the canonical score; a new
experimental metric → the standalone pattern, not the denominator.

**CONSENT, PRIVACY & AUDIT (platform-owned)** — Consent: **`consent_texts` /
`consent_receipts` (244) is the only consent family** — versioned text, receipt
pinned to the exact text consented to. The 013 family becomes a read-only archive
behind a provable, lossless mapping, then retires. Erasure:
`lib/erasureService.js` remains the single choke point; `legal_holds` gates every
path, fail-closed. Audit in three legally distinct tiers, no more: `audit_logs`
(general; absorbs `activity_log`), `compliance_audit_trail` (DSAR/compliance),
`biometric_audit_log` (append-only by trigger, segregated).
*New work lands here:* every new data family registers its erasure + retention
behaviour in the choke point at birth.

**BIOMETRIC & OBSERVER (segregated by design)** — `biometric_templates` (FK-less,
opaque `subject_ref`) · observer artefacts keyed to `interview_sessions`
(`ai_observer_reports`, `observer_jobs`, speech measurements, capture outcomes) ·
`recording_objects` registry for storage objects. FK-lessness here is a safety
property, not neglect (C-11).

**PLATFORM** — notifications on **one** queue family (today there are two parallel
queues — `notification_queue` and `email_queue` — and two template tables), 
`data_retention_policies`, `pending_storage_deletions`. The `ai_prompts` registry
appears in the target **only if** it is wired into the inference path; a control
plane must control something (C-02, Sumanth's decision).

### 1.3 Canonical table per contested concept

| Concept | Today (all live unless noted) | Canonical in target | Fate of the others |
|---|---|---|---|
| Interview session | `interview_sessions` + `screening_sessions` (no runtime creator left), `mock_interview_sessions`, `scheduled_interviews`, `interview_events`, `interviews` (read-only), `practice_sessions` — 7 structures | `interview_sessions` | Legacy tables retire flow-by-flow behind the `unified_interviews` view pattern (migrations 236/237 already prove the shim); `interviews` retires when its last stats reader moves |
| Consent | 013 family **and** 244 family, both writing | `consent_texts` / `consent_receipts` (244) | 013 family: dual-write → backfill with provenance → read-only archive → retire (Lex-led, C-05) |
| Candidate score | `omni_scores` live; `omniscore_results` read-only, **no writer** | `omni_scores` (+ components/history/snapshots/appeals at their own grains) | `omniscore_results` readers re-pointed after parity proof, then table retires (C-07) |
| Company score | `trust_scores` family + two services | `trust_scores` family | **Nothing changes** — `trustscore-standalone.js` is a separate metrics pack by design |
| Roles | `users.role` (43 files read it; ~188 hits) vs RBAC `user_roles` (~6 SQL sites) | RBAC `user_roles` | `users.role` demoted to derived coarse class, then dropped at contract (C-06) |
| Candidate search | `candidate_search_index` — trigger-synced copy of embeddings **plus plaintext PII** | `candidate_embeddings` + `candidate_profiles` as sources | Index loses its PII columns first, becomes a rebuildable materialisation or a view, then the copy retires (C-08) |
| CV / resume | `cv_uploads`, `parsed_resumes`, `cv_analyses`, `cv_reviews` | All four — they are pipeline **stages**, not copies | No merger. One storage-key registry for the file all stages reference (C-09) |
| Audit | `audit_logs`, `activity_log`, `compliance_audit_trail`, `biometric_audit_log` (+ `verification_audit_log`, liveness NOT VERIFIED) | Three tiers (general / compliance / biometric) | `activity_log` folds into `audit_logs`; the segregated trails **stay separate — legally load-bearing** |
| Notifications | `notification_queue` **and** `email_queue`; `notification_templates` **and** `communication_templates` | One queue family, one template home | Second queue/template set retires after a liveness + routing pass (minor candidate, C-12) |
| Prompts | `ai_prompts` family administered, never executed from | — | Retire (endpoints first, tables after observation) **or** wire into the AI path — Sumanth's ruling (C-02) |

### 1.4 Target table count — the honest arithmetic

Today: **239 tables** (schema.md census; Scout's independent DDL parse finds 243
distinct names — the delta is **NOT VERIFIED**, method-dependent; 239 is used
throughout as the pack's audited figure).

The reduction, by move — every line individually gated by the §3 proof standard:

| Move | Tables | Confidence |
|---|---:|---|
| Never-referenced set retires (12 tables created but referenced by no runtime code: `ai_agent_actions`, `career_recommendations`, `document_hash_records`, `employee_benefits`, `interview_rooms`, `learning_paths`, `notification_audio_cache`, `offer_templates`, `skill_gap_analyses`, `tax_documents`, `transcript_highlights`, + `biometric_session_map` if its gate clears — C-03/C-04) | −11 to −12 | Per-table proof still owed (live-DB rows NOT VERIFIED) |
| `ai_prompts` family retires (if Sumanth rules retire, C-02) | −3 | Conditional on the ruling |
| `omniscore_results` retires (C-07) | −1 | High — no writer exists |
| Consent 013 family retires after archive (C-05) | −2 | High on direction, slow on path |
| Legacy session tables retire at the end of the strangler (C-10): `screening_sessions`, `mock_interview_sessions`, `scheduled_interviews`, `interview_events`, `interviews` | −5 | Direction high; timing is quarters, not sprints |
| `activity_log` folds into `audit_logs` | −1 | High |
| `candidate_search_index` copy eliminated (if the view/materialisation route proves out, C-08) | −0 to −1 | Conditional on search-parity proof |
| Second notification queue retires (C-12) | −0 to −1 | Needs its own liveness pass |

**Target: ≈ 212–216 tables** (from 239), i.e. roughly 25 tables — about 10% — are
duplication or dead weight. **State this plainly to builders: the other ~90% of the
tail is not duplication.** Most of the 239 are single-purpose feature tables whose
"complexity" is just the product's breadth. What actually hurts builders is not the
count — it is the **9 contested concepts** in §1.3 where two or three structures
answer the same question. The target fixes those 9, and the conventions in §2 stop a
tenth from forming. A programme that chased the raw count instead would spend its
risk budget on tables that harm no one.

## 2. Conventions — how it stays simple (anti-accretion rules)

Each rule is grounded in a failure the current schema actually exhibits. These cost
nothing to adopt and are the highest-value part of this assessment: cleanup without
them is a treadmill.

- **R-1 · One CREATE per table, in its owning migration.** Later changes are
  `ALTER`s. *Failure it prevents:* 17 tables are created by more than one file
  today (20 redundant `CREATE TABLE IF NOT EXISTS` statements that silently no-op);
  `notification_templates` is created **three times** (035, 061, 2024-06-13) and
  the whole notification family twice (035 vs 061) — after which nobody can say
  which definition is real without reading all of them.
- **R-2 · Migration naming is `NNN_snake_case` only, tracking name = filename.**
  No date-named, epoch-named, or letter-suffixed files. *Failure it prevents:* 4
  date-named files, one epoch-named file (`1739617200000_…`), the `p2`–`p7` series,
  and three different files sharing number 070 — all of which sort somewhere other
  than where their name suggests (migrations.md, Mechanics), plus exported `name`s
  that differ from filenames, so the tracking key is not the file you are looking at.
- **R-3 · Every new table declares its owner and anchor in its migration header** —
  candidate / company / joint / platform, and the hub it hangs off. *Failure it
  prevents:* 46 anchor columns exist outside the four deliberate FK-less designs
  with no recorded reason (Scout's DDL scan) — nobody can later tell neglect from
  intent. FK-less is allowed **only** with the reason written in the header, as
  migrations 246/252/253/258 already do.
- **R-4 · Derived data declares its source, sync, and rebuild.** Any table whose
  content is copied from another table names its canonical source, its sync
  mechanism, and how it is rebuilt from scratch. *Failure it prevents:*
  `candidate_search_index` — a trigger-synced second copy of the embedding **plus
  plaintext PII**, flagged CRITICAL inside the erasure code itself (S-075); a copy
  that can drift, doubles erasure surface, and whose rebuild path nobody wrote down.
- **R-5 · A table is born with its death story.** The creating migration (or its
  story) registers: erasure disposition (hard-delete / redact / retain-with-basis,
  per the keep/erase table, PR #1119), retention clock, and legal-hold behaviour.
  *Failure it prevents:* the recurring programme pattern of 2026-10 — erasure gaps
  (#780, #813, #829, GAP #1120–#1129) discovered years after the tables shipped,
  each requiring its own remediation chain.
- **R-6 · Two structures for one concept = a defect, filed at review.** A PR that
  introduces a parallel table/registry/queue for an existing concept must either
  name the canonical home it will retire, or the reviewer files the duplication as
  a defect. *Failure it prevents:* the consent split-brain — a second consent
  family shipped (244) without retiring or fencing the first (013), so both are
  live and writing today, each holding consent facts the other cannot see.
- **R-7 · Session-shaped data goes on the spine.** Any new interview/screening/
  practice concept is a `type` + `config` on `interview_sessions`, never a new
  table. *Failure it prevents:* seven session-shaped structures (§1.3), each with
  its own consent gate, erasure path, and lifecycle for a builder to check.
- **R-8 · A registry must have a consumer.** No admin registry/control-plane table
  ships without a named runtime consumer in the same story. *Failure it prevents:*
  `ai_prompts` — a full CRUD + A/B-testing surface administering prompts that no
  inference path executes (premise correction 1).

## 3. The proof standard — before anything is dropped

Sumanth's standing rule (no deletion without explicit scope confirmation) applied to
schema: **nothing in §5 is authorised by this assessment.** Each drop or contract
step must clear all of the following, as gate evidence on its own story:

1. **Zero readers and zero writers, proven on the live surface** — enumeration of
   Express routes, `server.js` inline routes, services/lib, workers (**including
   the in-process Observer worker and dormant Gate A capture paths**), cron/purge
   jobs, and DB-side objects (triggers, functions, views defined in migrations).
   *Grep-absence in app code is not proof* — this assessment itself overturned two
   "dead" labels (`ai_prompts`, the 013 consent family) that a narrower search
   would have certified.
2. **Live-DB introspection evidence** from an environment that can reach the
   database (staging-QA / Neon path): row counts, `pg_tables` / `pg_indexes` /
   `information_schema` output for the object, attached to the gate. The build VM
   cannot produce this; "NOT VERIFIED from here" never authorises a drop.
3. **A full test cycle green** on the post-change tree, including the erasure
   end-to-end test on a test account and Quinn's role/QA matrix where the surface
   is authorisation-bearing.
4. **Erasure + retention re-verification** against the keep/erase table
   (PR #1119): the change updates the disposition of every affected table in the
   same PR series. A table left in the erasure list after it is dropped can abort
   account deletion entirely; a merged table missing from the list silently
   survives erasure. Both failure modes are documented in §5.
5. **An observation window** proportionate to the surface's frequency: dormant and
   low-frequency paths (admin surfaces, dormant workers) require ≥30 days and ≥2
   deploy cycles of no-use evidence; live-flow consolidations require parity over
   at least one full cycle of that flow (including completed, cancelled, and
   expired instances) before the contract step.
6. **Staging is not a rehearsal.** Staging and production share one database and
   migrations run at boot — every migration in this programme is a production
   schema event, gated as one (own migration number >258, own approval, own
   rollback story). The migration runner never executes `down`: every rollback
   below is a read-flag flip, a forward migration, or a rebuild-from-source.
   **Prerequisite:** the fresh-database halt at migration 238 (#894) must be fixed
   before any consolidation class begins — until a fresh DB builds to 258, no
   schema change can be proven on the fresh path at all.

## 4. Verdict on the current model (supporting)

**In plain words: the core of the model is good. The complexity Sumanth feels is
mostly not the core — it is the sediment around it.** (Rex)

The centre is sound and, for a pre-launch product, well-built: three clear hubs
(`users` — 162 child tables by Scout's DDL count; `jobs` 48; `companies` 29), one
unified interview spine (129), a single erasure choke point with a fail-closed
legal-hold gate *first*, per-candidate crypto-shredding that makes erasure real
including in backups, and retention actually enforced in code rather than merely
written in a policy table. A bad model would not have those properties. But the
pack's own core diagram needs ~30 tables; the other ~200 are long tail, and inside
that tail the same concept is built two or three times in different eras, all still
alive. **The model needs an editor, not an architect: do not redesign it — shrink
it by consolidation, and fence it with §2.**

### Essential complexity — load-bearing, do not "simplify" away

| Complexity | Why it is essential |
|---|---|
| Two-sided ownership + joint rows | A hiring marketplace *is* candidate × company pairings; `job_applications` holds both sides' content in one row because the domain does. The candidate-safe projection allowlist exists precisely because this jointness is real. |
| Consent + audit as first-class data | Consent facts are retained past erasure on purpose (Art. 7(1)); `recording_consent` is redacted, not deleted. Law, not clutter. |
| Per-candidate crypto (DEK) | Crypto-shredding is what makes erasure real including in backups; the no-DEK tombstone (preventing resurrection by a racing write) is the mark of a model that was thought through. |
| FK-less segregation | `biometric_templates` (opaque `subject_ref`), `legal_holds` (a hold must not cascade away), `recording_objects`, `pending_storage_deletions` — deliberate and documented in migration headers. A safety property. |
| Two scores, two names | Sumanth's ruling (2026-10-13): OmniScore = candidate, Trust Score = company. A product decision, not sprawl. |
| `users` soft-delete tombstone | Frees the email for re-registration while preserving joint-record integrity. The correct trade-off for a two-sided system. |

### Accidental complexity — the actual target

Parallel session structures from successive unification attempts that added a layer
instead of replacing one (§1.3) · split-brain consent (premise correction 2) · a
score-result table with readers but no writer (correction 3) · a search index that
is a second, PII-bearing copy of the candidate · dual role representation with
drift (including a transfer write of `users.role='owner'` **outside the column's
CHECK list** — whether that write fails on the live DB is NOT VERIFIED, and either
answer is a finding: broken transfer, or schema drift) · phantom schema (migration
070 indexes two tables no migration creates; the failure is swallowed per-index) ·
an administered-but-unconsumed prompt registry (correction 1) · 17 duplicate
CREATEs and three naming conventions across 155 migration files.

## 5. Candidate register — graded, with the safe path per candidate

Grades: **(a)** drop dead weight · **(b)** consolidate to one canonical home ·
**(c)** leave alone, load-bearing. Points are Lead's **SKETCH** figures unless a
line says the evidence narrowed the scope (then the re-sketch is labelled as such).
Steps are Sage's, sized to file as stories the moment Sumanth rules a candidate in.
**No candidate is filed by this document.**

### C-01 · Prerequisite: fix the fresh-database halt (#894)
Not a simplification — the proof infrastructure for all of them. Mechanism is fully
known (bootstrap `candidate_profiles` lacks `bio`; 004's richer CREATE is an
`IF NOT EXISTS` no-op; 238's view selects `cp.bio` → rollback, exit 1, ≥239 never
apply). **Path:** (1) fix; (2) first-ever full fresh-build run to 258 + boot test —
budgeted for ≥239-on-fresh-path surprises, never yet exercised. **Points: 5 SKETCH**
(the fix is ~1; verification is the price). **Sequencing: pre-launch, standalone
PR, standalone gate** — it also gates D2 confidence: the D2 boot applies 252–258 to
the shared DB with no fresh-build fallback if an environment must be rebuilt.

### C-02 · `ai_prompts` family — retire it or wire it (Sumanth's decision)
**Evidence:** premise correction 1 — live admin CRUD in `server.js:1270–1470`; zero
inference-path or frontend consumers found (an admin UI outside `src` is NOT
VERIFIED). **Grade: (a) conditional drop** (Rex) — the condition is one question:
*does anyone use those endpoints?* **Path (Sage, strangler at the API layer):**
(1) product decision on the record: abandoned, not paused; (2) remove/410 the
endpoints in a code deploy with **no schema change**; (3) observation ≥30 days /
≥2 deploy cycles (admin surfaces are low-frequency — a week proves nothing);
(4) DROP in FK order (`ai_ab_tests`, `ai_prompt_versions`, `ai_prompts`) in its own
migration — 039 also creates `ai_call_log`, which **is** live on a non-admin path
and stays. **Points: 5 SKETCH** (+3 if an admin UI retires too). **Relief point:**
step 2 — the misleading surface disappears before the tables do. **Breaks if
careless:** dropping tables first 500s an admin surface someone still uses,
discovered by a user; dropping the parent before children fails the boot migration
— and a failed boot migration means the service never starts (§3.6).

### C-03 · The never-referenced set (11 tables)
**Evidence (Scout):** created, but referenced by no runtime or client code:
`ai_agent_actions`, `career_recommendations`, `document_hash_records`,
`employee_benefits`, `interview_rooms`, `learning_paths`, `notification_audio_cache`,
`offer_templates`, `skill_gap_analyses`, `tax_documents`, `transcript_highlights`
(plus `verification_audit_log` — liveness NOT VERIFIED, same batch).
**Grade: (a) drop, per-table gated.** **Path per table:** (1) §3 proof — route/
worker/cron/DB-object enumeration + live-DB row count; any table with rows or a
found reference exits the batch and is re-graded individually; (2) drop in a small
series of own-numbered migrations (never one bulk drop — a single surprise must not
block or bless the rest). **Points:** Lead priced the exemplar C-04 at 3; by the
same unit logic the verify-all + drop-all set is **~13 SKETCH**, re-estimated per
table at filing. **Relief point:** mostly honesty, not daily pain — the win is a
schema a builder can trust to be real. **Breaks if careless:** several of these
names *sound* load-bearing (`offer_templates`, `employee_benefits`, `tax_documents`)
— that is exactly why each clears §3 individually; a live-DB-only consumer (a manual
ops query, an external report) is invisible to code search.

### C-04 · `biometric_session_map` — drop candidate, GATED (dissent preserved)
**Evidence (Scout):** zero runtime readers/writers; only its CREATE (246), its
migration test (which asserts the CREATE string, never queries it), and docs. Its
own schema comment calls it *the* bridge between biometric data and session
identity — a bridge nothing crosses. **Rex's grade: (a) drop** — it misleads
builders into designing around it, and if a bridge is ever needed it should be
rebuilt against the then-real design. **Sage's dissent, preserved:** the table is
**dormant-by-design, not dead** — migration 246 (S-058) makes it the only
*authorised* join path for a segregation design whose activation is Gate A's dated
re-entry contract (2026-11-01 / 2026-12-01), still open; grep-absence is the
*expected* state of that bridge today. **Synthesis (the gate):** no drop is filed
until (i) live-DB row count = 0 is evidenced, (ii) no `biometric_templates` rows
exist that it would orphan into permanent unattributability, and (iii) a Lex/Rex
ruling records that the 246 segregation design is superseded *or* Gate A re-entry
has resolved. If those clear, the drop is **3 SKETCH** (Lead), preceded by a
rename-to-`_deprecated_` observation step (Sage). **Breaks if careless:** the
dormant capture stack activates and finds its only lawful join to session identity
gone — or someone "fixes" it with an ad-hoc FK from templates to users and silently
destroys the segregation the design exists for.

### C-05 · Consolidate the two consent families onto 244 — (b), HIGH risk
**Evidence:** premise correction 2 — both families live, different grains and
surfaces: 013 serves GDPR consent/withdrawal + admin reporting
(`routes/compliance.js`, `euComplianceService`); 244 serves session-scoped,
text-version-pinned consent (`lib/consentService.js`, observer capture gate).
**Grade: (b) consolidate onto `consent_texts`/`consent_receipts`** — the
versioned-text + pinned-receipt design is strictly stronger (a receipt proves
*which text* was consented to; 013 cannot). **Path (Sage, expand→migrate→contract,
Lex-led):** (0) canonical-model decision — the canonical schema must carry both
grains (session-scoped receipts *and* user-scoped records) or explicitly rule one
out; (1) expand: provenance columns (`source_family`, `source_id`) on the canonical
tables, kept **permanently**; (2) dual-write from **both** writer sets;
(3) backfill 013 → canonical with original timestamps/IP/user-agent verbatim —
never synthesised provenance (Never-list #7); (4) shadow-read the DSAR export from
canonical, diff vs legacy — **zero unexplained differences** per test subject, and
per consent type the Art. 7(1) chain must still answer who / when / what text was
shown / from where / when withdrawn ("text version: none existed" represented
honestly for migrated 013 rows); (5) contract 013 last, separately. **Gate A
hazard, named:** `observer_capture` deliberately has **no** `consent_texts` row,
so `recordConsent()` throws for it — a consolidation that "helpfully" seeds that
text would arm biometric-capture consent counsel has not cleared (#788 open).
**Points: 13 SKETCH** (Lead). **Relief point:** step 4 — builders and DSAR stop
consulting two truths. **Sequencing note (seats differed):** Lead's cheap-first
order placed C-05 mid-programme; Sage places it **last**, with sessions, because
consent rows are legal evidence and the counsel boundary is open. **The synthesis
adopts Sage's placement** — risk class outranks builder pain here.

### C-06 · Retire `users.role` — RBAC is canonical — (b), HIGH risk
**Evidence (Scout, quantified):** the legacy column is read at ~188 tight-pattern
sites across **43 runtime files**; RBAC `user_roles` has ~6 SQL sites. RBAC has
**no `employer` role at all** — bridged by a legacy fallback
(`middleware/rbac.js:93-99`). Ownership transfer writes `users.role='owner'`
(`routes/company.js:1324`), outside `chk_users_role`'s list — live-DB behaviour
NOT VERIFIED (§4). **Grade: (b)** — `user_roles` canonical; `users.role` demoted to
a derived coarse class, then dropped. `companies.owner_id` remains the ownership
truth throughout. **Path (Sage, code-first; the schema drop is the last 5%):**
(1) **alone, first:** resolve the `'owner'` write — stop writing it (coarse class
instead) *or* deliberately extend the CHECK; a Lex/Rex-level decision, shipped and
observed before anything else moves — this step is a **defect fix**, independent
of the simplification decision, because either the write fails live (transfer is
broken) or the constraint isn't live (drift); (2) parity report: every user's
`user_roles` rows vs their coarse role, divergences published (multi-company users
are *expected* divergences — a scalar cannot represent candidate-here /
recruiter-there, which is itself the proof the column must go); (3) single
authorisation reader computing both, logging divergences, enforcing RBAC; call
sites migrate route-by-route behind a flag; dual-write of the legacy column
continues; (4) contract: drop `users.role` + its index + CHECK in its own
migration after **≥30 days and ≥1 full promotion cycle** of shadow logs with zero
*unexplained* divergences, covering the low-frequency paths (transfer, admin,
both signups, recruiter approval). **Points: 34 SKETCH** (55 if the live CHECK
check fails). **Relief point:** step 3 — one place answers "can this person do X".
**Breaks if careless:** search/matching/omniscore still filter `u.role='candidate'`
— drop early and candidate search breaks, or worse, a defensive fallback returns
*unfiltered* candidates (the visibility-breach class this app has already had);
retire the read but keep an OR-both admin check and the stale column becomes a
privilege-escalation backdoor.

### C-07 · Score tables — retire the one true duplicate; leave the grains alone
**Evidence:** ten score-shaped tables, but they are mostly **different temporal
grains**, not copies: current state (`omni_scores`), components, history, weekly
snapshots (`score_snapshots`, engine-private:
`services/omniscore.js:837` write / `:1186` read), appeals (a live candidate-facing
workflow — `routes/compliance.js:373` files, `routes/admin.js:1784` resolves),
plus the company family and `interview_composite_scores`. The one true duplicate
suspect is **`omniscore_results`** (premise correction 3: readers, no writer).
**Grade: (b) narrow** — retire `omniscore_results`; **(c) leave** the grains,
`score_appeals`, the whole Trust family, and `trustscore-standalone.js` (Rex + Sage
agree; merging candidate and company scores is additionally barred by Sumanth's
2026-10-13 ruling). **Path (Sage):** (1) semantic diff of `omniscore_results` vs
`omni_scores` — never merge on assumed identity; (2) dual-read comparison +
recomputation parity (totals recomputed from `score_components` match
`omni_scores`, spanning **≥2 weekly snapshot cycles and one decay interval**);
(3) re-point the five reader files to `omni_scores`; (4) retire the table in its
own migration. **Prerequisite:** the ruled behaviour change lands **first** —
practice scores come OUT of OmniScore (#791); consolidating before that removal
bakes the wrong inputs into the new shape. **Points:** Lead's **34 SKETCH** priced
the full ten-table consolidation the evidence does not support; the narrowed scope
above re-sketches at **~13 SKETCH**. **Breaks if careless:** merged-on-assumption
scores are silently *wrong* scores — the worst failure class in this product; a
merged table missing from the erasure list survives erasure (an Art. 17 breach and,
ironically, an unconsented score-resurrection); flattening history destroys the
ability to defend an appealed score as it stood when appealed.

### C-08 · `candidate_search_index` — strip the PII, then eliminate the copy — (b)
**Evidence:** trigger-maintained copy of `candidate_embeddings` **plus plaintext
PII** (`name`, `avatar_url`, `bio`, `location`), `omni_score`/`score_tier`, and its
own embedding — and it is the **live** recruiter-search read path
(`routes/candidateSearch.js`). Erasure already flags it CRITICAL (S-075).
**Grade: (b)** — canonical data is `candidate_embeddings` + `candidate_profiles`;
the index becomes rebuildable or disappears. **Path (Sage — this class has the best
rollback story in the programme; use it):** (1) **minimise first:** strip the
direct PII columns; join them at query time from `candidate_profiles`/`users`
under the existing visibility SQL — most of the privacy exposure dies here, with no
performance risk; (2) view-shim: replace the table with a view (or thin query
rewrite) over the sources, keeping `candidateSearch.js` query shapes working;
(3) contract: drop sync function + triggers + table, **in that order**, one
migration. **Proof:** search-parity on a fixed test corpus (identical ID sets for
filtered search; ranking within a stated tolerance for semantic), `EXPLAIN
ANALYZE`/p95 latency parity (a plain view loses the vector/tsvector/filter indexes
— parity of results without parity of plan is not proof), visibility test
(soft-deleted/hidden candidates absent), erasure test (no copy remains anywhere;
the erasure entry is removed in the same change that drops the table, not before).
**Rollback is genuinely good:** the table is derived — rebuild from sources via the
`p3b` sync; keep the rebuild script until the window closes. **Points: 13 SKETCH**
(Lead). **Relief point:** step 1 — the privacy finding closes first. **Breaks if
careless:** `candidateSearch.js` defensively returns **empty results** when the
table is unavailable — drop first and recruiters silently see no candidates: a
business failure with no alarm. Inverse mistake: dropping `candidate_embeddings`
believing *it* is the copy — it is the source of truth for matching.

### C-09 · CV family — no merger; unify the storage key — (c) structure, (b) reference
**Evidence (all seats agree):** `cv_uploads` → `parsed_resumes` → `cv_analyses` →
`cv_reviews` are pipeline **stages** (intake → parse → analysis → review), each with
exactly one product writer plus erasure; nothing marks any of them legacy. The real
duplication is one level down: the same file is referenced from
`parsed_resumes.file_url`, `cv_uploads`, and `candidate_profiles.resume_url`
(erasure dedupe note, `erasureService.js:159-167`).
**Grade: (c)** for the stage tables; **(b)** for the reference. **Path (Sage):**
(1) new uploads write one canonical storage-key registry entry (the
`recording_objects` pattern already in the codebase); (2) dual-read resolution
(registry, fallback legacy); (3) backfill the registry from all three legacy
locations, deduplicated; (4) contract = drop the duplicate *columns*, keep the
stages. **Proof:** storage reconciliation — every reference maps to exactly one
registry entry and one real object, no orphans in either direction; erasure test
proves the object is deleted **once, completely**. **Points:** Lead's **21 SKETCH**
priced the merger the evidence rejects; evidenced scope re-sketches at **~10
SKETCH** (stage-ownership documentation ~2 + storage-key unification ~8).
**Breaks if careless:** `cv_analyses`/`cv_reviews` hold `ON DELETE SET NULL` FKs
to `parsed_resumes` — deleting parsed rows trusting cascade leaves derived PII
surviving, detached and invisible to a later erasure. That failure is documented
in the erasure code comments; reintroducing it regresses a fixed privacy bug.

### C-10 · Session consolidation onto `interview_sessions` — (b), HIGH risk, LAST
**Evidence (Scout, per table):** `interview_sessions` is the live spine (6 writer
files, 14+ reader files). `screening_sessions`: **no runtime INSERT exists** —
UPDATE-only on legacy rows (`routes/interviews.js`), DELETE in erasure; the code
itself comments the table is stale and that writing it "would produce dead invite
links". `interviews`: zero runtime writers, seven load-bearing readers (recruiter
candidate lists embed `best_interview_score`/`completed_interviews` subqueries
against it). `mock_interview_sessions`, `scheduled_interviews`, `interview_events`:
**fully live** — dedicated routes, calendar links, omniscore and email readers.
Children hang off legacy IDs (`interview_recordings.interview_event_id NOT NULL`,
`interview_feedback.interview_id → scheduled_interviews`, a column *named*
`interview_session_id` that points at `scheduled_interviews`). A seventh structure,
`practice_sessions`, is also live. The `unified_interviews` view (236/237) already
exists as the read bridge — the in-house precedent for the shim pattern.
**Grade: (b)** — the single biggest builder win available (one session concept, one
lifecycle, one consent gate, one erasure path; today a session fix must be checked
against up to six tables — the cross-module orphan-fix trap), and the highest-risk
item in this document. **Path (Sage, strangler, one legacy table at a time, ordered
by blast radius:** `interviews` → `screening_sessions` → `mock_interview_sessions`
→ `interview_events` → `scheduled_interviews` last**):** per table — (i) expand:
nullable `interview_session_id` link + backfill; (ii) dual-write, spine
authoritative, flavour as `type`/`config` (129 already models this); (iii)
shadow-read, then flag-flip reads; (iv) contract: replace the legacy table with a
**view of the same name** over the spine for one full cycle before any DROP is
proposed. **Proof per table:** dual-write parity (counts + field-level diff,
zero unexplained divergences) over ≥1 full hiring cycle for that flow incl.
completed/cancelled/expired; end-to-end staging-QA of the flow (create → conduct →
record → report → **erase**); erasure parity explicitly re-decided — erasure today
hard-deletes `screening_sessions` (:249) but **retains** `interview_sessions` with
keys stripped (:328-332); consolidating without re-deciding that asymmetry either
deletes joint records the design retains or retains screening PII the design
deletes. **Rollback:** until contract, a read-flag flip; after a true DROP, none —
which is why DROP is a separate, later, separately-approved step per table.
**Points: 55 SKETCH** (Lead; 34 only if the liveness audit had shown most tables
read-only — Scout's audit, now done, splits it: two retirement-class, three live
runtimes; 55 is the honest planning figure). **Breaks if careless:** invite-token
flows break silently for already-invited candidates; recordings orphan or
cascade-delete through legacy FKs — **recordings of real interviews destroyed**;
Sumanth's standing ruling violated (unify `scheduled_interviews` with
`interview_events` **non-destructively**); DSAR export (`routes/compliance.js:44`
reads bare `interviews`) changes shape unnoticed.

### C-11 · Leave alone — load-bearing (for the record, with reasons)
- **Trust Score family + `trustscore-standalone.js`** — coherent, one engine; the
  standalone service is a deliberately separate supplementary-metrics pack (its
  own endpoint, `routes/trustscore.js:482`); folding it in would retroactively
  change company scores. Name unification was considered and **rejected by Sumanth
  (2026-10-13)** — do not reopen.
- **Score grains** — `score_components` / `score_history` / `score_snapshots` /
  `score_appeals`: distinct jobs (explainability, audit, percentile snapshots,
  appeal defensibility), all live.
- **Segregated audit trails** — `biometric_audit_log` (append-only by trigger) and
  `compliance_audit_trail` (DSAR evidence): merging either into a general log
  weakens a legal guarantee. "Four audit tables" is closer to *one* too many
  (see C-12) than three.
- **The deliberate FK-less four** — `biometric_templates`, `legal_holds`,
  `recording_objects`, `pending_storage_deletions`: each header documents why.
  "Fixing" them with FKs reintroduces the cascade/resurrection failures they were
  designed against.
- **CV stage tables** (structure) — see C-09.

### C-12 · Minor folds — small, real, cheap
- **`activity_log` → `audit_logs` (b, Low–Med risk):** genuine era overlap with no
  legal argument (one writer `lib/activity-logger.js`, email denormalised in);
  ~5 SKETCH (coordinator sketch — not Lead-priced). Removes an email-bearing
  duplicate from the PII inventory.
- **Notification duplication:** two live queues (`notification_queue` BOTH-LIVE;
  `email_queue` single-file live) and two template tables. Needs its own liveness
  + routing pass before grading — **unpriced**; audit first, fold second.
- **Migration-070 phantom indexes (a):** the two target tables have no CREATE
  anywhere; the index statements already no-op (failures swallowed per-index).
  Path: live-DB introspection first (`pg_tables`/`pg_indexes` — if the tables
  exist live-only, that is a **drift finding**, not a reason to keep the indexes);
  then a `DROP INDEX IF EXISTS` cleanup in a new migration — **never edit 070**
  (it is tracked as run; editing changes fresh-DB behaviour only and silently
  diverges live from fresh). **Points: 2 SKETCH** (Lead). Rollback is the cheapest
  in this document: recreate the index.

### Investigation items (not simplification — surfaced by the evidence pass)
- **I-1 · Referenced but never created:** `candidate_job_matches` (read by
  `services/scoreExplainer.js` and `services/euComplianceService.js`) and
  `system_settings` (read by `routes/admin.js`) have **no CREATE anywhere**. If
  they don't exist on the live DB, those reads are failing or being swallowed —
  including in a compliance service. Live-DB introspection decides; file as a
  defect, not a cleanup.
- **I-2 · Count delta:** schema.md's 239 vs Scout's 243-name DDL parse — reconcile
  during the C-03 verification batch.

## 6. Sequencing honesty

**Programme total: ~150 points SKETCH across all candidates — a multi-quarter
Phase-5 (Modernize) programme, not a sprint.** It must never be quoted as one
number without the split below. (Lead)

### Pre-launch (before January) — deliberately almost nothing
Sprint 11/12 load, the GAP erasure programme (#1120–#1129), and D2 leave no honest
capacity for schema risk; every drop is an unrehearsable production-schema event
(§3.6). What *is* pre-launch:

| Item | Points | Why it is safe / necessary now |
|---|---:|---|
| C-01 — fix #894 (fresh-DB halt) | 5 | The **only** schema work recommended pre-launch. Standalone PR and gate; precedes D2. |
| Adopt the §2 conventions (freeze) | 0 | Policy, not code: no new writes to legacy session tables; no new score tables; consent only via `consentService`; new migrations follow R-1/R-2. Stops the model getting worse while the programme waits. |
| C-06 step 1 — resolve the `'owner'`-write / live-CHECK question | (inside C-06) | A **defect** investigation, not simplification: either ownership transfer is broken live or the constraint isn't there. Introspection + the write fix, alone. |
| Liveness audits | done | This assessment *is* the code-level audit for C-03/C-05/C-07/C-10. The live-DB introspection half (§3.2) rides the next staging-QA window — docs only, zero schema change. |

### Post-launch order (each item its own gated programme — Sage + Lead, synthesised)
1. **C-12 phantom-index verification + cleanup** (2) — cheapest, fully reversible.
2. **C-03 never-referenced batch** (~13) — per-table §3 proof, small drop series.
3. **C-02 `ai_prompts`** (5–8) — endpoints retire first; tables after observation.
4. **C-08 search index** (13) — PII strip first (privacy dividend per erasure),
   then shim, then contract. Before C-09 (same dividend logic).
5. **C-09 CV storage-key unification** (~10).
6. **C-07 `omniscore_results` retirement** (~13) — after #791 (practice removal)
   lands; behaviour before schema.
7. **C-12 `activity_log` fold** (~5).
8. **C-06 `users.role` retirement** (34–55) — steps 2–4; never alongside any other
   auth change (Never #6).
9. **C-05 consent consolidation** (13) — Lex-led programme; counsel boundary
   respected; **after the GAP erasure programme (#1120–#1129) closes**, because
   `lib/erasureService.js` names almost every table here and erasure must be
   re-verified once per move, not fought twice.
10. **C-10 session strangler** (55) — last; one legacy table at a time; never
    inside a feature sprint, and specifically never inside the Observer-tiers work
    (S-112/S-113), which writes to the same tables.

**Dependency spine:** C-01 blocks honest validation of everything downstream ·
the §3.2 live-DB evidence blocks every drop · the GAP erasure programme finishing
blocks C-04/C-05/C-08/C-09/C-10 contract steps · #766's ruling blocks C-06 only ·
#791 blocks C-07 · #780's finished skeleton design precedes C-10's backfill design.

### The NEVER list (Sage; adopted whole)
1. Never bundle a contract (DROP / column removal) into the same deploy — let alone
   the same migration — as its expand or migrate step.
2. Never touch either consent family, `biometric_*`, or any audit table as part of
   feature work.
3. Never edit an already-applied migration in place to "clean it up."
4. Never drop on grep evidence alone.
5. Never consolidate session or score tables in the same sprint as erasure-chain
   work — two simultaneous changes to the same DELETE list make failures
   unattributable and erasure untestable.
6. Never retire `users.role` alongside any auth/RBAC change (transfer, MFA,
   signup). Authorisation regressions must have exactly one possible cause.
7. Never backfill consent, biometric, or score-history data with synthesised
   values. Fabricated provenance is worse than an honest gap — it manufactures
   legal evidence.
8. Never merge candidate and company scores, and never "unify" the two consent
   families' vocabularies, as a tidiness refactor. Both splits are ruled
   product/legal semantics, not accidents.
9. Never run a contract migration as part of a staging promotion, hotfix, or
   "while we're deploying anyway." On a shared DB that is an ungated production
   schema change riding on an unrelated approval.
10. Never drop a derived table without handling its triggers, its erasure entry,
    and its defensive-fallback readers — in that order; and never delete the
    source believing it is the copy.

## 7. What is Sumanth's to rule

1. **Adopt the target model (§1) and the §2 conventions** as the standing direction
   and freeze — the freeze is the only part that takes effect immediately.
2. **C-02 `ai_prompts`:** retire the registry (team suggestion: retire — a control
   plane that controls nothing invites an admin to "fix" a prompt and change
   nothing, silently) **or** direct that it be wired into the AI path as a real
   feature.
3. **C-04 `biometric_session_map`:** note the preserved dissent (Rex: drop; Sage:
   dormant-by-design) and the gate in C-04 — no action is needed from Sumanth
   unless he wants the 246 segregation design itself revisited ahead of Gate A's
   re-entry dates.
4. **Confirm 244 as the canonical consent family** (C-05 direction) — build waits
   for the post-launch programme and Lex's canonical-model decision; the
   counsel determination (#788) remains the outer boundary and stays un-chased
   per his no-outreach ruling.
5. **Slot C-01 (#894 fix, 5 pts) pre-launch** as recommended — it is also D2
   insurance, independent of this programme.
6. **Approve the post-launch sequencing (§6) in principle** — stories are filed
   per candidate (by Lead) only for candidates Sumanth rules in; nothing in this
   document is filed yet.

## 8. NOT VERIFIED register (inherited + new)

- Live-DB state throughout: row counts/emptiness for every candidate table;
  whether the migration-070 target tables exist live-only; whether
  `chk_users_role` is live and `users.role='owner'` writes fail against it;
  live column shapes where duplicate CREATEs collide; whether migrations 252–258
  have run anywhere. All assigned to the §3.2 staging-QA introspection checklist.
- Whether any UI outside `client/src` calls the `server.js` `ai_prompts`
  endpoints (C-02's deciding question).
- Whether `omniscore_results` holds live rows from an out-of-band writer (C-07).
- `verification_audit_log` liveness (C-03 batch) · `notification_templates`
  runtime liveness (Scout: NOT VERIFIED, not dead) · the 239-vs-243 census delta
  (I-2) · Trust Score erasure path (noted in the pack; C-11 assumes it stays
  untouched) · per-table liveness inside the 257 observer-capture family beyond
  the write sites found.

---

*Method note: Rex's verdict and target design, Sage's per-candidate paths and
never-list, Scout's reader/writer evidence (which corrected three premises of the
assessment's own brief), and Lead's SKETCH pricing and sequencing were synthesised
by the coordinator; where seats disagreed (C-04, C-05 placement, C-07/C-09 scope),
both positions are recorded and the adopted one is named. Assessment only — no
code, schema, or backlog state was changed by this document.*
