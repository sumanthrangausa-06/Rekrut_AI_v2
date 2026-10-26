# Design — Issue #1788: Candidate reschedule writes a status the CHECK forbids

- **Persona:** Rex (Phase 3 — Solutioning / architecture)
- **Type:** Design only. No code or migration changes in this document's
  PR. The one exception is the #1783 build-log citation correction in
  §10, which Lead's checkpoint explicitly assigned to this lane; it is a
  documentation correction, not code.
- **Issue:** #1788 (P1, CONFIRMED) — the candidate reschedule route
  writes `status = 'reschedule_requested'` into `scheduled_interviews`,
  a value absent from both definitions of
  `chk_scheduled_interviews_status`. Every reschedule attempt on a
  migrated DB raises PG 23514 → HTTP 500 and the request silently never
  happens — the #1783 defect class, sibling route.
- **Gate this satisfies:** Documentation-first (Sumanth, restored
  2026-10-21; HL-006) — Rex designs before any build. Filed by Lead from
  PR #1786's build log, confirmed by the PR #1786 independent review
  (Finding 4), Scout's verify-first comment on #1788 (comment
  6377761581, verdict CONFIRMED), and Lead's checkpoint directing this
  design (comment 6378154423).
- **Skills consulted:** startup-cto (first), smart-sdlc
  `create-architecture` method, ecc/database-reviewer lens applied
  PROACTIVELY (the core question is a CHECK-vocabulary / migration
  question, §3, §7), codebase-memory attempted for writer tracing (its
  index was unavailable in this worktree — `project not found or not
  indexed` — so every writer/reader claim below rests on the repo-wide
  `grep` sweep quoted in §2, not on the graph), ponytail for scope
  minimalism, verification-before-completion (last, for the landing
  proof quoted in the PR).
- **Harness lessons applied:** HL-001 (every load-bearing claim
  re-verified first-hand on live `dev`, §2), HL-003 (the Quinn test in
  §8 is an assembled-app, real-HTTP, fresh-install journey — the
  hand-mounted-router suite is the pattern for the build's test file,
  not the completion evidence), HL-004 (provenance: this is Rex's
  design, written from Scout's confirmed evidence and the verified code
  state; it is a recommendation to Suga's gate, not a panel ruling and
  not a Sumanth ruling), HL-006 (this document IS the deliverable of
  this lane), HL-007 (PR number and commit SHA are quoted in the report
  only as returned by the tools that created them).
