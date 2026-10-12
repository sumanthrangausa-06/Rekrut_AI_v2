# E-008 AI Observer Worker — Implementation Spec

**Issue:** #761 (S-080, Sprint 9)
**Status:** Draft — awaiting Sumanth's approval
**Author:** Rex (Solution Architect)
**Date:** 2026-10-12
**Gates:** S-046 (#694), S-047 (#695), S-048 (#696), S-049 (#697)

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
| `observer_jobs` schema | Architecture doc §5 | Designed, not migrated |
| `ai_observer_reports` schema | Architecture doc §5 | Designed, not migrated |

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

**Report `consent_state` enum** gains `unknown`: `granted | declined | withdrawn | unknown`. Unknown consent blocks the observer and renders honestly ("Consent status unknown — observer disabled").

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
                                              │  Fusion Engine     │
                                              │  (same as E-004/  │
                                              │   E-005, scoped   │
                                              │   to candidate)   │
                                              └────────┬──────────┘
                                                       ↓
                                              Integrity Events
                                              (14-event taxonomy)
                                                       ↓
                                              ai_observer_reports
```

**Reuse, don't rebuild:** The fusion engine is the same `AnalysisService` + `IntegrityService` used by E-004/E-005 (AI interviews). The observer scopes them to the candidate identity (`candidate-{id}`) in a human-interview context. No new ML models, no new signal types.

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

**Fusion-engine side effects:** Before implementation, trace `AnalysisService` and `IntegrityService` write paths. If the 14-event taxonomy materializes as rows outside `ai_observer_reports`, extend §5.1. Current assumption (to be verified): JSONB-only output, no side-effect rows.

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
| POST | `/api/interviews/sessions/:id/observer` | Recruiter JWT | Toggle observer on/off (S-046). Body: `{ enabled: boolean }`. Enqueue gate enforced. |
| GET | `/api/interviews/sessions/:id/observer/status` | Recruiter JWT | Job status + report state (S-047). |
| GET | `/api/interviews/sessions/:id/observer/report` | Recruiter JWT | Full observer report with section states (S-049). |

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

1. **Worker hosting:** Separate Render worker process (recommended, survives deploys) vs. in-process (simpler, dies on deploy)? Architecture says separate process. Confirm.
2. **Frame sampling rate:** 1fps proposed. Higher rates = more granular gaze data but more compute. Is 1fps sufficient?
3. **Interviewer transcription:** Observer transcribes interviewer speech for conversation context. Any privacy concern with processing interviewer audio?

---

## 11. Dependencies

**Requires (must exist before implementation):**
- S-070 consent gate (`lib/observerConsentGate.js`) ✅ built
- S-071 report states (`lib/observerReportStates.js`) ✅ built
- S-072 disclosure copy ✅ done
- E-004/E-005 fusion engine (AnalysisService, IntegrityService) — check status
- LiveKit room infrastructure — check status

**Blocks:**
- S-046 (#694): Observer toggle
- S-047 (#695): Invisible observer bot
- S-048 (#696): Consent disclosure
- S-049 (#697): Report generation

---

*End of E-008 AI Observer Spec*
