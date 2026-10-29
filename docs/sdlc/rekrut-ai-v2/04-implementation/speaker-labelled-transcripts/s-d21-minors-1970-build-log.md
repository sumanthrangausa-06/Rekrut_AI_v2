# #1970 Build Log — S-D21 review minors M-1..M-4 (§13 equality wording, purge-regex pin, path-B watch, decline-sentence scoping)

**Persona:** Nova (Phase 4 Implementation) · **Parent:** #1958 (S-D21, PR #1968, independent review comment 6494940145, APPROVE-WITH-MINORS)
**STOP 1:** https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/1970#issuecomment-6510418996 (posted before any code)
**Base:** dev `24a67c45e` (PR #1985 merge) — verified first-hand via `git fetch` at run start.
**Branch:** `nova/1970-sd21-minors` from `origin/dev`.
**Scope:** copy/test-only. No production behaviour or logic change, no schema, no migration. `DIARIZATION_ENABLED` untouched.

## Specialist decision (STOP 1, mandatory question answered)

- **Privacy engineer — MANDATORY, consulted** (agency-agents privacy-engineer subagent): verdict **ACCEPT-WITH-CONDITIONS**, all conditions adopted as implemented. (C-1, M-1 sweep) "at or before" must land in every normative timing instance — §13, canonical copy §2 + §3, the canonical §4 verification-table row, and terms ¶4 in the exact form "only if it is recorded at or before the time that recording starts" — with the test-1 pin updated to match; procedural "before" instances (participants *asked* / employer's duty to *inform* before the interview) are notice timing, not the gate, and stay. (C-2, M-4 exact form) the decline sentence reads "…declines **before labels are created for that recording**, no labels are created…" — recording-scoped, because the gate is re-evaluated at claim/write time and a decline after recording start but before label creation genuinely does prevent labels — and the purge sentence remains byte-identical to the C-2-accepted wording. (C-3, M-3) the no-change disposition must stay a documented watch item with its reopen trigger (see M-3 below). The specialist also verified the candidate leg of path B shares the same equality semantics (`granted_at > started_at` blocks), so no asymmetry is introduced. Lex advises on the terms wording and does not approve; the terms clause remains NOT in force (integration is a release action) — this PR only corrects its draft text.
- **Record correction (HL-007, amendment 2):** the builder's STOP 1 and the first draft of this log described the privacy verdict from a CONDENSED summary that invented a "split the decline sentences" condition. The specialist's FULL report contains no such condition — its C-2 is the exact form implemented above. Condensed summaries are not evidence; the full report governs. A correction comment is posted on #1970 alongside STOP 1.
- **Security reviewer — considered, SKIPPED:** no endpoint, auth, input, or data surface changes.
- **Database reviewer — considered, SKIPPED:** no schema/migration/query changes.
- Discussed position (HL-004, via STOP 1 reasoning): Lead — S-sized follow-up lane, no sprint conflict; Rex — no design change, wording follows the already-shipped S-D19 gate, never vice versa; Scout — facts verified first-hand on dev (gate comparison, every "before the recording starts" occurrence, test 4's regex, baseline suites).

## M-1 — equality-instant wording (gate blocks only `decided_at > started_at`)

`lib/diarizationGate.js` panel leg returns `PANEL_AGREEMENT_AFTER_RECORDING` only when `new Date(row.decided_at) > new Date(recording.started_at)` — an agreement at exactly `started_at` passes. "Before the recording starts" promised stricter. Changed to "at or before" in every published/draft artefact carrying the phrase:

| Where | Change |
|---|---|
| `client/src/pages/privacy.tsx` §13 | "and, **at or before** the recording starts, every other person expected…" (operative "An agreement recorded after a recording has started does not count" already matched the gate — unchanged) |
| `n3-recruiter-canonical-copy.md` §2 | "agreed on their own screen **at or before the recording starts**" |
| `n3-recruiter-canonical-copy.md` §3 | "on their own screen **at or before the recording starts**" |
| `n3-recruiter-canonical-copy.md` §4 table | Row retitled "Agreement must be recorded at or before the recording starts"; evidence now states the block fires **only** when `decided_at > started_at` (equality counts) |
| `n3-customer-terms-clause.md` ¶4 | "only if it is recorded **at or before the time that recording starts**" |
| `n3-customer-terms-clause.md` §2 note | "pre-recording timing rule" → "timing rule (agreement recorded at or before the recording's start, #1970 M-1)" |
| `n3-customer-terms-clause.md` §5 table | Row retitled "Agreement must be recorded no later than the recording's start (¶4)"; evidence states equality passes |

Design docs (`br7-panel-notice-design.md`, `architecture.md`, bridge design) use "pre-recording" for the capture *flow* (the notice renders before recording in the normal flow), not as a timing promise about the gate — out of M-1's wording scope, unchanged.

## M-2 — purge pin widened (test-only)

`PrivacySpeakerLabels1958.test.tsx` test 4 now pins the full sentence: /If a recruiter or panel member records a decline or withdrawal after labels have been created, those labels are removed **and the transcript stays, unlabelled**/ — the actor prefix AND the transcript-stays clause. Mutation proof below.

## M-3 — watch, NO CHANGE (disposition)

The universal "only where…" phrasing is exact for the event-bridge path (path B), where human panel recordings live; the session path (A) has no panel leg, and a future non-roster-voice flow (design §12/C-5) would strain it. The reviewer recorded: "No change now; revisit if either path changes." Scoping the sentence to path B would require new consent wording for path A and risks a fresh published-text-vs-gate contradiction (the #777 class this suite exists to prevent); on path A the sentence as written remains true (the candidate leg is still required; the panel leg is vacuous). **No copy invented; the watch stays on the record here and on #1970. Reopen trigger (privacy C-3, verbatim): if session path A ever serves multi-party/panel recordings, the universal §13 wording must be re-reviewed before that ships. (Builder's wider note: any change to either labelling path, or a non-roster voice being admitted under design §12/C-5, reopens it too.)**

## M-4 — decline sentence scoped to before creation

§13: "If the candidate or any other participant declines **before labels are created for that recording**, no labels are created, the transcript stays unlabelled, and there is no penalty for declining." The sentence is now explicitly a pre-creation statement, so it cannot be over-read as a candidate post-write purge promise. The purge sentence that follows is **verbatim unchanged** — panel-scoped ("If a recruiter or panel member records a decline or withdrawal after labels have been created…"), privacy C-2 accepted wording preserved. Test 3's pin updated to the scoped sentence (both decliners still named, C-2 intact).

## Red-first evidence

New pins run against the **base** (pre-fix) `privacy.tsx`: **2 failed / 2 passed (4)** — test 1 (M-1 "at or before" pin + stricter-phrase negative pin) and test 3 (M-4 scoped decline pin) fail on base wording; tests 2 and 4 pass (test 4's subject sentence already exists in its widened form on base — its red proof is by mutation, below).

After the copy edits: **4 passed / 4** for the suite; combined with the adjacent suites (SD15Disclosure, PanelLabellingNotice, BiometricPolicy): **44 passed / 44, vitest exit 0**. Baseline on unmodified dev was also 44/44.

**Mutation checks (M-2 pin strength), each run against the fixed tree with one mutation, then restored:**
- Purge actor widened to "If **the candidate** or a panel member records…" → **1 failed / 3 passed** (test 4 red, as intended).
- Purge sentence's "and the transcript stays, unlabelled" clause dropped → **1 failed / 3 passed** (test 4 red, as intended).

## E2E gate (HL-003) — fresh-install rig, state read back

The shared rigs were not usable this run: 127.0.0.1:55433 answers as PostgreSQL 16.4 **without pgvector** (`extension "vector" is not available` — migrate exit 1), and 55434's data dir sits on the /tmp tmpfs, which was 100% full (migrate died at migration 136, `No space left on device`, code 53100). Following the #1966 precedent, an equivalent fresh cluster was stood up from the same extracted PGDG tree (`~/workspace/.pg19rig/root`, PostgreSQL **18.6** + pgvector) at `/var/tmp/pg1970/` on 127.0.0.1:**55435** (as user `nobody`; this session runs as root and the workspace path is not traversable by `nobody`, hence the /var/tmp placement).

- Fresh DB `rekrut_1970_e2e`, single clean run: `DATABASE_URL='postgresql://postgres@127.0.0.1:55435/rekrut_1970_e2e' node migrate.js` → **exit 0, "All migrations completed successfully"** (205 "completed" lines).
- State read back: **259 public tables, 196 `_migrations` rows, extensions plpgsql + vector**.
- The changed surface itself is a static policy page: its user-visible text is exercised end-to-end by rendering the real `PrivacyPage` in the suites above (44/44) — no route, write, or DB behaviour is touched by this change, so no further journey leg exists for it.

## Independent review

<!-- REVIEW-SECTION -->
Pending at first commit — the independent reviewer's verdict is appended to this log and recorded on the PR before the PR is opened for Suga's gate.

## Not in this PR

No merge and no issue closure — Suga verifies first-hand and gates those.