- **Evidence base:** `origin/dev` tip
  `ab572c41f22de4f04d8a7890cd80d92f3e6a4d84` (tip commit: merge of
  PR #1792, the #1789 build), verified by `git ls-remote` and a local
  fetch before any reading. All line numbers below are the numbers at
  that tip.

---

## 1. Decisions at a glance

| # | Decision |
|---|---|
| D1 | **Recommendation: option (b) — an expand-only migration widening the CHECK to the canonical union vocabulary (D2).** The writer (`routes/candidate.js` reschedule) and every reader (§2.4) already agree on `reschedule_requested`; the schema is the only side of the contract that is wrong. This is the opposite asymmetry from #1789 and it flips the answer (§4). Precedents: migration 275 (#1610) and migration 292 (#1739), same defect class, same resolution. |
| D2 | **Canonical `scheduled_interviews.status` vocabulary, settled (not just patched):** `scheduled, confirmed, in_progress, completed, cancelled, no_show, rescheduled, reschedule_requested` — the union of the 047 list, the p2 list, and the one value the writer and clients use. No value is removed from either historical definition (§5). |
| D3 | **Migration shape (normative, §7):** the next numbered migration (293 at this tip) drops every status-vocabulary CHECK on `scheduled_interviews` **by definition** (268/271/275 pattern) and re-adds exactly one, under the exact historical name `chk_scheduled_interviews_status` — the name both hardening files guard on, and therefore the only name that stops `p2_schema_hardening.sql` re-adding its narrower list on a fresh install. No exception-swallowing. The historical files 047 and p2 are **not** edited in place (§7.3). |
| D4 | **Reschedule state lives in `status` itself — nowhere else.** No notes-marker reader, no new column (§3). `notes` keeps doing what it already does in this route: carrying the candidate's free-text reason and preferred time, visible verbatim on both interview surfaces. |
| D5 | **Server-side validation for the one client-controlled writer of this column:** `routes/recruiter.js` `PUT /interviews/:id` gains an `ALLOWED_STATUSES` check over the D2 vocabulary, mirroring the outcome block the #1789 build placed in the same handler — out-of-vocabulary → honest **400**, row unchanged; `null`/omitted keeps the stored value; `''` is a 400, not a clear. Every other writer of the column uses a server-side literal or the DB default and needs no validation (§6) — the build must prove that inventory, not assume it. |
| D6 | **No client changes.** The badges, upcoming filters, recruiter Confirm button, and dashboard needs-action filter that key on `reschedule_requested` (§2.4) are already built and already correct under D1. A build that "fixes" a client to a different value has misunderstood this design. |
| D7 | **Transitions out of `reschedule_requested` already exist and are pinned by test (§8), not redesigned:** recruiter Confirm → `confirmed`; recruiter reschedule-to-a-new-time → `scheduled` at the new time; feedback submit → `completed`; cancel paths → `cancelled`. The candidate has no self-transition out (their card's actions gate on `status = 'scheduled'`) — that awaiting-recruiter semantics is stated, not changed (§5.2). |
| D8 | **Citation nit (Lead checkpoint / review Finding 9): corrected in this PR** — the #1783 build log cites migration 047 as a source of the *outcome* CHECK; 047 contains no outcome constraint at all. §10 records the exact correction. |

---

## 2. Verified current state (dev @ `ab572c41f`, read live by Rex)

### 2.1 The writer

`routes/candidate.js`, `PUT /interviews/:id/reschedule` (≈L3945–3976,
"Request reschedule"):

```sql
UPDATE scheduled_interviews
   SET status = 'reschedule_requested',
       notes = COALESCE(notes, '') || E'\n[Reschedule request] '
            || COALESCE($3, 'Candidate requested reschedule')
            || COALESCE(' - Preferred: ' || $4, ''),
       updated_at = NOW()
 WHERE id = $1 AND candidate_id = $2 AND status IN ('scheduled', 'confirmed')
 RETURNING *
```

- The body is `{ reason, preferred_time }`; both already land in
  `notes` — the #1783 pattern is *already followed* by this route for
  the free-text parts. Only the status value is unlawful.
- The guard admits exactly the two live source states, `scheduled` and
  `confirmed`. On CHECK failure the catch returns HTTP 500
  `Failed to request reschedule` and the row is unchanged — Scout
  confirmed this chain, and the PR #1786 reviewer executed the value
  against PG16: **23514 under both candidate vocabularies**.

### 2.2 The constraint — two definitions, and which one a fresh DB gets

| Source | Vocabulary |
|---|---|
| `migrations/047_p2_schema_hardening.js:632-634` | `scheduled, confirmed, in_progress, completed, cancelled, no_show` |
| `migrations/p2_schema_hardening.sql:2809` | `scheduled, confirmed, completed, cancelled, no_show, rescheduled` |

- `migrate.js` runs files in `allFiles.sort()` order (≈L293): numbered
  `.js` migrations sort before `p2_schema_hardening.sql`, so 047's
  `addConstraint` lands the constraint first (under the name
  `chk_scheduled_interviews_status`), and p2's block — guarded by
  `IF NOT EXISTS (constraint_name = 'chk_scheduled_interviews_status')`
  — is skipped. **The fresh-DB vocabulary is 047's list.** (047's
  helper also *swallows* ADD failures with a log line, so the live
  state of the shared staging/production DB cannot be known from code
  alone — §7's shape is state-agnostic for exactly this reason.)
- The two definitions disagree with each other: `in_progress` exists
  only in 047's list, `rescheduled` only in p2's. Neither contains
  `reschedule_requested`, and no later migration touches this
  constraint (repo-wide grep of `migrations/` verified; the highest
  numbered migration at this tip is 292).
- Asymmetry worth stating, because §10 turns on it: the *outcome*
  CHECK has the opposite provenance — it exists **only** in
  `p2_schema_hardening.sql:2820`. 047 adds no outcome constraint (its
  only `scheduled_interviews` outcome mention is a varchar→TEXT
  conversion list), so on a fresh DB the outcome vocabulary is p2's
  while the status vocabulary is 047's.

### 2.3 Class sweep — every writer of `scheduled_interviews.status`

Repo-wide grep over `routes/`, `services/`, `lib/`, `server/`
(excluding tests), at this tip:

| # | Writer | Status written | Client-controlled? |
|---|---|---|---|
| W1 | `routes/candidate.js` accept (≈L3880) | literal `'confirmed'` (guard: from `'scheduled'`) | No |
| W2 | `routes/candidate.js` decline (≈L3917, the #1783 fix) | literal `'cancelled'`, `outcome = NULL`, reason → `notes` | No |
| W3 | `routes/candidate.js` reschedule (≈L3950) | literal `'reschedule_requested'` + reason/preferred → `notes` | No — **the defect** |
| W4 | `routes/interviews.js` schedule INSERT (≈L2407) | column omitted → DB default `'scheduled'` (migration 002) | No |
| W5 | `routes/interviews.js` `PUT /reschedule` (≈L2542 / ≈L2570) | literal `'scheduled'` (new time given) / literal `'cancelled'` (no new time) | No |
| W6 | `routes/recruiter.js` schedule INSERTs (≈L1506, ≈L2259) | column omitted → DB default `'scheduled'` | No |
| W7 | `routes/recruiter.js` `PUT /interviews/:id` (≈L2404) | **`status = COALESCE($1, status)` bound directly from `req.body`** | **Yes — unvalidated (the rider)** |
| — | `routes/calendar.js`, `server/services/calendar-service.js`, `routes/interviews.js` AI-evaluation update | calendar / evaluation columns only | Not status writers |

W7 in detail: the same handler now carries the #1789 outcome
translation + honest-400 block (≈L2370–2400), but `status` still
passes through untouched. The real client sends only lawful values
through it today — `updateStatus()`'s Confirm sends `'confirmed'`
(`client/src/pages/recruiter/interviews.tsx:557`, called at :844) and
`submitFeedback()` sends `'completed'` — and the OmniScore comment at
`services/omniscore.js:550-563` records a real caller writing
`status = 'no_show'` through this PUT. So the passthrough is a live,
used contract with no validation: any other value from any caller is
the same silent 23514 → 500. That is why D5 validates against the
**full canonical vocabulary**, not against the two values the current
client happens to send.

Not this constraint (listed so the build does not conflate them):
`routes/interview-events.js` writes `confirmed / rescheduled /
cancelled` to **`interview_events`**, whose own CHECK
(`migrations/126_interview_events_proposed_slots.js:47`) lawfully
includes `rescheduled`; `interview_sessions` and
`mock_interview_sessions` have their own vocabularies and writers.

### 2.4 Every reader that depends on `reschedule_requested` existing

This is the evidence the decision turns on. The value is not a stray
string in one route — it is already the display and workflow
vocabulary of three surfaces:

| Reader | How it uses the value |
|---|---|
| Candidate interviews page (`client/src/pages/candidate/interviews.tsx`) | Status badge map :107 — `reschedule_requested: { label: 'Reschedule Requested', variant: 'warning' }`; upcoming filter :371 includes it alongside `scheduled`/`confirmed` (so the interview stays in Upcoming, at its original time, while the request is pending). `notes` is rendered verbatim on the card (≈L816), so the reason/preferred time are candidate-visible. |
| Recruiter interviews page (`client/src/pages/recruiter/interviews.tsx`) | Badge map :155 (`'Reschedule Req.'`); upcoming filter :572 includes it; **`interview.status === 'reschedule_requested'` gates the Confirm button (:2177)** — the recruiter's action on the request; `notes` rendered verbatim (≈L2131), so the recruiter sees the reason and preferred time. |
| Recruiter dashboard (`client/src/pages/recruiter/dashboard.tsx`) | Needs-action filter :746 matches `u.status === 'reschedule_requested'` on unified-list rows; label `'Reschedule requested'` (:1443) and warning badge (:1472). |
| Unified reads (two passthrough pipes) | The dashboard row above arrives via `GET /interviews/my-interviews` → `services/interview-service.js` `getMyInterviews()`: its System A query selects `status` (≈L78) and its normaliser passes `status: row.status` through (≈L58). Separately, `routes/interview-sessions.js`'s unified list also passes the value through (`toScheduledListRow()`; `SCHEDULED_LIST_COLUMNS` includes `status`). Neither needs a change under D1. |
| OmniScore (`services/omniscore.js`) | Attended := `status = 'completed' OR outcome = 'passed'` (≈L335, ≈L571); no-shows := `status IN ('no_show','cancelled')`. A `reschedule_requested` row is correctly **neither** — the interview has not happened and the candidate has not no-showed it. No change under any option; recorded so the build does not go looking. |
| Candidate list endpoint (`routes/candidate.js` `GET /interviews/scheduled`) | Returns `status` and `notes` verbatim — both surfaces above are fed by reads like this. Its `upcoming_only` branch filters `status = 'scheduled'` exactly (a pre-existing narrowness that also excludes `confirmed` rows); observed, out of scope for this lane. |

No analytics, reporting, pipeline, or matching code keys on this
value beyond the above (grep-verified as in §2.3).

---

## 3. Options

### (a) Writer writes an existing lawful status + the state in `notes` (the #1783 pattern)

E.g. the reschedule route keeps `status` at its current value (or
rewrites the same `scheduled`/`confirmed` value) and the
`[Reschedule request]` notes line becomes the only record that a
request is pending; readers derive "reschedule requested" by parsing
`notes`.

- *For:* no migration, no schema gate, smallest server diff; the
  #1783 precedent is real — decline's reason genuinely had no lawful
  home and no reader depended on a decline *status* existing.
- *Against — and why the #1783 analogy fails here:* decline's fix
  worked because `cancelled` **is** the truthful terminal status for a
  declined interview — nothing was lost by storing it. A reschedule
  request is not terminal and is not `scheduled` in the same sense as
  an untouched booking: it is a pending action *for the recruiter*.
  Under (a) that state exists only inside a free-text append log, so:
  (i) all three readers in §2.4 must be rewritten to parse a notes
  marker — and one of the pipes, the `interview-sessions` unified
  list, deliberately does **not** carry `notes` at all in its
  projection (S-087), so (a) also forces a projection change there;
  (ii) `notes` accumulates
  (`[Declined]`, `[Reschedule request]`, …) and is rendered verbatim
  to users, so marker-parsing is fragile against user-typed text and
  against repeat requests; (iii) every future query, filter, or count
  over this state inherits the same parsing; and (iv) clearing the
  state becomes "append another note and hope every parser agrees
  the later note wins". The Confirm button and needs-action filter —
  the recruiter's actual workflow — would be rebuilt on top of that
  parsing in four places to save one expand-only migration of a
  shape this repo has run three times (274, 275, 292).

### (b) Expand-only migration widening the CHECK to the union — RECOMMENDED

One numbered migration (§7) replaces the status CHECK with the D2
union vocabulary. Writer, clients, and readers are unchanged — they
were already written for this value.

- *For:* the stored state stays a first-class, queryable lifecycle
  state, which is what it is; every existing reader (§2.4) starts
  working with **zero** client changes the moment the migration and
  the D5 validation land; the two disagreeing historical definitions
  are converged to one canonical constraint instead of a third
  divergence being patched over; the shape is proven in this repo for
  exactly this defect class — migration 275 (#1610: writer + readers
  agreed on `pending_review`, schema alone forbade it; its header's
  verdict: *"the schema is the only side of the contract that is
  wrong"*) and migration 292 (#1739: widen to the *union* of two real
  taxonomies; *"the schema was the defect, not the writers"*).
- *Against / priced in:* it is a schema change on the shared
  staging/production database weeks before launch freeze — mitigated
  by being expand-only (no value removed, no row rewritten, no data
  conversion; §7.2) and by the dual-environment promotion rule that
  already governs trains. It also legitimises `rescheduled` for this
  table, a value no `scheduled_interviews` writer uses today (it is
  `interview_events`' word, and both client badge maps already carry
  it for System A cards); §5 explains why the union, not a narrower
  list, is the no-regret settlement.

### (c) Hybrid — lawful status + a dedicated reschedule column

Keep `status` lawful (`scheduled`/`confirmed`) and add, via an expand
migration, a nullable column (e.g. `reschedule_requested_at
timestamptz` or a boolean) that carries the pending state; readers
check the column.

- *For:* the state is structured and queryable (unlike (a)'s notes
  parsing), and the status vocabulary stays at six values.
- *Against:* it has (b)'s migration cost **plus** a second source of
  truth for one fact. Every transition writer in §2.3 (W1, W2, W5,
  W7's `completed`/`confirmed`/`cancelled` writes, W3 itself) must
  remember to clear the column, and a single missed writer leaves a
  stale "reschedule requested" banner on a completed or cancelled
  interview — a new silent-wrong-state class traded for the current
  loud-failure one. All three client surfaces must be rewired to a
  two-field check, and every column-enumerating read of this table
  (`services/interview-service.js` ≈L78/L126,
  `routes/interview-sessions.js`'s `SCHEDULED_LIST_COLUMNS`) must be
  extended to carry the new column. More moving parts than (b) for a distinction
  (status vs flag) no consumer needs: every consumer asks one
  question — "is this interview awaiting a reschedule action?" —
  which is a lifecycle-state question, and lifecycle state is what
  `status` is for.

---

## 4. Why (b): the recommendation, in one paragraph

In #1789 the stored vocabulary was canonical, a scoring consumer
keyed on it, and only the wire vocabulary was foreign — so translation
at the boundary was right and the CHECK was left alone. Here every
part of that asymmetry points the other way: the writer, both
interview pages (badge, filter, and the recruiter's Confirm action),
and the recruiter dashboard already speak `reschedule_requested`; no
scoring or reporting consumer keys on the status vocabulary beyond
`completed`; and the value names a real, non-terminal lifecycle state
that has no truthful representation in the existing six values. When
the writers and readers agree and the schema alone forbids the value
they agree on, this repo's own settled precedent (274, 275, 292) is
that the schema is the defect — widen it, expand-only, to the union,
and converge the two historical definitions that disagreed with each
other in the process. Option (a) saves that one migration by moving
a workflow state into a free-text log four readers must parse;
option (c) pays the migration anyway and adds a dual-source-of-truth
clearing obligation to every transition writer.

**Provenance / dissent note (HL-004):** the strongest argument
against (b) is timing — a schema change on the shared DB this close
to the Nov 30 freeze. It is priced in §3(b) and §7.2 rather than
hidden: the change is expand-only and state-agnostic, and the
alternative is not "no risk" but the §3(a) parsing risk spread across
four readers. If Suga judges even an expand-only CHECK change to
need Sumanth's word under the schema gate, that is a one-line ruling
on this document — flagged here, not blocked on (§11).

---

## 5. The canonical vocabulary (normative)

### 5.1 The settled list

```sql
CHECK (status IN ('scheduled', 'confirmed', 'in_progress', 'completed',
                  'cancelled', 'no_show', 'rescheduled',
                  'reschedule_requested'))
```

| Value | Provenance | Writer today |
|---|---|---|
| `scheduled` | 047 + p2 | DB default; W5 |
| `confirmed` | 047 + p2 | W1; W7 (client Confirm) |
| `in_progress` | 047 only | none for this table (its live uses are other tables' vocabularies) — retained: removing it would be a contraction |
| `completed` | 047 + p2 | W7 (client feedback submit) |
| `cancelled` | 047 + p2 | W2, W5, W7 |
| `no_show` | 047 + p2 | W7 (recorded real-caller write, §2.3) |
| `rescheduled` | p2 only | none for this table (`interview_events` only) — retained for the same contraction reason, and because both client badge maps already define it for System A cards |
| `reschedule_requested` | **new — this design** | W3 |

The union is the settlement the PR #1786 reviewer asked for
("settle the canonical status vocabulary, not just patch one
value"): after §7's migration, exactly one constraint exists, its
definition is a superset of both historical definitions, and no
database state reachable under either historical definition can
violate it. A narrower new list (047 + `reschedule_requested` only)
would silently *contract* the vocabulary on any DB where p2's
definition is the live one — and §2.2 explains why live state cannot
be assumed from code.

### 5.2 Lifecycle semantics of `reschedule_requested`

- **Meaning:** the candidate has asked to move this interview; the
  original `scheduled_at` still stands; no new time has been agreed;
  the next action belongs to the recruiter.
- **Entered from:** `scheduled`, `confirmed` (W3's existing guard —
  unchanged).
- **Exited by (existing paths, D7):** recruiter Confirm via W7 →
  `confirmed` (the recruiter accepts/dismisses the request at the
  original time — the semantics the client button already encodes;
  this design does not redefine it); recruiter reschedule via W5
  with a new time → `scheduled` at that time; W7 feedback submit →
  `completed`; W5-without-time / recruiter cancel paths →
  `cancelled`.
- **Not exited by the candidate:** the candidate card's
  Accept/Decline/Reschedule actions gate on `status = 'scheduled'`
  (client :769), and W2's server guard admits only
  `scheduled`/`confirmed`. While a request is pending the candidate
  waits — coherent with the state meaning, recorded explicitly so
  the build does not "fix" it and Quinn does not test for it.
- **Scoring:** the state contributes nothing to OmniScore (§2.4) —
  the interview has neither been attended nor missed.

---

## 6. Build contract — validation (for Nova's STOP 1; this is the spec, not code)

### 6.1 `routes/recruiter.js` `PUT /interviews/:id` — the only change to a writer

1. Immediately beside the existing outcome block in the same handler,
   add a status allowlist over the §5.1 vocabulary
   (`ALLOWED_STATUSES`, mirroring the handler's `CANONICAL_OUTCOMES`
   naming/shape from the #1789 build):
   - `status == null` (null or omitted) → keep the stored value (the
     existing `COALESCE` semantics; no clear-to-anything via null,
     the #1789 D7 analogue);
   - `status` in the vocabulary → pass through unchanged;
   - anything else, **including `''`** → honest **400** in the same
     shape as the outcome error
     (`{ error: "Invalid interview status: <value>. Allowed: …" }`),
     no write, row unchanged.
2. The validated value — never the raw body value — is what the
   existing `COALESCE` update binds.
3. Nothing else in the handler changes: auth/permission chain,
   company scoping, the outcome translation, feedback handling,
   cache invalidation, calendar sync (including its existing
   `status === 'cancelled'` branch).

### 6.2 Every other writer — no change, with the inventory as the proof

W1–W6 (§2.3) write server-side literals or omit the column; they
cannot receive a client status value, so they need no validation —
the build's STOP 1 must re-run the §2.3 grep and state that the
inventory is unchanged, rather than citing this document as proof.
If the build finds any new or missed client-controlled writer, it
gets the same §6.1 treatment in this lane, not a follow-up.

### 6.3 What validation must not do

- It must not become a translation layer. Unlike outcome (#1789),
  there is no second status vocabulary spoken by any real client —
  the clients speak the canonical values themselves. Values outside
  §5.1 are errors, not aliases.
- It must not restrict W7 to the values the current client sends:
  `no_show` is a recorded real-caller write through this route
  (§2.3), and a lawful-vocabulary 400 would recreate this defect
  class under a new value.

---

## 7. Migration spec (normative for the build; Rex designs, Nova writes it)

### 7.1 Shape — migration `293_<name>` (next number at this tip)

Following migrations 268/271/275 (by-definition re-add) and 274/292
(widen-to-union for this defect class):

1. **Drop by definition, never by assumed name or assumed presence:**
   find every CHECK constraint on `scheduled_interviews` whose
   `pg_get_constraintdef` carries the status vocabulary — the marker
   pair `%status%` + `%no_show%` matches both historical definitions
   and does **not** match the outcome CHECK (which contains neither
   marker) — and drop each by its real name. The outcome constraint
   must survive untouched; the §8 tests prove it.
2. **Re-add exactly one** constraint with the §5.1 union definition,
   under the exact name **`chk_scheduled_interviews_status`**.
   The name is load-bearing, not cosmetic (275's lesson): numbered
   migrations sort **before** `p2_schema_hardening.sql` in
   `migrate.js`, and p2's status block re-adds its narrow list
   whenever that name is absent. Any other name produces a fresh DB
   carrying *two* status CHECKs — the narrow one still forbidding
   `reschedule_requested` — and the defect survives the "fix".
3. **No exception handler anywhere in the migration** — no
   `EXCEPTION` block, no try/catch (275's loudness rule). A failure
   must propagate through `migrate.js`'s per-file transaction:
   rollback, exit 1, `_migrations` row not written, retried next run.
   The swallowing helper in 047 is part of how this class stayed
   hidden; it is not repeated.
4. **Idempotent / state-agnostic:** fresh DB (047's constraint only),
   shared DB (either historical definition live, or both somehow
   present), and re-run (the sweep finds the widened constraint
   itself — its definition carries the same markers — and re-adds an
   identical one) all converge to exactly one canonical constraint.

### 7.2 Expand→migrate→contract accounting

- **Expand:** this migration — the union is a strict superset of
  both historical vocabularies. No value removed, no column touched,
  no row read or rewritten.
- **Migrate (data):** none exists and none is needed — no stored row
  can hold `reschedule_requested` today (the CHECK saw to that), and
  every other stored value remains lawful under the union.
- **Contract:** none is scheduled, and none is needed — the union
  *is* the canonical vocabulary (D2), not a transitional superset.
  This is the §3(b) cost stated honestly: the vocabulary is settled
  at eight values, permanently, unless a future design rules
  otherwise as its own story.
- **Rollback:** migrations never un-apply on the shared DB. Reversal,
  if ever ruled, is a forward migration — and once a candidate has
  successfully requested a reschedule, it would first have to decide
  where those rows go, which is why reversal is a design question,
  not a `down()`. (If Nova writes a `down()` in the 274 style, it
  must carry 274's honesty note: it fails, correctly, while any
  `reschedule_requested` row exists.) A failed 293 needs no rollback:
  its transaction already rolled back.

### 7.3 What the migration lane must not do

- **Do not edit `047_p2_schema_hardening.js` or
  `p2_schema_hardening.sql` in place.** They are applied history
  recorded in `_migrations`; editing them changes nothing on any
  existing DB, and on a fresh DB §7.1's numbered migration plus p2's
  own name-guard already produce the canonical result. Rewriting
  history files to make the record look tidy is how drift becomes
  invisible. (Scout's one-line summary suggested "adding the value to
  BOTH constraint definitions" — read as an outcome, one canonical
  constraint carrying the union, this design agrees; read as editing
  the two historical files, it is rejected for the reason above.)
- Do not widen or otherwise touch the **outcome** CHECK in this lane.
- Do not add the notes-marker or new-column machinery of §3(a)/(c).

---

## 8. Quinn journey test (normative — user-perspective gate, HL-003)

Authored by Quinn with the **Candidate Experience** persona
(steps 1–3, the candidate's request and what they see) and the
**Recruiter** persona (steps 4–6, the recruiter acting on it).

**Rig:** fresh-install dev build — empty database built by
`node migrate.js` **with migration 293 in the tree**, the assembled
application over real HTTP, seeded company + approved recruiter +
candidate + job + scheduled interviews created through the app's own
routes/seed paths used by the existing real-DB suites. Suite file
pattern: `server/__tests__/candidate-decline-outcome-realdb-1783.test.js`
/ the #1789 suite (real router over supertest against a migrated
throwaway DB, gated on an env URL, e.g.
`CAND1788_INTEGRATION_DB_URL`) may be used as the build's test file —
but per HL-003 the completion evidence is the assembled-app journey
below, with rows read back.

**Schema read-back (before the journey, on the migrated rig):**

- Exactly **one** status CHECK exists on `scheduled_interviews`;
  its name is `chk_scheduled_interviews_status` and
  `pg_get_constraintdef` shows all eight §5.1 values.
- The outcome CHECK is present and unchanged (`passed / failed /
  pending_review / no_decision / NULL`).
- Direct SQL spot-check: `status = 'reschedule_requested'` writes;
  `status = 'bogus_status'` still raises 23514 (the vocabulary is
  widened, not dropped).

**Red baseline (record first, before migration + validation are
written):** on current `dev`, step 2 returns **HTTP 500**, the server
log shows the `chk_scheduled_interviews_status` 23514, and the
read-back row is unchanged. That recorded failure is the reproduction
of the user's exact complaint, still owed as real-HTTP evidence per
the reviewer's note on #1788.

**The journey — a candidate asks to move an interview, and a
recruiter acts on it:**

1. Candidate loads My Interviews and sees a future interview in
   Upcoming (run the journey twice in full: once from a `scheduled`
   row, once from a `confirmed` row — W3's guard admits both).
2. Candidate opens **Reschedule**, types a reason and a preferred
   time, submits → expect **HTTP 200** and the dialog's success
   behaviour — no error toast, no 500.
3. Read back (candidate API + DB): `status = 'reschedule_requested'`,
   `scheduled_at` **unchanged** (no new time has been agreed),
   `outcome` unchanged, `notes` contains `[Reschedule request]`
   plus the typed reason and `Preferred: <time>`. On the candidate
   page the card shows the **Reschedule Requested** badge and the
   interview is still in Upcoming.
4. Recruiter loads their interviews: the same interview shows the
   **Reschedule Req.** badge, is in Upcoming, shows the candidate's
   reason/preferred time in its notes, and presents the **Confirm**
   button. The recruiter dashboard's needs-action list includes it,
   labelled **Reschedule requested**.
5. **Resolution leg A — Confirm:** the recruiter clicks Confirm
   (the client's real `PUT { status: 'confirmed' }` through W7) →
   200; read-back `status = 'confirmed'`; the candidate sees the
   interview as Confirmed again at the original time.
6. **Resolution leg B — new time:** on a second requested interview,
   the recruiter reschedules to a new time through the real
   reschedule route (`PUT /api/interviews/reschedule` with
   `new_scheduled_at`) → read-back `status = 'scheduled'` at the
   **new** time.
7. **No-reason API leg:** a reschedule submitted with neither reason
   nor preferred time still returns 200 and stores the route's
   existing default note (`Candidate requested reschedule`). (The
   client dialog requires a reason; this pins the API contract
   beneath it.)

**Negative / contract cases (same suite):**

- W7 with `status: 'reschedule_requested'` → 200 and persisted (it is
  canonical now, and a lawful recruiter-side transition into the
  state must not 400).
- W7 with `status: 'maybe'` and with `status: 'declined'` (a word the
  client badge maps carry but no writer may store) → **400**, row
  unchanged. W7 with `status: ''` → 400, row unchanged (§6.1).
- W7 with `status: null` and with `status` omitted → 200, stored
  status unchanged (keep-semantics pinned, §6.1).
- Candidate reschedules a `completed` or `cancelled` interview →
  404, row unchanged (guard unchanged). Candidate reschedules
  another candidate's interview → 404.
- Neighbours stay green unmodified: the #1783 suite (decline →
  `cancelled` / outcome NULL / notes) and the #1789 suite (outcome
  translation through the same W7 handler) — the §6.1 block sits in
  their handler, so their green is this lane's regression evidence.

---

## 9. Build gates that follow from this design

1. **STOP 1 (Nova)** must cite this document and state the specialist
   decision: the risk domain is the **database CHECK vocabulary /
   migration** — the ecc/database-reviewer lens is *mandatory* for
   this build (it was applied to this design, §7), unlike #1789
   where it was skippable under the no-migration option. Security
   and privacy specialists are considered and skipped, with reasons,
   on the issue: no auth, scoping, or data-exposure surface changes
   (§6.1 item 3).
2. Red-first: the §8 red baseline is recorded on #1788 before the
   migration or validation is written.
3. Independent review of the build PR, then the full §8 journey on
   the fresh-install rig before closure; evidence (requests,
   statuses, constraint read-back, row read-backs) attached to
   #1788.
4. Docs in the same build PR: a build-log entry under
   `docs/sdlc/rekrut-ai-v2/04-implementation/` following the #1783
   lane's pattern, linking this design — and carrying the §10
   citation correction if it has not already landed with this
   design PR.
5. Points: the issue carries 2 points, sized for the writer-only
   patch. Under D1 the lane is a numbered migration (a proven shape,
   but schema work on the shared DB) + one validation block + one
   real-DB suite — Rex recommends Lead re-point to **3**, mirroring
   #1789. That is Lead's call, flagged here, not a gate.

---

## 10. Citation nit — disposition (review Finding 9 / Lead checkpoint)

**The error:** `docs/sdlc/rekrut-ai-v2/04-implementation/1783-decline-outcome/build-log.md`
states the outcome column's vocabulary as
`chk_scheduled_interviews_outcome` (`migrations/p2_schema_hardening.sql:2820`,
`migrations/047_p2_schema_hardening.js`). Migration 047 is **not** a
source of that constraint: grep-verified at this tip, 047 contains
no outcome CHECK — its only `scheduled_interviews` outcome mention
is the varchar→TEXT conversion list (≈L196). The outcome CHECK
exists solely at `p2_schema_hardening.sql:2820`; 047's
`scheduled_interviews` constraint is the **status** CHECK
(:632-634). The same mis-citation is repeated in the OmniScore
comment's neighbourhood only by association — `services/omniscore.js`
itself cites both files correctly per-constraint (≈L550-556) and is
not touched.

**The fix, included in this design PR** (documentation correction,
not code): the build log's root-cause paragraph now cites
`migrations/p2_schema_hardening.sql:2820` alone for the outcome
CHECK, with a parenthetical recording that 047 adds no outcome
constraint. If Suga prefers corrections to land only with build PRs,
the one-file change is trivially separable — but leaving a known
wrong citation in the record while designing its sibling lane would
repeat the exact provenance failure the nit was filed for.

---

## 11. What this design does not do / open questions

- It does not build anything: no migration, no route change, and no
  client change is in this PR beyond the §10 documentation
  correction. The build is Nova's lane under §9's gates.
- It does not touch `interview_events`, `interview_sessions`, the
  outcome vocabulary (#1789, closed design), OmniScore, or the
  candidate `upcoming_only` narrowness noted in §2.4.
- It does not give the candidate a self-service exit from
  `reschedule_requested` (§5.2) — if a future journey wants
  "withdraw reschedule request", that is its own story.
- **Flagged for Suga (not blocked on Sumanth):** §4's schema-gate
  note — if the expand-only CHECK replacement is judged a MAJOR
  under the autonomy boundary, Sumanth's ruling is one line on this
  document. Rex's reading: drop-and-re-add of a CHECK with a strictly
  wider vocabulary is the expand step of the standing
  expand→migrate→contract rule, with precedents 274/275/292 built as
  normal lanes; no value, column, or row is contracted or deleted.
- **Flagged for Lead:** the re-pointing recommendation in §9 item 5.
