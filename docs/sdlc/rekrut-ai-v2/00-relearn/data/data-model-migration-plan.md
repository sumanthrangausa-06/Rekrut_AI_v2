# Data-Model Migration Plan — RATIFIED 2026-10-14

**Status:** Ratified by panel under Sumanth's expanded-autonomy grant (2026-10-14). This plan governs how the target model in [data-model-simplification-assessment.md](./data-model-simplification-assessment.md) (PR #1135) is reached. The assessment is the design; this document is the execution law. Where they differ, this document wins on method, sequencing, and gating; the assessment wins on the target design itself.

**Panel:** Scout (evidence) · Rex (architecture) · Nova (buildability) · Lex (legal & compliance — advisory positions only; counsel determinations C-01–C-08 / C-NEW-01…10 remain OPEN and UNSENT under the no-outreach rule) · CEO-review seat (product risk) · Lead (synthesis, programme coordination).

**Autonomy rule in force (Sumanth, 2026-10-14):** the team plans, discusses, builds, reviews, and merges gate-cleared work into `dev` autonomously. Sumanth is asked only for MAJOR changes, as codified in §4. Milestone reports replace per-gate asks.

---

## 1. The approach — ratified, with named exceptions

**Universal pattern for live, dual-represented concepts** (consent C-05, `users.role` C-06, sessions C-10, `omniscore_results` reader re-pointing C-07, CV storage keys C-09):

> **Expand → migrate → contract**, characterisation first; the contract step is always a separate, later change with its own gate packet; a contract never shares a PR, a deploy, or a promotion with its expand/migrate steps, and never runs inside a promotion.

Rationale (structural, not habitual): staging and production share one database, migrations run at boot, and the runner never executes `down` — there is no rehearsal environment and no rollback except a read-flag flip, a forward migration, or a rebuild. Bundling contract with expand removes the only rollback mechanisms that exist.

