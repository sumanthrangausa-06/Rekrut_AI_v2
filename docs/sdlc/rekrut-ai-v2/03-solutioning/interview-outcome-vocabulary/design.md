# Design — Issue #1789: Recruiter interview feedback outcome vocabulary

- **Persona:** Rex (Phase 3 — Solutioning / architecture)
- **Type:** Design only. No code changes in this document's PR.
- **Issue:** #1789 (P1) — recruiter interview feedback can never save: the
  client's outcome vocabulary
  (`strong_hire / hire / lean_hire / lean_no_hire / no_hire / completed`)
  vs the database CHECK vocabulary
  (`passed / failed / pending_review / no_decision / NULL`).
- **Gate this satisfies:** Documentation-first (Sumanth, restored
  2026-10-21; HL-006) — Rex designs before any build. Filed by Lead from
  the independent review of PR #1786 (#1783), Finding 3 (HIGH).
- **Skills consulted:** startup-cto (first), smart-sdlc
  `create-architecture` method, ecc/architect + ecc/database-reviewer
  lenses (the latter for the migration option only); ponytail for scope
  minimalism (no migration, no new column, no new endpoint if the chosen
  option holds); verification-before-completion (last, for the landing
  proof in the PR / issue comment).
- **Harness lessons applied:** HL-001 (every load-bearing claim
  re-verified first-hand on live `dev`, §2), HL-003 (the Quinn test in
  §8 is an assembled-app, real-HTTP, fresh-install journey — a
  hand-mounted-router test is not the completion evidence), HL-004
  (provenance: this is Rex's design, written from Lead's filed panel
  findings on #1789 and the verified code state; it is a recommendation
  to Suga's gate, not a panel ruling and not a Sumanth ruling),
  HL-006 (this document IS the deliverable of this lane).
- **Evidence base:** `origin/dev` tip `01ceb35b1a693d8adca4ef0a8fa86efcd02a09a7`
  (tip commit: merge of PR #1786), read live by Rex on 2026-10-23.
  All line numbers below are the numbers at that tip.

---

## 1. Decisions at a glance

| # | Decision |
|---|---|
| D1 | **Recommendation: option (b) — server-side translation at the one route that writes the outcome** (`PUT /api/recruiter/interviews/:id`). The server accepts the client's hire-family vocabulary, translates it to the canonical CHECK vocabulary (§5 table), and stores **only** canonical values. Canonical values (`passed / failed / pending_review / no_decision`) continue to be accepted unchanged (dual-accept on the wire, single vocabulary in the database). |
| D2 | **No migration.** The CHECK is not widened, no column is added, no rows are backfilled. Expand→migrate→contract does not arise (§7). |
| D3 | **OmniScore is not touched.** Because stored values stay canonical, both of its outcome readers keep working exactly as today (§4). |
| D4 | **The `'completed'` default maps to `no_decision` — never to `passed`.** A recruiter who submitted feedback without choosing an outcome has made no hire decision; storing `passed` would fabricate a positive decision that was never made (no-fake-numbers / honesty rule). |
| D5 | **`lean_hire` → `passed`; `lean_no_hire` → `failed`.** A lean is a decision, not an undecided state — the `pending_review` / `no_decision` buckets are explicitly rejected for the leans (§5.1). The lean/strong gradation is **not** preserved in the stored outcome; that loss is stated, priced, and accepted in §6.2, with the one client display consequence handled in D6. |
| D6 | **One small client display fix rides in the build lane** (same file that owns the dialog): when the feedback dialog re-opens on a past interview, the stored canonical value is reverse-mapped to the select's representative value (`passed → hire`, `failed → no_hire`, `pending_review / no_decision / NULL → ''`), and the outcome badge uses the same representative labels. Without this, a saved feedback re-opens with a blank select (the stored `passed` matches no `<option>`). No other client change: the select options and `submitFeedback()`'s request shape do **not** change. |
| D7 | **Finding 6 — resolved as CHOSEN semantics:** a client **cannot** clear an outcome back to `NULL` through this PUT, and that is now a deliberate contract, not an accident (§6.3). `outcome: null` or an omitted `outcome` means "keep the stored value" (the partial-update semantics every other field of this handler already has). The lawful way to retract a decision is to set it explicitly to `no_decision` — a recorded decision state, distinguishable from never-decided `NULL`. |
| D8 | **Finding 7(1) — resolved with one adaptation:** the rider's intent (test with a value the real client actually sends) is adopted and strengthened (§8.3), but under D1/D4 `'completed'` is no longer a *bad* value — it is a lawful legacy alias for `no_decision`, so its test becomes a translation test (200, stored `no_decision`), not a 400 test. The 400 pair becomes `'no_show'` (existing) plus a value in neither vocabulary (e.g. `'maybe'`). |

---

## 2. Verified current state (dev @ `01ceb35b1`, read live by Rex)

### 2.1 The client — the only real client of the PUT

`client/src/pages/recruiter/interviews.tsx`:

- Outcome select (≈L1547–1557): options are exactly
  `''` ("Select outcome..."), `strong_hire`, `hire`, `lean_hire`,
  `lean_no_hire`, `no_hire`. There is no canonical-value option.
- `submitFeedback()` (≈L507–524) sends, via
  `PUT /recruiter/interviews/${showFeedback.id}`:

  ```json
  { "status": "completed",
    "outcome": fbOutcome || 'completed',
    "feedback": { "rating": …, "strengths": …, "weaknesses": …, "notes": … } }
  ```

  So the wire vocabulary is six values: the five select values plus
  `'completed'` whenever the recruiter picks nothing.
- Dialog open resets `fbOutcome` to `''` for upcoming interviews
  (≈L824, the issue's citation) and, for past interviews, to the
  **stored** value: `setFbOutcome(interview.outcome || '')` (≈L1182).
  Today that stored value can only be canonical or `NULL` (see §2.3),
  so re-opening an already-saved interview already shows a blank select
  for a canonical outcome — the display seam D6 closes.
- The outcome badge on the interview card (≈L2134–2136) renders the
  stored value verbatim (`interview.outcome.replace('_', ' ')`).
- The AI-evaluation recommendation at ≈L1651 also uses the string
  `'strong_hire'`, but that is `showAiScores.composite.recommendation`
  (an AI score field), **not** `scheduled_interviews.outcome` — it is
  not a consumer of this column and is out of scope.

### 2.2 The route — the only writer of the column

`routes/recruiter.js`, `PUT /interviews/:id` (≈L2358–2415, "Update
interview outcome"):

- Destructures `{ status, outcome, feedback, meeting_link }`.
- Validation added by PR #1786 (≈L2369–2377): if `outcome != null` and
  `outcome` is not in
  `ALLOWED_OUTCOMES = ['passed', 'failed', 'pending_review', 'no_decision']`,
  it returns an honest **400** naming the allowed values. This
  validation is correct for the canonical vocabulary and must not
  simply be loosened — #1789 exists precisely to decide what replaces
  it.
- The write is one partial update:
  `status = COALESCE($1, status), outcome = COALESCE($2, outcome),
  feedback = COALESCE($3, feedback), meeting_link = COALESCE($4, meeting_link)`
  scoped `WHERE id = $5 AND company_id = $6`. The `COALESCE` on
  `outcome` is Finding 6's mechanism: a `null` parameter keeps the
  stored value, so no request body can store `NULL` (§6.3).
- Consequence chain, verified against the issue: pre-#1786 every real
  UI feedback submission hit PG 23514 → 500, feedback lost; post-#1786
  the same submission gets the honest 400, feedback still lost. The
  client journey is broken either way until this design is built.

The only other writer of `scheduled_interviews.outcome` in the repo is
the candidate decline route, `routes/candidate.js`
`PUT /interviews/:id/decline` (≈L3905–3930, the #1783 fix): it writes
`status = 'cancelled', outcome = NULL` explicitly and puts the
free-text reason in `notes`. It writes no outcome value and is
unaffected by every option in §3.

Repo-wide grep (routes/, services/, lib/, client/src/, tests/,
excluding `node_modules`) found **no other writer** of this column:
all other `scheduled_interviews` updates touch status, scheduling,
calendar or AI-evaluation columns only.

### 2.3 The CHECK

`migrations/p2_schema_hardening.sql:2820`:

```sql
ALTER TABLE scheduled_interviews
  ADD CONSTRAINT chk_scheduled_interviews_outcome
  CHECK (outcome IS NULL OR outcome IN
    ('passed', 'failed', 'pending_review', 'no_decision'));
```

`status` is a *different* vocabulary under its own CHECK
(`scheduled / confirmed / completed / cancelled / no_show /
rescheduled`, ibid. ≈L2809) — the two must not be conflated; the
client's wire value `'completed'` is a **status** word that the client
mistakenly also uses as its no-outcome default. That collision is the
root of the `'completed'` case in §5.

No code in the repo writes `pending_review` or `no_decision` to this
column today: both are lawful-but-unused values. (The many
`pending_review` hits elsewhere are `verification_documents.status`, a
different table and column.)

### 2.4 Every consumer of `scheduled_interviews.outcome`

| Consumer | Reads how | What it does with the value |
|---|---|---|
| `services/omniscore.js` ≈L166 (data load) | `SELECT status, outcome, feedback, … FROM scheduled_interviews WHERE candidate_id = $1` | Feeds the two readers below. |
| `services/omniscore.js` ≈L313–315 — interview feedback component | `completedInterviews = interviews.filter(i => i.outcome === 'completed' \|\| i.outcome === 'passed')`, then extracts `feedback.overall_score \|\| feedback.rating` | Counts an interview's feedback rating toward OmniScore **only** if the outcome is `passed` (the `'completed'` arm can never match a stored row — the CHECK forbids it; it is a dead arm, noted not fixed by this design). |
| `services/omniscore.js` ≈L536–544 — reliability / attendance | `completed = filter(i => i.status === 'completed' \|\| i.outcome === 'passed').length`; no-shows counted from **status** only | `outcome = 'passed'` is one of the two attended signals (the other is `status = 'completed'`, which `submitFeedback()` always sends — so a saved feedback counts as attended even before its outcome is considered). The long comment at ≈L522–541 documents exactly this vocabulary grounding. |
| `routes/recruiter.js` `GET /interviews` (≈L2328) | `SELECT si.* …` | Returns the stored outcome to the recruiter client (badge + dialog re-open, §2.1). |
| `routes/candidate.js` `GET /interviews/scheduled` (≈L3843) | selects `si.outcome` | Candidate's interview list. Display: `client/src/pages/candidate/interviews.tsx` ≈L825 renders `interview.outcome?.replace('_', ' ') \|\| 'Completed'` next to "Result:" when feedback exists. Canonical words ("passed", "no decision") read coherently on this surface today. |
| `routes/interview-sessions.js` unified list (≈L1591) | `SCHEDULED_LIST_COLUMNS` deliberately **excludes** outcome/feedback (S-087 projection; comment ≈L1583) | **Not** a consumer — listed so the build does not go looking for one. |

No analytics, reporting, pipeline, or matching code reads this column
(grep-verified as above). The blast radius of a vocabulary decision is
therefore exactly: the one writer, the two OmniScore readers, and two
display surfaces.

---

## 3. Options

### (a) Client-side mapping only

The client translates before sending (`strong_hire → passed`, etc.);
server validation and storage unchanged.

- *OmniScore/reporting:* none — stored values stay canonical.
- *For:* smallest diff; no server contract change; the #1783 suite's
  canonical-value tests keep passing untouched.
- *Against:* the vocabulary contract then lives in one React page.
  The API still rejects the hire vocabulary from **every other
  caller** — a cached/old client bundle, a future mobile client, any
  API consumer — with the same 400 the recruiter hits today. The
  defect class ("the real client's vocabulary is unlawful at the
  boundary") is fixed only for the one client that happens to be
  patched, and each future client must re-implement the same table
  identically. Server-side, nothing records that the mapping exists.

### (b) Server-side translation at the route — RECOMMENDED

The route accepts both vocabularies, translates the hire family to
canonical via the §5 table before the existing `COALESCE` update, and
stores canonical only. Everything else in §2 is unchanged.

- *OmniScore/reporting:* none — stored values stay canonical, both
  readers (§2.4) work unmodified, including the feedback component's
  `passed` arm, which is precisely the arm a positive hire decision
  must land on.
- *For:* one translation table, in the one place every caller must
  pass through; the deployed client works the moment the server ships
  (no client/server version coupling); canonical API callers (the
  #1783 suite, Quinn's captures, any scripts) keep working because
  canonical values pass through; the mapping is testable over real
  HTTP in the existing real-DB suite pattern; no migration (§7).
- *Against / priced in:* the hire gradation collapses at storage (D5,
  §6.2) — shared with (a); and the stored value a recruiter reads back
  is not the word they picked, which is why D6's display reverse-map
  is part of the build, not an optional extra.
- *Build shape:* the `ALLOWED_OUTCOMES` check in
  `routes/recruiter.js` is replaced by a translation step (§6.1);
  the 400 for genuinely invalid values stays, with the error text
  listing both accepted vocabularies.

### (c) Widen the CHECK to the client vocabulary

Migration adding the five hire values to
`chk_scheduled_interviews_outcome`; client and route validation adopt
the hire vocabulary; storage keeps the recruiter's exact word.

- *For:* zero information loss — `strong_hire` vs `lean_hire` survives
  in the data; dialog re-open and the badge work with no reverse-map
  (D6 unnecessary); the stored word is the word the recruiter chose.
- *OmniScore/reporting consequences — the deciding cost:* both
  OmniScore readers key on `'passed'`. Under (c), a recruiter-saved
  interview would **never** carry `passed` again, so (i) the feedback
  component (L315) would stop counting every new recruiter feedback
  rating, and (ii) the reliability reader's outcome arm (L544) goes
  dead for new rows (attendance would survive only via
  `status = 'completed'`). Fixing that means rewriting both readers to
  a five-value positive set — and deciding, inside a scoring service,
  questions this issue should not smuggle in (does `lean_no_hire`
  count as attended-with-feedback? does `no_hire` feedback still feed
  the rating average?). Worse, the column becomes a **permanent dual
  vocabulary**: existing rows say `passed / failed`, new rows say
  `hire / no_hire` for the same facts, and every future reader,
  report, and export must handle both sets forever — the contract
  step that would remove `passed / failed` requires a data migration
  converting stored rows, and `passed → ` *which* hire gradation is
  unanswerable from the data (lossy in reverse). See §7.
- *Against (process):* it is the only option that changes schema on
  the shared staging/production database for a defect that has a
  no-schema fix, weeks before launch freeze.

---

## 4. Why (b): the recommendation, in one paragraph

The stored column already has a coherent canonical vocabulary that
its only scoring consumer reads; the defect is at the **boundary**,
not in the data model — the one real client speaks a different
language than the API accepts. Boundary mismatches are fixed at the
boundary, once, on the server, so every caller benefits and the data
keeps one vocabulary. Option (a) fixes the boundary only inside one
client; option (c) fixes it by forking the stored vocabulary and
taxing every present and future reader, plus a schema change. Option
(b) is also the only option under which the recruiter journey starts
working for the already-deployed client as soon as the server ships.

**Provenance / dissent note (HL-004):** the strongest argument against
(b) is (c)'s information-preservation argument (§6.2 states it
fairly). If Suga or Sumanth judge the hire gradation to be
report-worthy product data in its own right, (c) is the honest route
and this document's §7 is its migration contract — but that is a
product ruling about future reporting, not a defect fix, and it
should be taken as one, separately, not as the P1 repair.

---

## 5. The exact mapping table (normative for the build)

Applied in `PUT /api/recruiter/interviews/:id`, after parsing the
body, before validation of anything else and before the `UPDATE`.
Canonical values pass through unchanged; `null` / omitted is not a
mapping case (D7, §6.3).

| Client sends | Stored (`scheduled_interviews.outcome`) | Meaning |
|---|---|---|
| `strong_hire` | `passed` | Strongest positive decision. |
| `hire` | `passed` | Positive decision. |
| `lean_hire` | `passed` | Weak positive — still a decision *for* the candidate (§5.1). |
| `lean_no_hire` | `failed` | Weak negative — still a decision *against* (§5.1). |
| `no_hire` | `failed` | Negative decision. |
| `completed` (the client's no-selection default, §2.1) | `no_decision` | Feedback was submitted and the interview is complete (`status` carries that), but **no hire decision was recorded**. Never `passed` (D4). |
| `passed` / `failed` / `pending_review` / `no_decision` | unchanged | Canonical pass-through (existing lawful callers). |
| anything else (incl. `''`, `'no_show'`, `'maybe'`) | — (no write) | Honest **400**, row unchanged, error lists the accepted values. `''` is *not* a silent clear (D7). |

### 5.1 Why the leans are not `pending_review` / `no_decision`

Those two canonical values describe a *workflow state* (a decision
has not been made / is awaiting review), not a *sentiment*. A
recruiter who picks "Lean Hire" has made and recorded a judgement;
filing it as "no decision" would (i) lie on the candidate's and
recruiter's surfaces, (ii) hide a real decision from any future
decision reporting, and (iii) leave OmniScore's readers unable to
distinguish "interview happened, judgement given" from "nothing
recorded". The binary collapse of a five-point scale at the
`passed / failed` line is the semantics the existing CHECK and
OmniScore already encode; this design adopts that line deliberately
rather than inventing a second one.

### 5.2 What is NOT mapped

- `status` is untouched by this design: the client sends
  `status: 'completed'` in the same body and the route's existing
  pass-through keeps working (status has its own CHECK and its own
  validation concerns; the word collision is only in the `outcome`
  field).
- `feedback` (rating / strengths / weaknesses / notes) is stored
  verbatim as today. The rating is the recruiter's own number; this
  design neither derives the outcome from it nor overwrites it.

---

## 6. Build contract (for Nova's STOP 1 — this section is the spec, not code)

### 6.1 Server (`routes/recruiter.js`, PUT /interviews/:id only)

1. Replace the #1786 `ALLOWED_OUTCOMES` rejection with:
   a translation lookup for the six client values (§5), a pass-through
   for the four canonical values, and the same honest 400 (same shape:
   `{ error: "Invalid interview outcome: <value>. Allowed: …" }`)
   listing both vocabularies for anything else.
2. The translated value — never the raw client value — is what the
   existing `COALESCE` update binds. No hire-family string may reach
   the database (the §8 tests read the row back to prove it).
3. Nothing else in the handler changes: auth/permission chain,
   company scoping (`company_id = req.user.company_id`), feedback
   JSON handling, cache invalidation, calendar sync.

### 6.2 Accepted loss, stated plainly

Under (b) — as under (a) — `strong_hire` vs `hire` vs `lean_hire`
cannot be told apart in stored data afterwards; they are all
`passed`. The feedback JSON's free-text strengths/notes remain the
place nuance lives today (the client sends no other structured
gradation — the 1–5 rating is a separate, coarser signal and this
design does not pretend it encodes the lean). If gradation-level
reporting is ever required, that is option (c) taken as a product
decision with §7's contract — it is not retrofittable from data
stored under (b), and Suga's gate should weigh that irreversibility
explicitly.

### 6.3 Finding 6 — clearing an outcome back to NULL (D7)

- **Current mechanics (verified, §2.2):** `outcome: null` or an
  omitted field keeps the stored value (`COALESCE`); `outcome: ''`
  gets a 400 from the #1786 validation. There is no clear-to-NULL
  path.
- **Decision: that is now the chosen contract.** Reasons: (i) the
  outcome is a decision record other surfaces and OmniScore have
  already consumed; silently reverting it to "never decided" rewrites
  history, whereas `no_decision` records the retraction *as* a state
  anyone reading the row can see; (ii) partial-update semantics
  (`null` = untouched) are the same contract the handler already
  gives `status`, `feedback`, and `meeting_link` — a special
  clear-via-null exception for one field is an inconsistency a future
  client will trip over; (iii) no user journey in the issue, the
  PRD set, or the review asks a recruiter to un-decide — ponytail:
  do not build the mechanism no journey needs. A genuine erasure of
  an outcome remains possible through the candidate-erasure machinery,
  which is the lawful path for removing personal decision data, not
  through a recruiter edit.
- **Build obligations from this decision:** the §5 400 case for `''`
  is explicit (an empty string is an invalid value, not a clear
  request); the §8 suite pins the keep-on-null behaviour with a test
  so a future refactor cannot change it silently.

### 6.4 Client (`client/src/pages/recruiter/interviews.tsx`, display only)

1. Dialog re-open (past-interview path, ≈L1182): reverse-map the
   stored value into the select's vocabulary —
   `passed → 'hire'`, `failed → 'no_hire'`,
   `pending_review | no_decision | null → ''`.
   The representative (`hire`, not `strong_hire`) is deliberate: the
   stored data no longer knows the original gradation (§6.2), and
   pre-selecting "Strong Hire" would claim a stronger decision than
   the record supports. The recruiter may pick any of the five values
   before saving; saving re-translates per §5.
2. Badge (≈L2134): render the same representative labels —
   `passed → "Hire"`, `failed → "No Hire"`,
   `no_decision → "No decision"`, `pending_review → "Pending review"`,
   `null →` no badge (as today). The candidate surface (§2.4) keeps
   rendering canonical words and is **not** changed.

---

## 7. Migration implications

- **Under the recommendation (b): none.** No CHECK change, no new
  column, no backfill, no data conversion. Existing stored rows are
  already canonical and remain valid untouched. The
  expand→migrate→contract rule for the shared staging/production
  database is not triggered, and no Founder schema gate is needed for
  this lane.
- **If (c) were ruled in instead (recorded so the cost is on paper):**
  the change is an expand — drop and re-add
  `chk_scheduled_interviews_outcome` with the union of both
  vocabularies (drop-and-re-add of a CHECK is how
  `migrations/275_…` already does expand-only constraint changes in
  this repo) — followed by a *migrate* step that does not exist in
  lossless form (`passed → ?`), so the *contract* step (removing
  `passed / failed`) could not be scheduled honestly; the union would
  in practice be permanent. That open-ended dual vocabulary, not the
  expand itself, is (c)'s true migration cost.
- **Rollback under (b):** code-only revert of the route (and the D6
  display map). No data written under (b) needs conversion on
  rollback, because only canonical values were ever stored.

---

## 8. Quinn journey test (normative — user-perspective gate, HL-003)

Authored by Quinn with the **Recruiter** persona; the Candidate
Experience persona reviews step 7's candidate-visible outcome.

**Rig:** fresh-install dev build — empty database built by
`node migrate.js`, the assembled application over real HTTP, a seeded
company + approved recruiter + candidate + job + scheduled interview
created through the app's own routes/seed paths used by the existing
real-DB suites. Hand-mounted-router runs may be used while developing
the fix (the #1783 suite's pattern) but are **not** the completion
evidence.

**Red baseline (record first):** on current `dev`, step 2 with the
client's real body returns **400** (post-#1786 behaviour) and the
feedback is absent on read-back. That failure, recorded on #1789, is
the reproduction of the user's exact complaint.

**The journey — a recruiter gives feedback the way the client actually
does it:**

1. Recruiter loads their interview list
   (`GET /api/recruiter/interviews`) and sees the scheduled interview.
2. Recruiter submits feedback with the body **exactly as
   `submitFeedback()` builds it** (§2.1) — first run with
   `outcome: 'strong_hire'` and a full feedback object →
   expect **200**, dialog-equivalent success.
3. Read back the row (API + DB): `status = 'completed'`,
   `outcome = 'passed'` (canonical — **not** `'strong_hire'`),
   feedback rating/strengths/weaknesses/notes preserved verbatim.
4. Repeat the submit for each remaining client value, asserting the
   §5 table from stored state (not from the response alone):
   `hire → passed`, `lean_hire → passed`, `lean_no_hire → failed`,
   `no_hire → failed`.
5. **No-selection run:** submit with `fbOutcome` empty — i.e. the
   client sends `'completed'` — expect 200 and stored
   `outcome = 'no_decision'`, explicitly **not** `passed`.
6. **Re-open coherence:** `GET` the interview and apply the D6
   reverse-map — a `passed` row presents the select as `hire`, a
   `failed` row as `no_hire`, a `no_decision` row as unselected; the
   badge label matches §6.4. (This step's display assertion is the
   one place a component-level check is acceptable — the state it
   renders has already been proven over HTTP in steps 2–5.)
7. **Candidate-visible consequence:** the candidate's scheduled-
   interviews read returns the saved outcome and the candidate page's
   "Result:" line renders the canonical word — no error, no blank.
8. **Scoring consequence spot-check:** with a `passed` outcome saved,
   the candidate's OmniScore interview data counts the interview
   (attended via `status = 'completed'` / `outcome = 'passed'`, and
   its feedback rating is eligible for the L315 component) — asserted
   through the same service entry points the existing OmniScore
   real-DB suites use, not by re-implementing the formula in the test.

**Negative / contract cases (same suite):**

- `outcome: 'no_show'` → 400, row unchanged (the #1783 suite's
  existing bad-value case, kept).
- `outcome: 'maybe'` (neither vocabulary) → 400, row unchanged.
- `outcome: ''` → 400, row unchanged (D7: not a clear).
- `outcome: null` and omitted-`outcome` submits → 200, stored outcome
  unchanged (D7 keep-semantics, pinned per §6.3).
- Change-of-mind: a row at `passed` re-submitted with `no_hire`
  ends at `failed` (decisions are changeable; they are just not
  silently erasable).

### 8.3 Finding 7(1) — disposition

The #1783 real-DB suite
(`server/__tests__/candidate-decline-outcome-realdb-1783.test.js`)
tests the sibling recruiter PUT with only `'no_show'` as the bad
value. The rider asked for `'completed'` to be added as a second bad
value because the real client sends it. Under this design that
premise changes (D8): `'completed'` becomes lawful (→ `no_decision`),
so the build lane instead (i) adds the §8 step-5 case — the real
client's default value exercised end-to-end, which is the rider's
intent in stronger form — and (ii) adds `'maybe'` as the second
genuinely-bad value alongside `'no_show'`. The #1783 suite's existing
cases (decline → NULL + notes; `'no_show'` → 400; `'passed'` → 200)
must all stay green unmodified except for these additions.

---

## 9. Build gates that follow from this design

1. **STOP 1 (Nova)** must cite this document, state the specialist
   decision, and note: the risk domain is the **API contract** (one
   route's accepted vocabulary), not the schema — under (b) the
   database-reviewer specialist is *considered and skipped* (no
   migration, no query change) and becomes mandatory only if Suga
   re-opens (c). An API-contract review of the §5 table at code
   review is the specialist check that matches the risk.
2. Red-first: the §8 red baseline is recorded on #1789 before the
   fix is written.
3. Independent review of the build PR, then the full §8 journey on
   the fresh-install rig before closure; evidence (requests, statuses,
   read-back rows) attached to #1789.
4. Docs in the same build PR: a build-log entry under
   `docs/sdlc/rekrut-ai-v2/04-implementation/` following the #1783
   lane's pattern, linking this design.
5. Points: the issue's 3 points stand under (b) — one route change,
   one display map, one extended suite. (Under (c) the estimate
   would not stand: migration + two OmniScore readers + reporting
   audit is a different, larger story and would return to Lead for
   re-pointing.)

---

## 10. What this design does not do

- It does not loosen the #1786 validation into "accept anything":
  values in neither vocabulary still get the honest 400, and no
  hire-family string can reach the database.
- It does not cite PR #1786 as having fixed recruiter feedback — it
  fixed candidate decline (#1783) and made this failure honest; this
  lane is what makes the feedback journey actually work.
- It does not change the candidate decline route, the unified
  interview-sessions projection, OmniScore, or the CHECK.
- It does not decide gradation-level outcome reporting as a product
  feature — that is option (c), reserved for a separate ruling (§4).
