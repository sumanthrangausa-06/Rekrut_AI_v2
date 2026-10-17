# E-008 AI Observer Worker — Implementation Spec

**Issue:** #761 (S-080, Sprint 9)
**Status:** Approved by Sumanth 2026-10-12; **correction pass applied 2026-10-12** (panel decision: S-049 split — S-049a scaffold / S-049b real analysis). Corrections: retired the `AnalysisService`/`IntegrityService` reuse fiction (§§4.1, 5.1, 11), resolved the consent-state contradiction (§§3.1, 4.3), added the flush/erasure transactional requirement (§4.4), recorded `integrity_summary` as a projection (§4.3), and added the dependency-verification table (§11).
**Author:** Rex (Solution Architect)
**Date:** 2026-10-12
**Gates:** S-046 (#694) ✅, S-047 (#695) ✅, S-048 (#696) ✅, S-049 (#697 — split into S-049a scaffold + S-049b real analysis)

---

## 1. Purpose

The AI Observer is an invisible LiveKit agent that joins human interviews (when enabled) to passively capture audio/video streams, run behavioral + integrity analysis, and produce observations for human recruiter review. It never interrupts, never issues verdicts, and never produces a single integrity score.

**What this spec defines:** the worker runtime, job lifecycle, LiveKit wiring, analysis pipeline, report schemas, consent integration, erasure/retention wiring, and test strategy — everything Nova needs to implement S-046 through S-049.

**What already exists (do not rebuild):**
| Component | Location | Status |
|-----------|----------|--------|
| Architecture §3.19 | `docs/sdlc/.../03-solutioning/unified-interview-engine/architecture.md` | Design complete |
| Consent gate | `lib/observerConsentGate.js` (S-070) | Built, tested |
| Report states | `lib/observerReportStates.js` (S-071) | Built, tested |
| Disclosure copy | S-072 | UX-reviewed |
| Prototype observer | `agents/voice-interviewer/worker.mjs` Track B | Working prototype |
| `observer_jobs` schema | Migration 255 (S-047) | Migrated |
| `ai_observer_reports` schema | Migration 256 (S-047) | Migrated (no writer exists yet — S-049a) |

---

## 2. Worker Architecture

### 2.1 Process Model

```
┌─────────────────────────────────────────────────────┐
│  Render Web Service (Express)                        │
│  - SessionService.dispatchObserver(sessionId)        │
│  - Enqueue gate: canEnableObserver(session)          │
│  - INSERT INTO observer_jobs (session_id, status)    │
└──────────────────────┬──────────────────────────────┘
                       │ poll (5s interval)
┌──────────────────────▼──────────────────────────────┐
│  AI Observer Worker (separate Node.js process)       │
│  workers/ai-observer/                                │
│  - Claims pending jobs (SELECT FOR UPDATE SKIP LOCKED)│
│  - Joins LiveKit room as ai-observer-{sessionId}     │
│  - Subscribes to candidate audio/video (no publish)  │
│  - Runs analysis pipeline on streams                 │
│  - Writes ai_observer_reports on session end         │
│  - Heartbeat every 30s; stale-claim recovery at 5min │
└─────────────────────────────────────────────────────┘
```

**Why a separate process:** The Express web dyno restarts on deploy. The observer must survive deploys mid-interview (S-047 AC-4). A separate process polling the job table is independently restartable.

**Why not @livekit/agents framework:** The existing `agents/voice-interviewer/worker.mjs` already has a working LiveKit agent pattern (Track B prototype). Reuse that pattern — do not introduce the `@livekit/agents` framework as a new dependency (ponytail: reuse over new deps).

### 2.2 Job Lifecycle

```
pending → claimed → observing → flushing → complete
   │          │          │            │
   │          │          │            └── Write ai_observer_reports, mark complete
   │          │          └── On session end: stop capture, run final analysis
   │          └── Join room, start capture + streaming analysis
   └── Worker claims via SELECT FOR UPDATE SKIP LOCKED
```

**Stale-claim recovery:** If a worker dies mid-job, its heartbeat stops. A sweeper (same process, runs every 60s) resets jobs with `last_heartbeat < NOW() - INTERVAL '5 minutes'` back to `pending`. This handles worker crashes, Render restarts, and network partitions.

**Idempotency:** `observer_jobs` has a UNIQUE constraint on `session_id` — one job per session, ever. Re-dispatch attempts return the existing job.

### 2.3 LiveKit Wiring

**Identity:** `ai-observer-{sessionId}` (per architecture §3.19)

**Token grants (least privilege):**
- `roomJoin: true` — single room only (room name = session's LiveKit room)
- `canSubscribe: true` — audio + video tracks
- `canPublish: false` — zero published tracks (enforced by test)
- `canPublishData: false` — zero data channel messages (enforced by test)
- TTL: 1 hour (refreshed on heartbeat if session exceeds 1h)

**Invisibility:** The agent never appears in the participant UI. Frontend filters out identities matching `ai-observer-*` from the participant list. The agent publishes no tracks, so there's nothing to render even if the filter fails.

**What it subscribes to:**
- Candidate audio track → VAD → utterance segmentation → transcription → behavioral analysis
- Candidate video track → frame sampling (1 fps) → MediaPipe face/gaze analysis → integrity events
- Interviewer audio track → transcription only (for conversation context, not candidate scoring)

**What it NEVER does:**
- Publish any track (audio, video, data)
- Send any data channel message
- Speak, interrupt, or issue challenges
- Make any hiring decision or produce a verdict

---

## 3. Consent Integration

### 3.1 Enqueue Gate (S-070 contract)

The worker NEVER starts without passing the consent gate. The gate is evaluated at **three** points:

1. **Enqueue time** (Express): `SessionService.dispatchObserver()` calls `canEnableObserver(session)` before INSERT into `observer_jobs`. If blocked → 403 `BIOMETRIC_CONSENT_DECLINED`, no job created.

2. **Claim time** (Worker): Before joining the room, the worker re-checks `canEnableObserver(session)`. If the candidate withdrew consent between enqueue and claim → job marked `cancelled`, worker does not join.

3. **Pre-subscribe re-check** (Worker): Immediately before subscribing to candidate tracks (not just at claim), the worker re-checks the gate. Handles revocation in the claim→join window.

4. **Mid-session** (Worker): If consent is withdrawn during observation → worker disconnects immediately (max revocation-to-disconnect latency: **<10 seconds**), marks job `cancelled`, discards in-memory buffers without writing a report.

**Consent gate semantics (privacy-engineer BLOCKER — amended from S-070):**

The built gate (`lib/observerConsentGate.js`) currently blocks only on `biometric_collection === false`. For biometric processing, "not declined" is NOT consent — BIPA requires a written release *before* collection; GDPR Art. 9 requires *explicit* opt-in.

**The gate MUST be amended to default-deny:** `canEnableObserver` returns `allowed: true` ONLY when `biometric_collection === true`. `undefined`/`null` (consent never presented, legacy session, config drift) → blocked with code `BIOMETRIC_CONSENT_UNKNOWN`.

This requires an S-070 amendment (already-built code) and architecture §3.19 update. **Flagged for Sumanth's decision** — this changes the `!== false` semantics baked into the architecture doc.

**Resolved-state enum (read time):** Section states resolved through `lib/observerReportStates.js` span `granted | declined | withdrawn | unknown`. Unknown consent blocks the observer and renders honestly ("Consent status unknown — observer disabled"). **These are read-time resolved states, not stored row values** — per §3.2 and §4.3, `ai_observer_reports` rows are written **only for granted sessions** and always carry `consent_state = 'granted'`; declined/withdrawn/unknown sessions have no row, and their state is derived from consent at read time.

**Revocation transport:** The worker polls `interview_sessions.config` every poll cycle (≤5s) and re-evaluates `canEnableObserver` independently of any broadcast. `broadcastConsentRevoked(sessionId)` is a best-effort fast path (in-process event); the poll-based re-check is the guarantee. Max revocation-to-disconnect: <10s (two poll cycles).

**DSAR `deletion_pending` flag:** Per architecture §3.19, the worker checks a `deletion_pending` flag on the session before each report flush. If set (mid-session erasure request), the report write is suppressed.

**Sweeper exclusion:** Stale-claim recovery resets jobs with `last_heartbeat < NOW() - 5min` to `pending`, but MUST explicitly exclude `cancelled`, `failed`, and `complete` statuses. A consent-cancelled job must never be resurrected.

**This is the structural guarantee (Option A):** the observer cannot process data it never receives. In-memory processing (1fps MediaPipe analysis) IS collection under BIPA/GDPR Art. 9 — the consent gate (not the in-memory pipeline) is the legal protection. The in-memory design reduces breach/exposure surface but does not reduce the consent obligation.

### 3.2 Report States (S-071 contract)

When the gate blocks the observer, no `ai_observer_reports` rows exist. Every biometric section in the report MUST resolve through `lib/observerReportStates.js`:
- `present` — observer ran, data exists
- `missing` — observer ran, data unavailable (technical gap)
- `declined` — derived from `biometric_collection === false`, NOT from row absence

**Critical:** `declined` is a consent-derived state. A declined session has zero rows. Code that checks "rows exist?" will misread declined as missing. Always resolve through the module.

### 3.3 Disclosure (S-072 contract)

The candidate sees conditional disclosure text based on consent state. The worker does not handle disclosure — that's the frontend consent flow (S-048). The worker only enforces the gate.

---

## 4. Analysis Pipeline

### 4.1 Pipeline Stages

```
Audio Stream → VAD → Utterance → Transcription → Behavioral Signals
                                                          ↓
Video Stream → Frame Sample (1fps) → MediaPipe → Visual Signals
                                                          ↓
                                              ┌───────────────────┐
                                              │  Signal Writers    │
                                              │  (E-004, future —  │
                                              │  see §4.1 note)    │
                                              └────────┬──────────┘
                                                       ↓
                                              Integrity Events
                                              (14-event taxonomy)
                                                       ↓
                                              ai_observer_reports
```

**⚠️ Correction (2026-10-12) — the reuse assumption is retired.** The original text of this section claimed the observer reuses a fusion engine — "the same `AnalysisService` + `IntegrityService` used by E-004/E-005." **Those services do not exist.** Verified 2026-10-12: no `AnalysisService` or `IntegrityService` exists anywhere in the codebase; E-004/E-005 are unbuilt epics. Legacy mock-interview and screening reports were each hand-rolled inline in their route handlers (`interview_analysis`, `screening_sessions.ai_report`) — no shared analysis service ever existed. Do not plan against this fiction (see §11 dependency-verification table).

**Verified reality:**
- The codebase's actual shared AI stack is `services/interview-ai.js` (transcript → scoring), reused by mock, screening, and Track B because they share a transcript input type.
- Behavioral/integrity analysis has exactly **one** prospective consumer: the Observer. Building a shared service for one consumer is premature abstraction.
- **When E-004 is built**, its first story writes behavioral/integrity signals against the frozen §4.3 contract **inside the observer's flush path** (§4.4) — scoped to the candidate identity (`candidate-{id}`) in a human-interview context. No new ML models or signal types are introduced by E-008 itself.
- **Until then (S-049a):** the report writer persists the §4.3 skeleton with every section state resolved through `lib/observerReportStates.js` — `missing` where no analysis exists. Nothing is fabricated: no scores, no signals, no events.

### 4.2 What the Observer Captures

**Vocal signals** (from candidate audio):
- Speech rate, pause patterns, filler-word frequency
- Turn-taking dynamics (interruption patterns, response latency)
- Vocal stress indicators (pitch variance — **not** deception detection, per Sumanth's correction)

**Visual signals** (from candidate video, 1fps sampling):
- Gaze direction (away frequency, duration)
- Face presence/absence
- Expression valence (positive/neutral/negative — coarse, not emotion labeling)

**Integrity observations** (14-event taxonomy, same as E-005):
- `gaze_away`, `face_absent`, `multiple_faces`, `tab_switch`
- `voice_deviation`, `lip_sync_fail`, `reading_pattern`, `latency_anomaly`
- `zero_hesitation`, `screen_flash_anomaly`, `signal_gap`, `signal_unavailable`
- Plus `challenge_issued`, `challenge_failed` (N/A for observer — never issues challenges)

**What it does NOT capture:**
- Interviewer behavioral analysis (transcription for context only)
- Any biometric template (no face embeddings stored — frames are analyzed in-memory, not persisted)
- Any hiring recommendation or score

### 4.3 Report Schema

```sql
-- Migration: create ai_observer_reports (from architecture doc §5)
-- FK uses ON DELETE CASCADE per architecture doc §5 convention (verified
-- against lines 516, 549, 579, 598, 615, 678 — all interview_session_id FKs).
CREATE TABLE ai_observer_reports (
  id SERIAL PRIMARY KEY,
  interview_session_id INTEGER NOT NULL UNIQUE
    REFERENCES interview_sessions(id) ON DELETE CASCADE,
  livekit_room_name VARCHAR(255),
  observer_identity VARCHAR(255) NOT NULL,  -- ai-observer-{sessionId}
  analysis JSONB NOT NULL DEFAULT '{}',
  integrity_summary JSONB NOT NULL DEFAULT '{}',
  consent_state VARCHAR(20) NOT NULL DEFAULT 'unknown'
    CHECK (consent_state IN ('granted', 'declined', 'withdrawn', 'unknown')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_observer_session ON ai_observer_reports(interview_session_id);
CREATE INDEX idx_observer_room ON ai_observer_reports(livekit_room_name);
```

**`analysis` JSONB schema:**
```json
{
  "vocal": {
    "state": "present | missing | declined",
    "speech_rate_wpm": 142,
    "avg_pause_ms": 850,
    "filler_word_rate": 0.03,
    "turn_count": 47,
    "avg_response_latency_ms": 1200
  },
  "visual": {
    "state": "present | missing | declined",
    "gaze_away_events": 12,
    "gaze_away_total_sec": 45,
    "face_absent_events": 2,
    "face_absent_total_sec": 8,
    "expression_valence": "neutral"
  },
  "conversation": {
    "turn_count": 47,
    "candidate_talk_ratio": 0.62,
    "transcript_available": true
  }
}
```

**`integrity_summary` JSONB schema:**
```json
{
  "state": "present | missing | declined",
  "events": [
    {
      "event_type": "gaze_away",
      "severity": "info",
      "count": 12,
      "confidence": 0.82,
      "review_status": "unreviewed"
    }
  ],
  "total_events": 14,
  "critical_count": 0,
  "warning_count": 3,
  "info_count": 11
}
```

**Design principles:**
- Every section has a `state` field resolved through `observerReportStates.js`
- No single integrity score — events are listed individually for human review
- `review_status` starts as `unreviewed` — recruiter confirms or dismisses each event
- Confidence scores are included but never thresholded into verdicts

**Write rule (panel decision 2026-10-12 — resolves the former §3.2/§4.3 contradiction):**
- The writer fires **only for granted sessions**. Every row written carries `consent_state = 'granted'`, set explicitly by the writer.
- **Declined, withdrawn, and unknown sessions get NO row.** Their state is derived from consent at read time via `lib/observerReportStates.js` (§3.2). Writing a declined/unknown row would itself create observation metadata about a candidate who never consented to observation.
- The column's wider CHECK enum (`granted | declined | withdrawn | unknown`, migration 256) and its `DEFAULT 'unknown'` are schema permissiveness only — they are **not** writer behaviour and must never be relied on. No code path may INSERT a row without explicitly setting `consent_state = 'granted'`.

**`integrity_summary` is a projection, not a store of record:** When E-004 materializes the 14-event taxonomy, events live in a future `integrity_events` table (authoritative). `integrity_summary` in this table is a **derived, regenerable projection** of that table — it can be rebuilt from `integrity_events` at any time and must never become a second authoritative store. Shape changes to the projection are **versioned** (bump a `version` field inside the JSONB when the shape changes; consumers must tolerate older versions).

### 4.4 Report Flush — Writer Contract (S-049a)

The worker today has **no session-end path**: `lib/observerJobs.js` `complete()`/`markFlushing()` exist but have zero callers. S-049a builds `flushReport()`:

- **Trigger:** piggyback on the worker's existing 5-second consent poll tick — widen its session SELECT to include `status`; flush when `status = 'completed'`. (Room-disconnect events are rejected as a trigger: a transport drop is not a session end, and a false flush writes a premature report.)
- **Idempotency:** `INSERT … ON CONFLICT (interview_session_id) DO NOTHING`. First data-bearing write wins — an upsert could overwrite a good report with a resurrected worker's empty aggregates. `complete()`/`markFlushing()` must gain status guards so a late flush cannot "complete" a cancelled job.
- **Transactional consent/erasure re-check (mandatory):** inside the writer's transaction, **abort the write if the `observer_jobs` row is gone or its status is not `flushing`**. Rationale: erasure deletes both tables (§5.1), so a missing job row means erasure is in progress or complete — writing a report row at that moment would resurrect erased data. A consent re-check alone is NOT sufficient: erasure deliberately retains the consent fact, so the gate would still pass post-erasure. The job-existence check is the reliable signal.
- **Mandatory race test (hard AC for S-049a):** consent revoked, or erasure requested, between session end and flush ⇒ **no row is written**. If the test exposes missing infrastructure, Nova re-estimates at STOP 1 rather than absorbing it.
- **⚠️ Open item — the race is narrowed, NOT closed:** the *fully concurrent* window (an erasure transaction running mid-flush) requires a **shared advisory lock inside `erasureService`** serializing erasure vs. flush. That hardening belongs to **S-049b**. Do not record the erasure race as closed until S-049b lands it. **Extended (privacy-engineer F1, S-049a review 2026-10-12):** the same S-049b lock scope MUST also cover a **consent withdrawal landing mid-flush** — the production withdrawal path flips `config.biometric_collection` and does not cancel `observer_jobs`, so S-049a's in-tx job-status check does not detect a withdrawal that lands after the writer's pre-tx gate check. S-049b must lock/re-read the session row inside the flush transaction (or serialize withdrawal vs. flush with the same advisory lock).

---

## 5. Erasure Wiring (Day One)

**Requirement:** `ai_observer_reports` MUST be in the erasure path from day one. No "we'll add it later."

### 5.1 Erasure Coverage

Add to `lib/erasureService.js` `erasePersonalData()`:

```js
// S-080 (E-008): AI Observer reports. Scoped by interview_session_id → candidate.
// The observer never stores biometric templates (frames analyzed in-memory),
// so this is report-data deletion, not template destruction.
const { rowCount: observerReportRows } = await queryable.query(
  `DELETE FROM ai_observer_reports
   WHERE interview_session_id IN (
     SELECT id FROM interview_sessions WHERE candidate_id = $1
   )`,
  [userId],
);
// Observer job queue rows reveal the candidate was under biometric observation
// (session linkage + timing metadata). Erase alongside reports.
const { rowCount: observerJobRows } = await queryable.query(
  `DELETE FROM observer_jobs
   WHERE interview_session_id IN (
     SELECT id FROM interview_sessions WHERE candidate_id = $1
   )`,
  [userId],
);
```

Include both row counts in the erasure result object for the audit trail.

**FK consistency:** Both migrations use `ON DELETE CASCADE` on `interview_session_id` (aligned with architecture doc §5 convention). The explicit DELETEs above are belt-and-suspenders — session deletes cascade, but erasure runs before session deletion in the DSAR flow.

**Erasure vs. flush race:** The §4.4 transactional job-existence check narrows the race between a report flush and an erasure run, but the fully-concurrent window (erasure transacting mid-flush) remains **open** — it requires a shared advisory lock inside `erasureService`, assigned to **S-049b**. Not closed; do not treat §5.1 coverage as race-proof until S-049b lands the lock. The same open window covers a mid-flush consent withdrawal (see §4.4, privacy-engineer F1) — also S-049b scope.

**Pipeline side-effect rows (deferred to S-049b / E-004):** There is no analysis pipeline today (§4.1 correction), so there are no pipeline side-effect rows to erase yet. When E-004 materializes the taxonomy as an `integrity_events` table, §5.1 MUST be extended in the same story that creates it — `integrity_summary` is only a projection of that table (§4.3) and deleting the projection without the source rows would be incomplete erasure.

### 5.2 What Does NOT Need Erasure

- **Video frames:** The observer analyzes frames in-memory (1fps sampling → MediaPipe → signals). Frames are never persisted to R2/B2 or disk. No frame cleanup needed.
- **Audio recordings:** The observer does not record audio. Transcriptions go into the `analysis` JSONB (covered by the DELETE above).
- **Biometric templates:** The observer does not create biometric templates. No `biometric_templates` rows.

### 5.3 Retention Interplay (S-077)

**Observer reports: 30-day retention** (aligned with vision-frame precedent in migration 253, not the 90-day session default).

Rationale (GDPR Art. 5(1)(c),(e) storage limitation): the report's purpose is human recruiter review of observations. Gaze/voice/expression analytics are biometric-derived — the 30-day vision-frame precedent in this codebase is the closer analog than the 90-day general session retention. Once events are reviewed, continued retention needs justification it doesn't have.

**Purge mechanism:** Extend the S-077 retention sweep to cover `ai_observer_reports`:
```sql
-- In the retention cron, alongside recording_objects sweep:
DELETE FROM ai_observer_reports
WHERE created_at < NOW() - INTERVAL '30 days';
```
Scope, schedule (daily, same cron), and audit logging follow the existing S-077 pattern.

**BIPA §15(a) schedule:** The 30-day retention period IS the written retention schedule for observer-derived biometric information. It MUST be published in the privacy/BIPA policy before launch (pre-launch gate).

**S-077 registry note:** The S-077 `recording_objects` registry tracks encrypted storage blobs. Observer in-memory analysis creates no registry entries. If a future version persists observer frames, they MUST be registered with `object_type='observer_frame'` and 30-day expiry.

**Open for Sumanth/legal (Phase 3 review):** Delete-on-hiring-decision vs. blanket 30d — for rejected candidates, the review purpose is fulfilled at decision time.

---

## 6. Database Migrations

### Migration 1: `observer_jobs` table
```sql
-- FK uses ON DELETE CASCADE per architecture doc §5 convention.
CREATE TABLE observer_jobs (
  id SERIAL PRIMARY KEY,
  interview_session_id INTEGER NOT NULL UNIQUE
    REFERENCES interview_sessions(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','claimed','observing','flushing','complete','cancelled','failed')),
  worker_id VARCHAR(255),
  claimed_at TIMESTAMPTZ,
  last_heartbeat TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_observer_jobs_status ON observer_jobs(status) WHERE status = 'pending';
CREATE INDEX idx_observer_jobs_heartbeat ON observer_jobs(last_heartbeat)
  WHERE status IN ('claimed','observing','flushing');
```

### Migration 2: `ai_observer_reports` table
(See §4.3 above.)

---

## 7. API Surface

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/interviews/interview-sessions/:id/observer/enable` | Recruiter JWT | Enable observer (S-046, built — `routes/interview-sessions.js:1030`). Enqueue gate enforced. |
| POST | `/api/interviews/interview-sessions/:id/observer/disable` | Recruiter JWT | Disable observer (S-046, built — `routes/interview-sessions.js:1130`). |
| GET | `/api/interviews/interview-sessions/:id/observer/status` | Recruiter JWT | Job status + report metadata (`id`, `consent_state`, `created_at` only — not report content; S-047, built — `routes/interview-sessions.js:1177`). |
| GET | `/api/interviews/interview-sessions/:id/observer/report` | Recruiter JWT | Full observer report with section states (**S-049b** — the read contract is defined by the S-039 renderer; S-049a is writer-only per panel decision 2026-10-12). **Name collision:** the Track B scored Q&A report already occupies `POST /api/interviews/interview-sessions/:id/observer/report` (`routes/interview-sessions.js:1224`, writes `config.report`). It must be renamed (e.g. `…/observer/qa-report`, deprecated alias for one sprint) in S-049b, before S-039. |

**Not needed:** A separate "dispatch" endpoint — the existing `POST /session-rooms/:sessionId/dispatch` (mode=`observer`) already exists and is gated (S-070).

---

## 8. Test Strategy

### Unit Tests
- Consent gate integration: `canEnableObserver` blocks enqueue/claim/mid-session
- Report state resolution: `declined` derived from consent, not row absence
- Job lifecycle: claim → heartbeat → stale-claim recovery → complete
- Schema validation: `analysis` and `integrity_summary` JSONB shapes

### Integration Tests
- Worker joins room with subscribe-only grants (assert zero published tracks)
- Invisibility: frontend participant filter excludes `ai-observer-*`
- End-to-end: session → job → worker → report → recruiter views side-by-side

### Negative Tests (Critical)
- **Zero published tracks:** Automated test asserts the observer identity publishes zero audio/video/data tracks during a full session
- **Zero data messages:** Assert zero data channel messages from observer identity
- **Consent withdrawal mid-session:** Worker disconnects, no report written, in-memory buffers discarded
- **Deploy during session:** Worker process survives Express restart (separate process)

---

## 9. Privacy Considerations

| Concern | Mitigation |
|---------|------------|
| Biometric data collection | Gated by Option A consent (default-deny) — observer never receives streams without explicit `biometric_collection === true` |
| In-memory processing | IS collection under BIPA/GDPR Art. 9 — consent gate (not the pipeline) is the legal protection |
| Data minimization | 1fps video sampling (not full stream); frames analyzed in-memory, never persisted |
| No biometric templates | Observer does not create face embeddings or voiceprints |
| Retention | 30 days for observer reports (BIPA §15(a) schedule — must be published pre-launch) |
| Erasure | `ai_observer_reports` + `observer_jobs` in `erasePersonalData()` from day one (§5.1) |
| Transparency | S-072 disclosure copy; candidate knows AI analysis may occur |
| Human review | All observations are `unreviewed` by default; no autonomous decisions |
| Interviewer DSAR | Interviewer speech transcribed for context lands in candidate-scoped reports. Interviewer erasure requests: recruiter-as-employee data policy applies (to be defined — do not leave undefined at implementation) |
| Phase 3 legal review | Recorded decision (MEMORY.md): counsel must review consent flow + retention before Phase 3 — this spec is in scope for that review |

---

## 10. Open Questions for Sumanth

1. **Worker hosting:** ✅ **DECIDED 2026-10-12 (Sumanth, on Rex's recommendation): in-process** — the worker starts with the web service (`server.js` boot, `AI_OBSERVER_IN_PROCESS=false` to opt out; standalone mode preserved). Separate Render worker deferred until revenue justifies it (~$84/yr avoided). Implemented in S-047 (PR #774).
2. **Frame sampling rate:** 1fps proposed. Higher rates = more granular gaze data but more compute. Is 1fps sufficient?
3. **Interviewer transcription:** Observer transcribes interviewer speech for conversation context. Any privacy concern with processing interviewer audio?

---

## 11. Dependencies — Verification Table

**Process rule (panel, 2026-10-12):** every dependency carries a verified state — *Verified-Exists* (file/table evidence + date), *Verified-Absent* (named owning story), or *Sumanth-Waived*. An unverified dependency **blocks spec approval automatically**. Verification performed 2026-10-12 by Scout (repo `dev` @ `aee148dc`) and Rex.

| Dependency | State | Evidence / owning story |
|---|---|---|
| S-070 consent gate | ✅ Verified-Exists | `lib/observerConsentGate.js`, amended to default-deny by S-046 (PR #773) |
| S-071 report states | ✅ Verified-Exists (built, **unwired**) | `lib/observerReportStates.js` + tests exist; Scout verified **zero production callers** — first caller is the S-049a writer |
| S-072 disclosure copy | ✅ Verified-Exists | UX-reviewed copy; rendered by S-048 (PR #775) |
| `observer_jobs` table | ✅ Verified-Exists | Migration 255 (S-047) |
| `ai_observer_reports` table | ✅ Verified-Exists (schema only) | Migration 256 (S-047). **No writer** (→ S-049a) and **no content reader** (only the status endpoint's metadata SELECT; → S-049b) — Scout-verified |
| LiveKit room infrastructure | ✅ Verified-Exists | `server/services/livekit.js`, `routes/livekit.js`, worker `workers/ai-observer/` (S-047) |
| Shared transcript→scoring stack | ✅ Verified-Exists | `services/interview-ai.js` — the codebase's actual shared AI stack (mock/screening/Track B) |
| `AnalysisService` / `IntegrityService` | ❌ **Verified-Absent** | Zero code hits (Scout, 2026-10-12). Named in `epics-stories.md` technical notes for S-034 (§3.12) / S-027 (§3.13) only. **The former §4.1 reuse assumption is retired** — no story may plan against these services |
| E-003 Calibration (S-019/S-020/S-021) | ❌ Verified-Absent (spec-only) | Fully spec'd (`epics-stories.md` E-003; architecture §3.21) — no `CalibrationService`, no `calibration_baselines`/`accommodation_modes` migration, no client flow. Owning stories: S-019–S-021. Not required by S-049a; E-004 signal stories depend on it per the sprint plan |
| S-027 integrity fusion (E-004) | ❌ Verified-Absent (spec-only) | `epics-stories.md:921`, 8 pts, ACs unchecked; its own prerequisite S-029 (`integrity_events` migration) is also unbuilt |
| S-034 behavioural fusion (E-005) | ❌ Verified-Absent (spec-only) | `epics-stories.md:1057`, 5 pts, ACs unchecked |
| S-039 renderer read store | Partial | S-039 is unbuilt. Today's only live frontend observer-report read is Track B `interview_sessions.config.report` (`client/src/pages/recruiter/InterviewReport.tsx`, `SessionReport.tsx`). The E-008 read path (`ai_observer_reports` + GET endpoint) lands with S-049b |

**Story dependency consequences:**
- **S-049a requires none of the absent items.** It needs only: migrations 255/256 ✅, `observerJobs` ✅, `observerReportStates` ✅.
- **S-049b formally requires S-027 + S-034** (closing the gap Scout flagged: `epics-stories.md` lists them as S-049's requirements; they are hereby recorded as S-049b's), plus the S-029 `integrity_events` migration beneath S-027, plus the Track B `…/observer/report` rename (§7) before S-039.
- **Nothing in this spec is Sumanth-Waived.**

**Blocks:**
- S-046 (#694): Observer toggle ✅ merged (PR #773)
- S-047 (#695): Invisible observer bot ✅ merged (PR #774)
- S-048 (#696): Consent disclosure ✅ merged (PR #775)
- S-049 (#697): Report generation — **split 2026-10-12** into S-049a (writer scaffold) + S-049b (real analysis, blocked by S-027/S-034 above)

---

*End of E-008 AI Observer Spec*