**Characterisation is a different artefact per candidate class** (Nova's amendment A1 — every STOP 1 names its class, its harness, and its real-DB dry-run step by name; a candidate with no real-DB characterisation plan is not gate-clearable for its contract step):

| Class | Characterisation = | Harness |
|---|---|---|
| Dead / no-writer drops (C-03, C-04, C-12 phantom) | §3.1 enumeration artefact (routes + `server.js` inline + workers incl. in-process Observer/dormant capture + crons + DB objects) + live row counts — *not* tests | Staging-QA introspection (#1142) |
| Live consolidations (C-05, C-06, C-07, C-10) | Dual-read / shadow-read comparison: field-level diff on the same subjects, zero *unexplained* divergences, plus row-count/data-shape assertions per flow state | Mocked jest for diff logic; local PG for real queries |
| Derived copy (C-08) | Fixed-corpus parity: identical ID sets for filtered search; plan parity (`EXPLAIN ANALYZE`/p95) alongside result parity | Local PG only |
| API-surface retirements (C-02, C-06 auth decisions, C-10 flows) | API-behaviour tests: status/payload shapes pinned before the change | Mocked jest (shape, not semantics) |

For dormant and low-frequency surfaces, tests cannot characterise what never runs: there, the observation window (≥30 days, ≥2 deploy cycles) plus live-DB introspection **is** the characterisation, and gate evidence must say so rather than presenting a green unit suite as equivalent proof (Rex).

**Amendment A2 (Nova): C-01 (#894) is programme test infrastructure, not just the first item.** Until the fresh-DB path builds to head, no candidate can be characterised on the fresh path at all.

**Named exceptions to the universal pattern** (Rex):
1. **Phantom indexes (C-12)** — verify-and-clean: live introspection first (if the target tables exist live-only, that is a drift investigation, not a cleanup), then one migration with `DROP INDEX IF EXISTS`. Never edit migration 070.
2. **Never-referenced tables (C-03)** — proof-gated contract-only: no dual-write or parity step is possible or meaningful. Single-table drop migrations, never one bulk drop; any table with rows or a found reference ejects from the batch into individual re-grading. **`biometric_session_map` (C-04) is explicitly excluded** — dormant-by-design under the Gate A re-entry contract, not never-referenced; it stays on the gated path.
3. **C-08 step 1 (PII strip)** — minimisation precedes the full sequence (§2). The final table/trigger drop still follows the full sequence, separately, and never before its defensive-fallback readers are handled (assessment Never #10 — `candidateSearch.js` silently returns empty results without the index).
4. **Repairs, not migrations:** the #894 fresh-DB fix (defect repair of the proof path) and C-02 `ai_prompts` (endpoint retirement → observation → drop; its "expand" is a product-surface change).

## 2. Sequencing — ratified as amended

**Pre-launch (the no-regret set — deliberately almost empty):**
- **C-01 / #894 fix** — ratified shape: extend the `migrate.js` bootstrap `candidate_profiles` DDL to full migration-004 parity (all nine 004-only columns; Scout + Nova both corrected the original bio-only scope — 238 needs bio/photo_url/years_experience, 240 adds github_url/phone). 3 pts. The follow-on fresh-path halt in `p2_schema_hardening.sql` is sibling **#1141** (SKETCH 5–8), not part of #894.
- **The FREEZE (§5)** — effective 2026-10-14, 0 pts.
- **C-06 step 1 (defect, #1140)** — stop the `users.role='owner'` write (`routes/company.js:1324`; the value is forbidden by `chk_users_role`, mig 047, and the write is redundant — ownership already rides `companies.owner_id` + the `user_roles` grant/revoke in the same transaction). **The fix closes before cohort onboarding** (CEO-seat hardening, adopted) — it does not roll into the post-launch C-06 programme. The live half (does the CHECK exist live? does transfer 500 today?) routes to introspection issue **#1142**.
- **Phantom-index verification** — pre-launch, as part of the #1142 introspection checklist (docs/evidence only). Its cleanup migration is post-launch item 1 (Rex clarification).
- **C-05 step 0 (decision, #1144)** — Lex-led canonical consent-model decision, paper only, pre-launch; ruled by Sumanth (§4). Build stays post-launch.
- **C-08 step 1 (PII strip, #1143)** — pulled forward to **first in the consolidation order**; may land pre-launch if its STOP 1 prices it genuinely small (Nova sketch ~5) with the fixed-corpus parity harness built first. Steps 2–3 stay post-launch behind a 2-pt EXPLAIN spike.

**Post-launch (direction and order — NOT a funded standing sequence; see §3 governance):**
C-12 phantom cleanup → C-03 never-referenced batch → C-02 `ai_prompts` → C-08 steps 2–3 → C-09 CV keys → C-07 `omniscore_results` (after #791) → `activity_log` fold → C-06 `users.role` → C-05 consent build (Lex-led, after the GAP erasure programme #1120–#1129 closes) → **C-10 session strangler last** (per-table stranglers, never inside a feature sprint, never inside the Observer-tiers work — sessions carry live UPDATE writers on legacy tables, e.g. `screening_sessions` at `routes/interviews.js:3055/3165/3309`, Scout's correction to the assessment).

**Hard erasure gates on contracts** (Lex — no contract step proceeds until its gate clears):
- **C-10, any legacy session table:** GAP-A + GAP-C dispositions for *that table* landed AND keep/erase ruling R-1 (session skeleton) ruled.
- **C-05 contract:** GAP-H landed + the GAP erasure programme closed; GAP-H's redaction rule registered against the 244 family before any backfill.
- **C-03 drops of `skill_gap_analyses` / `tax_documents`:** excluded from the batch by name until GAP-E / GAP-D scope respectively — unless §3.2 zero-row evidence exists. `tax_documents` carries a second bar (possible employer statutory records, keep/erase §4.4/R-6, clock COUNSEL-OPEN).
- **C-07 contract:** GAP-B disposition for the table landed, or §3.2 zero-row evidence.
- **C-04 `biometric_session_map`:** Gate A re-entry resolution + K-8 re-decision + proof no `biometric_templates` rows are orphaned into unattributability.
- **Every contract, universally:** keep/erase table updated for every affected table; `erasureService`'s list matches the post-change schema exactly; per-row legal-hold consults preserved at every new/changed delete site; erasure end-to-end test on a test account including a held-row case; DSAR-export diff wherever the table is DSAR-read.

**Estimate amendments** (Nova; all figures SKETCH until re-priced after live-DB proof — §3 A3): C-03 plan ~13 with contingency to ~21 (per-table proof dominates); C-08 split — step 1 ~5, steps 2–3 re-estimated from the EXPLAIN spike (21+ plausible); C-07's 13 labelled clean-parity only (a parity disagreement is a separate score-correctness bug, separately priced); C-06 plan at **55** (34 is the floor — 43 files / ~188 read sites, parity divergences for multi-company users are expected and each must be explained); C-05 re-sketch after step 0 (Nova expectation 21–34 — the 13 priced a build whose target grain was undecided); C-09 points ratified, schedule risk flagged (storage reconciliation cannot execute from the build VM); C-10's 55 is a programme envelope, never a story figure — file and price per table. **Parity/divergence harness** is shared infrastructure the original estimates assumed: budget it once (Nova sketch 5–8) before the first consolidation that needs it; this codebase's defensive fallbacks (empty-search-on-failure, OR-both RBAC fallback) actively mask divergence, so a naive parity run can report clean while serving wrong data.

## 3. Programme governance (CEO-seat amendments, adopted)

- **A1 — No standing programme, no protected capacity.** The target model and the ordering are ratified as *direction*. Each candidate is re-justified on its own, at its STOP 1, against live demand at that time, with a named customer, compliance, or velocity payoff. "It is next in §6" is not a justification. *(Preserved dissent: the CEO seat dissented from any in-principle approval of the post-launch sequence, on the ground that today's approval becomes tomorrow's claim of authorisation. This section is the panel's answer to that dissent — the sequence is direction, and every candidate re-applies for its existence.)*
- **A2 — Every expand gets an expiry.** No expand step starts without a contract date, an owner, and a recorded kill/rollback decision if the contract slips past that date. An expand with no contract date is how a migration becomes the new permanent architecture.
- **A3 — Re-price after live-DB proof.** All points in the assessment are SKETCH. The ~150-pt programme total is a sketch of sketches and is never quoted as a total. Any candidate whose re-priced estimate grows materially beyond its sketch, or whose expand passes its contract date, escalates automatically as a milestone **exception report** (not an approval ask).

## 4. The autonomy boundary — codified

Sumanth's list (drops/contractions on live structures, promotions, purge flip, money, outreach, product-scope rulings) is the base. The panel found operation type alone mis-draws it — risk does not respect operation type — so the boundary is codified by **risk property**, in four parts. **When in doubt, the item is major.**

**4.1 Sumanth's gate (major changes):**
- **Contract DDL** on any structure meeting ANY of Rex's triggers: ≥1 live reader or writer; holds irreplaceable/non-rebuildable data (consent receipts, biometric material, audit trails, score history, joint candidate×company rows); rollback requires a data restore or forward data migration; live state NOT VERIFIED (unknown rows/objects — unverified defaults to gated); or dormant-by-design (the `biometric_session_map` / Gate A class — dropping it decides a product/legal question, however empty it is).
- **Any contract on a table named in the keep/erase table or the GAP register** — including tables claimed empty (Lex; emptiness is not verifiable from the build environment, so it cannot be the team's own clearance).
- **Any change of any kind — expand, migrate, backfill, or disposition — touching consent, biometric, audit, or the erasure keep/erase table**, including the C-05 step-0 canonical decision (CEO + Lex).
- **Destructive migrate DML**: any backfill or redaction that overwrites/deletes existing rows in place (Nova). Synthesised provenance (Never #7) sits behind this gate plus Lex, permanently.
- **Authoritative cutover flips**: making a new read path the only served path, or stopping a dual-write, is contract-equivalent even when it is "just a config change" (Nova).
- **Activation/enablement** of dormant collection or analysis, and **any change to what data is exposed to a new audience** (CEO).
- **External trust claims, pilot/design-partner commitments, and pricing assumptions** (CEO).
- **The first production run of any erasure widening**, per programme family (Lex — the purge-flip analogue; builds, test-account runs, and merges to `dev` are autonomous).
- **Any change to a keep/erase disposition or a retention clock**, and keep/erase rulings R-1–R-6 (Lex; status-cell updates reflecting landed code are autonomous; the COUNSEL-OPEN clocks are counsel's to settle, not the team's or Sumanth's alone).
- **Any new consent text version or consent-wording change**, above all any creation of an `observer_capture` consent text (Lex; Sumanth's gate, COUNSEL for final wording).
- **Legitimising the `users.role='owner'` value** (extending the CHECK) — as distinct from stopping the write, which is an autonomous defect fix (Lex + Scout).
- Unchanged from Sumanth's list: **promotions** (dev→staging, staging→main — on a shared DB a promotion is a production decision), the **retention-purge flip**, **money**, **outreach**, **product-scope rulings**.

**4.2 Team-autonomous (reported at milestones, never drip-fed as questions):** characterisation and proof-gathering; live-DB introspection (read-only); documentation; the freeze; per-table proof preparation; expand DDL that is additive/backward-compatible with deployed code (fresh-DB build passing on local PG, rollback = code revert); dual-write behind a flag; non-authoritative shadow-read/parity logging; reversible backfills writing only into new structures; C-08 step 1 (minimisation of a derived copy, source intact); C-12 phantom-index cleanup; §2/§5 convention adoption (CEO + Lex + Nova, concurring).

**4.3 The autonomous-contract carve-out (narrow; Rex's line, Lex's exclusions, Nova's tripwire):** a contract step may proceed without Sumanth's gate ONLY if **ALL** hold: zero live readers/writers proven per §3.1 (routes + workers + crons + DB objects); live-DB introspection shows zero rows **or** the content is fully rebuildable from a named canonical source; the canonical home is untouched; rollback is a tested recreate/rebuild; the table is **not** named in the keep/erase table or GAP register, **not** dormant-by-design, **not** auth-bearing (`users.role` stays gated even at zero live reads — its failure mode is silent). Expected members: phantom indexes, C-03 tables that clear proof empty. Every autonomous contract merge carries a **promotion-blocking flag** in the release checklist (execution happens at promotion, which is Sumanth-gated regardless — Never #9 is enforced by process, not memory).

**4.4 Mechanical tripwire (Nova, to be built):** a merge-blocking check on migration files (precedent: `scripts/check-orphans.js`) scanning new migrations for `DROP`, `SET NOT NULL`, `ALTER COLUMN … TYPE`, `RENAME`, and FK-action changes — blocking merge to `dev` unless the PR carries a `contract-approved` marker (Sumanth's approval of that specific migration) or a `contract-autonomous-proof` marker (the §3 proof pack for the §4.3 carve-out). Contract migrations carry a `contract_` infix in their filename so they are visible by eye in any deploy list.

## 5. The FREEZE — standing convention, effective 2026-10-14

The assessment's §2 conventions (R-1–R-8) are **adopted as standing team convention from today**, at 0 points: one CREATE per table; strict `NNN_` migration naming; owner declared at birth; derived data must be rebuildable; **a table is born with its erasure story**; a parallel structure for an existing concept is filed as a defect at review; session-shaped data goes on the spine; no registry without a consumer. The freeze is the highest-value item in the programme (CEO seat): it stops the problem growing while everything else is sequenced. This section is the AGENTS-level record of the convention; it binds STOP 1s and code review from the date above.

## 6. Panel rulings recorded with this plan

- **#813 D-1 — RULED: explicit counted whole-row DELETE** of `ai_screening_audit_logs` + `ai_screening_human_reviews` (before the parent `ai_screenings` delete, after the per-row hold consult; counts only in audit metadata; no skeleton, no hashes), conditional on (1) the survival-proof test — a `compliance_audit_trail` entry must be demonstrated to survive its candidate's erasure, failing which the ruling suspends and the K-9 skeleton is the fallback — and (2) the trail-reliability defect filed as **#1145**. Lex's earlier skeleton position was reversed by Lex on the panel, on the falsified sole-record premise (the {decision, reason} reaches the trail in parallel, `routes/ai-screener.js:639-659`); the full reasoning is recorded on #813 (comment 6167202482). #829 inherits the principle, not the outcome.
- **#813 D-3 — RULED as tightened:** per-row exact-match job-walk for NULL-`application_id` rows; resolved-with-NULL-company proceeds under the entry gate; failed resolution or hold error = fail-closed per-row skip, counted and DSAR-disclosed, never aborting the whole erasure; held-application rows follow the hold; the walk is idempotent. Full text on #813.
- **`users.role='owner'` — the code is wrong, the CHECK is right** (Rex; Scout's evidence: exactly one forbidden writer, `routes/company.js:1324`, and the transfer transaction rolls back in full where the constraint exists). End-state: ownership = `companies.owner_id` + the company-scoped `user_roles` owner row, and nothing else; the scalar column is demoted under C-06 and dropped at its gated contract.
- **Assessment corrections folded in:** #894's scope is nine columns, not one (Scout/Nova); `screening_sessions` carries live UPDATE writers (Scout); `consent_receipts` has *both* anchors unenforced (candidate FK never existed, mig 244; session FK dropped, mig 245 — Lex); `offers` keys to candidate+job, never to the application row (Lex).

## 7. What this plan does not do

It authorises no drop, no contract, and no production run by itself. Every contract still needs its gate packet (§3 evidence + migration + forward-fix rollback story) at whichever gate §4 assigns it. Counsel items remain open and unsent. Live state remains NOT VERIFIED until #1142 is executed at a staging-QA window.
