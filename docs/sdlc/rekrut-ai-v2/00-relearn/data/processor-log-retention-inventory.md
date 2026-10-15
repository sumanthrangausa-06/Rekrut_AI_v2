# Processor & Log Retention Inventory — GAP-J (#1129)

**Status:** INVENTORY + DESIGN. This document records, per processor-service
and per log sink, what candidate personal data leaves the primary database,
what first-party control exists in code today, and the **designed**
disposition. Dispositions in this document are **DESIGNED, NOT
IMPLEMENTED** unless a row says BUILT: `erasePersonalData()` performs no
processor-side deletion today, and no vendor retention period, deletion
SLA, training use, or DPA state recorded here is verified — every
vendor-side entry is marked **NOT VERIFIED** pending vendor-terms review
(tracked on the #788 pattern, §6.2 of the keep/erase table; nothing sent,
no vendor contact).

**Authority / story:** GAP-J (#1129), §4.3 of the
[erasure keep/erase table](./erasure-keep-erase-table.md) (Lex). STOP 1 on
#1129 (comment 6183277347) is the build contract: Scout's enumeration,
the privacy engineer's design, and Lex's binding field set.

**Verification posture:** every factual claim is verified against
`origin/dev` @ `b834a8ff` with a file:line (or migration) citation, per
this folder's convention. Anything that could not be verified from the
repo is marked **NOT VERIFIED** rather than filled in. No live-DB / Neon
verification is claimed. Field names and data classes only — **no raw log
samples, payloads, or PII appear in this document**.

**Owners:** Lex (legal shape), Scout (enumeration), Nova (build).

---

## How to read this inventory

**One entry per processor-service.** There is deliberately no single
"AI providers" entry: providers differ in data classes, code paths, and
evidence state, so each is inventoried separately even where the
disposition design is the same today.

**Erasure-reach codes (Lex, binding):**

| Code | Meaning |
|------|---------|
| **A** | Deletion API / primitive held in our code and usable by erasure |
| **B** | Deletion by request (manual / vendor request process) |
| **C** | Expiry-only — data ages out on a retention clock; **C is never labelled propagation** |
| **D** | No path — no deletion path exists |
| **E** | Unknown — vendor-side capability not established from evidence |

**Disposition discipline (privacy design, Principle 5 of the keep/erase
table):** expiry counts as a disposition **only** as a short fixed
retention **with the schedule disclosed in the erasure confirmation**.
An entry marked "honest-cannot-reach today" means: from verified code
and evidence, erasure cannot reach that copy today, and no wording —
internal or candidate-facing — may claim otherwise until a follow-on
build lands and the entry is re-marked.

**Follow-on builds filed from this inventory (Lead):** #1179 (log-content
redaction sweep) · #1180 (Sentry posture) · #1181 (DB log-table retention
design) · #1182 (processor deletion-propagation builds tracker,
per-processor, gated on terms evidence + boundaries B-J1/B-J2/B-J4).

---

## 1. Processor-service inventory

### 1.1 Brevo — transactional email

- **Identity & role (asserted):** transactional email processor (send
  path for platform email).
- **Data classes sent:** recipient email address, subject, rendered
  HTML body and text body of the message
  (`lib/email-service.js:382-393`, `:394-401`). Mapped to keep/erase
  table line **E-15** (communications content) for the message content;
  the recipient address is candidate/recruiter contact data.
- **Trigger & identifiers:** email send from `lib/email-service.js`;
  SMTP fallback path at `lib/email-service.js:27-28`, `:419-439`;
  account check at `lib/email-service.js:1075`. These are the **only
  two Brevo endpoints in the repo** — no deletion or contact API call
  exists in the codebase.
- **First-party control (code-verified):** send + account check only
  (citations above). No contact-deletion, message-deletion, or
  log-deletion call is held.
- **Vendor retention claim:** **NOT VERIFIED**.
- **Training/use claim:** **NOT VERIFIED**.
- **Erasure reach:** **E** — unknown; no in-repo deletion path exists.
- **DPA evidence state:** **NOT VERIFIED**.
- **Downstream/transfer:** **NOT VERIFIED**.
- **Disposition design + follow-on:** split disposition (privacy
  design) — **contacts → propagation candidate** (designed, #1182);
  **send logs / message content → expiry-only design (C)**, valid only
  as a short fixed retention with the schedule disclosed in the erasure
  confirmation (Principle 5). Vendor-side state for both halves:
  **NOT VERIFIED** pending #1182 terms evidence. Note the first-party
  copy of the same content in the `notification_logs` DB table
  (full body + HTML) — see §2, log sinks.

### 1.2 Polsia proxy — LLM proxy (fronts Anthropic Claude + OpenAI)

- **Identity & role (asserted):** LLM proxy service; the platform's
  AI calls are routed through it to upstream model providers
  (asserted upstreams: Anthropic Claude and OpenAI).
- **Data classes sent:** LLM message content, including resume text
  truncated to 15k characters (`lib/polsia-ai.js:251-254`, fed from
  `routes/candidate.js:622-632`) — keep/erase **E-1** (profile content /
  parsed resume text); interview transcripts and evaluations
  (`services/interview-ai.js`, via `aiProvider.chat`) — **E-3**
  (interview content); match prompts
  (`routes/candidate-company-matches.js:243`, `:334`, `:407`) —
  **E-2** (derived / match data).
- **Trigger & identifiers:** AI feature calls through the Polsia
  clients at `lib/ai-provider.js:336-341`, with duplicate client
  definitions at `lib/polsia-ai.js:10-13` and `lib/qp-ai.js:17`.
  Identifiers travel inside the message payloads themselves
  (field names only recorded here).
- **First-party control (code-verified):** the outbound call sites
  above. No message, file, or conversation deletion call to the proxy
  exists in the repo.
- **Vendor retention claim:** **NOT VERIFIED** (proxy-side and
  upstream-side alike).
- **Training/use claim:** **NOT VERIFIED**.
- **Erasure reach:** **E** — unknown; honest-cannot-reach today.
- **DPA evidence state:** **NOT VERIFIED**.
- **Downstream/transfer:** asserted upstreams named above; the actual
  downstream handling and any further transfer are **NOT VERIFIED**.
- **Disposition design + follow-on:** honest-cannot-reach today;
  verification and any propagation build via **#1182**.

### 1.3 OpenAI (via `OPENAI_BASE_URL`) — LLM / vision / speech / embeddings

- **Identity & role (asserted):** model provider reached through the
  `OPENAI_BASE_URL` environment-configured base URL.
- **Data classes sent:** chat message content; vision inputs (see the
  shared vision mechanism note after §1.9); TTS text; ASR audio;
  embedding inputs (`lib/ai-provider.js:347-352`; ASR at
  `lib/ai-provider.js:1935-1948`; embeddings at
  `lib/ai-provider.js:558-565`, caller
  `services/matching-engine.js:31`, `:36-45`). Mapped to keep/erase
  **E-1 / E-2 / E-3** according to the calling feature (resume,
  match, interview content).
- **Trigger & identifiers:** provider-chain calls in
  `lib/ai-provider.js` (citations above); identifiers inside the
  payloads.
- **First-party control (code-verified):** outbound calls only. No
  file or message deletion call exists in the repo for this provider.
- **Vendor retention claim:** **NOT VERIFIED**. The actual upstream
  behind the environment base URL is itself **NOT VERIFIED**.
- **Training/use claim:** **NOT VERIFIED**.
- **Erasure reach:** **E** — unknown; honest-cannot-reach today.
- **DPA evidence state:** **NOT VERIFIED**.
- **Downstream/transfer:** **NOT VERIFIED** (see upstream note above).
- **Disposition design + follow-on:** honest-cannot-reach today;
  **#1182**.

### 1.4 NVIDIA NIM — model provider

- **Identity & role (asserted):** model provider in the AI provider
  chain.
- **Data classes sent:** chat message content and ASR audio submitted
  through the provider chains (`lib/ai-provider.js:356-360`; chains at
  `lib/ai-provider.js:458-580`; ASR at `lib/ai-provider.js:2136-2145`).
  Mapped to **E-1 / E-3** by calling feature.
- **Trigger & identifiers:** provider-chain selection in
  `lib/ai-provider.js`; identifiers inside payloads.
- **First-party control (code-verified):** outbound calls only; no
  deletion call held.
- **Vendor retention claim:** **NOT VERIFIED**.
- **Training/use claim:** **NOT VERIFIED**.
- **Erasure reach:** **E** — unknown; honest-cannot-reach today.
- **DPA evidence state:** **NOT VERIFIED**.
- **Downstream/transfer:** **NOT VERIFIED**.
- **Disposition design + follow-on:** honest-cannot-reach today;
  **#1182**.

### 1.5 Moonshot Kimi — model provider

- **Identity & role (asserted):** model provider in the AI provider
  chain.
- **Data classes sent:** chat message content via the provider chain
  (`lib/ai-provider.js:396-400`). Mapped to **E-1 / E-2 / E-3** by
  calling feature.
- **Trigger & identifiers:** provider-chain selection in
  `lib/ai-provider.js`; identifiers inside payloads.
- **First-party control (code-verified):** outbound calls only; no
  deletion call held.
- **Vendor retention claim:** **NOT VERIFIED**.
- **Training/use claim:** **NOT VERIFIED**.
- **Erasure reach:** **E** — unknown; honest-cannot-reach today.
- **DPA evidence state:** **NOT VERIFIED**.
- **Downstream/transfer:** **NOT VERIFIED**.
- **Disposition design + follow-on:** honest-cannot-reach today;
  **#1182**.

### 1.6 Groq — model provider

- **Identity & role (asserted):** model provider in the AI provider
  chain; also an ASR path.
- **Data classes sent:** chat message content
  (`lib/ai-provider.js:371-372`); ASR audio
  (`lib/ai-provider.js:2046-2051`). Mapped to **E-1 / E-3** by calling
  feature.
- **Trigger & identifiers:** provider-chain selection in
  `lib/ai-provider.js`; identifiers inside payloads.
- **First-party control (code-verified):** outbound calls only; no
  deletion call held.
- **Vendor retention claim:** **NOT VERIFIED**.
- **Training/use claim:** **NOT VERIFIED**.
- **Erasure reach:** **E** — unknown; honest-cannot-reach today.
- **DPA evidence state:** **NOT VERIFIED**.
- **Downstream/transfer:** **NOT VERIFIED**.
- **Disposition design + follow-on:** honest-cannot-reach today;
  **#1182**.

### 1.7 Cerebras — model provider

- **Identity & role (asserted):** model provider in the AI provider
  chain.
- **Data classes sent:** chat message content
  (`lib/ai-provider.js:385-386`). Mapped to **E-1 / E-2 / E-3** by
  calling feature.
- **Trigger & identifiers:** provider-chain selection in
  `lib/ai-provider.js`; identifiers inside payloads.
- **First-party control (code-verified):** outbound calls only; no
  deletion call held.
- **Vendor retention claim:** **NOT VERIFIED**.
- **Training/use claim:** **NOT VERIFIED**.
- **Erasure reach:** **E** — unknown; honest-cannot-reach today.
- **DPA evidence state:** **NOT VERIFIED**.
- **Downstream/transfer:** **NOT VERIFIED**.
- **Disposition design + follow-on:** honest-cannot-reach today;
  **#1182**.

### 1.8 Deepgram — speech-to-text / text-to-speech

- **Identity & role (asserted):** speech processor (ASR and TTS).
- **Data classes sent:** candidate audio for ASR
  (`lib/ai-provider.js:1987`) — **E-3** (interview content, voice);
  text for TTS synthesis (`lib/ai-provider.js:1733`).
- **Trigger & identifiers:** ASR/TTS calls in `lib/ai-provider.js`
  (citations above); identifiers inside the submitted audio/text and
  request parameters.
- **First-party control (code-verified):** outbound calls only; no
  deletion call held.
- **Vendor retention claim:** **NOT VERIFIED**.
- **Training/use claim:** **NOT VERIFIED**.
- **Erasure reach:** **E** — unknown; honest-cannot-reach today.
- **DPA evidence state:** **NOT VERIFIED**.
- **Downstream/transfer:** **NOT VERIFIED**.
- **Disposition design + follow-on:** honest-cannot-reach today;
  **#1182**.

### 1.9 Cartesia — text-to-speech / speech-to-text

- **Identity & role (asserted):** voice processor (TTS and STT).
- **Data classes sent:** text for TTS (`services/tts-service.js:6`;
  call sites `routes/jobs.js:532`, `routes/notifications.js:824`);
  candidate audio for STT (`lib/ai-provider.js:2075-2085`) —
  **E-3** (interview content, voice). Voice-interview path:
  `services/cartesia-voice.js`; `agents/voice-interviewer/worker.mjs:35`,
  `:51`.
- **Trigger & identifiers:** TTS/STT calls at the citations above;
  identifiers inside the submitted text/audio.
- **First-party control (code-verified):** outbound calls only; no
  deletion call held.
- **Vendor retention claim:** **NOT VERIFIED**.
- **Training/use claim:** **NOT VERIFIED**.
- **Erasure reach:** **E** — unknown; honest-cannot-reach today.
- **DPA evidence state:** **NOT VERIFIED**.
- **Downstream/transfer:** **NOT VERIFIED**.
- **Disposition design + follow-on:** honest-cannot-reach today;
  **#1182**.

**Second provider stack (applies to §1.2–§1.9):**
`lib/qp-provider.js` is a second, parallel provider stack
(environment-only keys; clients at `lib/qp-provider.js:302-348`)
that hits the **same processors** as the entries above. It does not
add new processor-services; the rows above govern its traffic too,
and it is recorded once here rather than duplicated per row.

**Shared vision mechanism (applies to the vision-capable rows
above):** for frame/vision analysis, providers are not sent the image
bytes — they are sent a URL to our own HMAC decrypt-proxy,
`${FRONTEND_URL}/api/frames/<token>`, and fetch the frame themselves.
The token carries the fields {key, candidateId, exp} with a 10-minute
TTL (`lib/r2FrameStore.js:14-20`, `:169-172`). Provider-side retention
of the frames they fetch is **NOT VERIFIED** for every such provider.


### 1.10 LiveKit / SFU — live audio/video media transit

- **Identity & role (asserted):** real-time media infrastructure
  (SFU) for live interviews.
- **Data classes sent:** live audio/video media of the candidate,
  recruiter, AI interviewer, and observer transits `LIVEKIT_URL`
  — **E-3** (interview content). Whether the deployment is LiveKit
  Cloud or self-hosted is **NOT VERIFIED**. Access tokens and rooms
  are issued at `server/services/livekit.js:10`, `:33-39`,
  `:110-150`. The AI observer subscribes to candidate **AUDIO only —
  video never** (`workers/ai-observer/index.js:38-49`, `:339-416`),
  and observer transcription is self-hosted whisper only
  (`lib/observerSpeech.js:16-20`).
- **Trigger & identifiers:** room/token creation (citations above) at
  interview session start; room names and participant identities are
  the identifiers in transit.
- **First-party control (code-verified):** RoomComposite egress
  writes recordings **directly to our S3-compatible bucket**
  (`server/services/livekit.js:491-510`; recording path at
  `:535-551`); `deleteRoom` (`server/services/livekit.js:143-150`)
  is the only server-side control held. **No webhook receiver exists
  in the repo.** Recording retention on our side is held in our DB
  (`retention_expires_at`, 90-day default / 30-day post-decision,
  `server/services/livekit.js:685-688`, `:829ff`) — keep/erase
  **E-4** governs the recording objects themselves.
- **Vendor retention claim:** LiveKit-server-side media/log retention
  is **NOT VERIFIED**.
- **Training/use claim:** **NOT VERIFIED**.
- **Erasure reach:** **E** — unknown for LiveKit-server-side copies;
  our-bucket recordings are governed by §1.11–§1.13.
- **DPA evidence state:** **NOT VERIFIED**.
- **Downstream/transfer:** egress to our own bucket (citations
  above); any further downstream is **NOT VERIFIED**.
- **Disposition design + follow-on:** **expiry-by-architecture,
  CONDITIONAL on topology verification (#1182)** — the design holds
  only if media does not persist server-side beyond the session,
  which the unverified topology cannot yet establish. SFU host logs,
  where the host is first-party, fall under the first-party log
  rules in §2.

### 1.11 Cloudflare R2 — object storage (primary, per code)

- **Identity & role (asserted):** first-party object storage,
  S3-compatible.
- **Data classes sent (stored):** resumes / CVs, documents, photos,
  chat files, vision frames, interview recordings, observer audio
  (`lib/file-storage.js:39-58`) — **E-1, E-3, E-4, E-15** by object
  class. Per code, R2 is the **primary** provider
  (`lib/file-storage.js:42`).
- **Trigger & identifiers:** uploads through `lib/file-storage.js`;
  objects are keyed with a provider prefix and the key embeds the
  object path / original filename structure.
- **First-party control (code-verified):** the deletion primitive is
  **HELD and USED** by erasure (GAP-A–I) and by the retention purge:
  `DeleteObjectCommand` in `deleteFile` / `deleteStorageObject`
  (`lib/file-storage.js:~309-311`, `~352-354`). Code-carried caveat:
  with bucket versioning on, `DeleteObject` writes a delete marker
  only (`lib/file-storage.js:264-267`); bucket versioning and
  lifecycle configuration are **NOT VERIFIED**.
- **Vendor retention claim:** bucket-side retention beyond our
  deletion calls is a configuration question — **NOT VERIFIED**
  (see versioning caveat).
- **Training/use claim:** no training/use claim is made by this
  inventory; vendor-side use beyond storage is **NOT VERIFIED**.
- **Erasure reach:** **A** — API, our side (primitive built and used).
- **DPA evidence state:** **NOT VERIFIED**.
- **Downstream/transfer:** **NOT VERIFIED**.
- **Disposition design + follow-on:** **propagation — BUILT**
  (reach A, our side). The versioning caveat is carried openly: if
  versioning is on, a delete marker is not object expungement, and
  no erasure may be described as object-expunged until the bucket
  configuration is verified (#1182 carries the verification).

### 1.12 Backblaze B2 — object storage (fallback copy target)

- **Identity & role (asserted):** first-party object storage,
  S3-compatible, fallback copy target for the same object classes
  as §1.11 (`lib/file-storage.js:60-73`).
- **Data classes sent (stored):** the same classes as R2 (§1.11).
- **Trigger & identifiers:** fallback uploads through
  `lib/file-storage.js`; provider-prefixed keys as in §1.11.
- **First-party control (code-verified):** the same deletion
  primitives as §1.11 (`DeleteObjectCommand` in `deleteFile` /
  `deleteStorageObject`). The same versioning caveat
  (`lib/file-storage.js:264-267`) applies in principle; B2 bucket
  versioning/lifecycle configuration is **NOT VERIFIED**.
- **Vendor retention claim:** **NOT VERIFIED**.
- **Training/use claim:** **NOT VERIFIED**.
- **Erasure reach:** **A** — API, our side (same primitives as R2).
- **DPA evidence state:** **NOT VERIFIED**.
- **Downstream/transfer:** **NOT VERIFIED**.
- **Disposition design + follow-on:** **propagation — BUILT** (our
  side), same versioning caveat as §1.11, carried via #1182.
- **Doc/code discrepancy (recorded, not fixed here):** the header
  comment in `lib/file-storage.js:4-5` describes B2 as primary and
  R2 as fallback, while the provider order in code
  (`lib/file-storage.js:42`) makes **R2 primary**. The code governs;
  the stale comment is recorded here as a known discrepancy.

### 1.13 LiveKit egress bucket (`RECORDING_STORAGE_*`) — recording objects

- **Identity & role (asserted):** the S3-compatible bucket that
  LiveKit RoomComposite egress writes recording MP4/OGG objects to
  directly (see §1.10; `server/services/livekit.js:491-510`,
  `:535-551`).
- **Data classes sent (stored):** interview recording objects —
  **E-4**.
- **Trigger & identifiers:** egress at recording stop; objects are
  addressed by the storage path recorded for the recording.
- **First-party control (code-verified):** erasure code records this
  store as **addressability-limited**
  (`lib/erasureService.js:3445-3473`): a ledgered egress object is
  deleted in Phase 2 only when its bucket matches a configured
  file-storage provider bucket — never guessed.
- **Vendor retention claim:** **NOT VERIFIED**. Whether this bucket
  **is the same bucket** as the R2/B2 file-storage buckets (§1.11 /
  §1.12) is **NOT VERIFIED**.
- **Training/use claim:** **NOT VERIFIED**.
- **Erasure reach:** **E** — unknown, addressability-limited as
  above; it is not reach A until bucket identity is verified.
- **DPA evidence state:** **NOT VERIFIED**.
- **Downstream/transfer:** **NOT VERIFIED**.
- **Disposition design + follow-on:** own row by design — the E-4
  disposition (ledger + Phase-2 bucket-matched deletion, visible
  failure when unaddressable) stands; bucket-identity verification
  is carried by **#1182**.

### 1.14 Sentry — error / performance telemetry

- **Identity & role (asserted):** error and performance telemetry
  service (server + client).
- **Data classes sent:** error events and stack traces, transaction /
  profile telemetry, and client session-replay data. Server init at
  `server.js:17-25` sets `tracesSampleRate` 1.0 and
  `profilesSampleRate` 1.0 with **no scrubbing / `beforeSend`**
  configured; handlers at `server.js:177-180`; error handler at
  `server.js:2291-2295`. Client init at `client/src/main.tsx:1`,
  `:9-23` configures replay with `maskAllText` **FALSE**,
  `blockAllMedia` **FALSE**, `replaysOnErrorSampleRate` 1.0.
- **Trigger & identifiers:** unhandled errors and sampled
  transactions/replays; event payloads can carry request, user, and
  page context (field names only recorded here).
- **First-party control (code-verified):** the init configuration
  above is the control surface — and as configured it applies no
  scrubbing and no replay masking. The DSN is environment-only;
  `SENTRY_DSN` is absent from `render.yaml`, so **deployed
  enablement is NOT VERIFIED**. No deletion API call exists in the
  repo.
- **Vendor retention claim:** **NOT VERIFIED**.
- **Training/use claim:** **NOT VERIFIED**.
- **Erasure reach:** **E** — unknown; no in-repo deletion path.
- **DPA evidence state:** **NOT VERIFIED**.
- **Downstream/transfer:** **NOT VERIFIED**.
- **Disposition design + follow-on:** **propagation candidate +
  don't-send control** (scrubbing / masking / sampling posture),
  designed and built under **#1180**. Until #1180 lands, this entry
  must not be described as erased, scrubbed, or disabled in
  production.

### 1.15 Google Calendar — calendar events (attendees' calendars)

- **Identity & role (asserted):** calendar service; interview events
  are created on connected calendars.
- **Data classes sent:** event records carrying attendee email and
  display name, title, description, and start/end times
  (`server/services/calendar-service.js:235-241`, `:282-290`;
  OAuth scope at `server/services/calendar-service.js:18`) —
  **E-13** (scheduling records).
- **Trigger & identifiers:** event creation from the scheduling
  flow; attendee email addresses are the identifiers.
- **First-party control (code-verified):** event creation as cited.
  A Google-side event delete is **NOT line-verified** in the repo —
  recorded as **NOT VERIFIED**, not as absent.
- **Vendor retention claim:** **NOT VERIFIED**.
- **Training/use claim:** **NOT VERIFIED**.
- **Erasure reach:** **E** — unknown (delete not line-verified).
- **DPA evidence state:** **NOT VERIFIED**.
- **Downstream/transfer:** events reside on attendees' own
  calendars (asserted by the integration's shape); any further
  transfer is **NOT VERIFIED**.
- **Disposition design + follow-on:** verify the event-delete path
  and, if held, wire it as a propagation candidate under **#1182**;
  copies already accepted onto an attendee's calendar are also
  subject to the already-disclosed-data limit (§1.19).

### 1.16 Microsoft Outlook calendar — calendar events (Graph)

- **Identity & role (asserted):** calendar service (Microsoft
  Graph); interview events are created on connected calendars.
- **Data classes sent:** event records of the same classes as
  §1.15 — **E-13**.
- **Trigger & identifiers:** event creation via the calendar
  service (`server/services/calendar-service.js`); attendee email
  addresses are the identifiers.
- **First-party control (code-verified):** an event **DELETE is
  HELD** in code (`server/services/calendar-service.js:843-846`).
- **Vendor retention claim:** **NOT VERIFIED**.
- **Training/use claim:** **NOT VERIFIED**.
- **Erasure reach:** **A** — API, for events we created (delete
  primitive held, citation above). Whether erasure invokes it
  today is not claimed by this inventory.
- **DPA evidence state:** **NOT VERIFIED**.
- **Downstream/transfer:** **NOT VERIFIED**.
- **Disposition design + follow-on:** propagation candidate on a
  held primitive; wiring/verifying its invocation by erasure is
  **#1182**.

### 1.17 Stripe — company / recruiter billing

- **Identity & role (asserted):** payment / billing processor for
  company and recruiter billing.
- **Data classes sent:** billing data of the company/recruiter in
  the routes read (`routes/billing.js:77-81`, `:102-105`, `:294`).
  Candidate data was **not in scope** in those routes. Candidate-
  linked Stripe identifiers on the `users` row are governed by
  keep/erase **K-6**, not by this row.
- **Trigger & identifiers:** billing operations in
  `routes/billing.js`; company/recruiter account identifiers.
- **First-party control (code-verified):** the billing calls cited
  above. No deletion call is line-verified — recorded as
  **NOT VERIFIED**, not as absent.
- **Vendor retention claim:** **NOT VERIFIED**.
- **Training/use claim:** **NOT VERIFIED**.
- **Erasure reach:** **E** — unknown (no deletion call
  line-verified).
- **DPA evidence state:** **NOT VERIFIED**.
- **Downstream/transfer:** **NOT VERIFIED**.
- **Disposition design + follow-on:** billing records are the
  employer's own records under **K-6** (statutory-retention class,
  clock OPEN — counsel); no candidate-erasure propagation is
  designed against this row. Verification, if pursued, is #1182.

### 1.18 LinkedIn / Google OAuth — identity providers (inbound-dominant)

- **Identity & role (asserted):** sign-in / profile-import identity
  providers.
- **Data classes:** inbound-dominant — profile data imported with
  the user's own token (`routes/auth.js:1091`;
  `routes/candidate.js:5479`, `:5505-5578`) — **E-1** on our side
  once imported, where the normal first-party erasure lines govern.
- **Trigger & identifiers:** user-initiated OAuth sign-in / import;
  the user's provider account identifiers.
- **First-party control (code-verified):** the import/auth paths
  cited above; our-side copies are ordinary first-party rows.
- **Vendor retention claim:** **NOT VERIFIED** (including
  LinkedIn-side retention of the connection/profile data).
- **Training/use claim:** **NOT VERIFIED**.
- **Erasure reach:** **n/a for retention on our side** (no outbound
  candidate-data store is created by these flows in the code read);
  provider-side reach is **NOT VERIFIED**.
- **DPA evidence state:** **NOT VERIFIED**.
- **Downstream/transfer:** **NOT VERIFIED**.
- **Disposition design + follow-on:** recorded as
  n/a-for-retention; no follow-on build. Provider-side questions, if
  pursued, ride the C-P* vendor-terms track (§4).

### 1.19 Already-disclosed data — design row (no processor)

- **Identity & role:** not a processor — the class of candidate
  data already disclosed outside the platform: reports and scores a
  recruiter has exported (PDFs, emails, their own systems).
- **Data classes:** exported reports, scores, and any candidate
  data a recruiter has copied into their own systems — **E-2 /
  E-3 / E-6** content, once exported.
- **Trigger & identifiers:** recruiter export / share actions
  during ordinary use, before any erasure request.
- **First-party control (code-verified):** none over the copies
  once disclosed — that is the defining fact of this row.
- **Vendor retention claim:** n/a (no vendor); recipient-side
  retention is **NOT VERIFIED** and not verifiable by us.
- **Training/use claim:** n/a / **NOT VERIFIED**.
- **Erasure reach:** **D** — no path. **Honest-cannot-reach.**
- **DPA evidence state:** n/a.
- **Downstream/transfer:** recipient-controlled; **NOT VERIFIED**.
- **Disposition design + follow-on:** honest-cannot-reach (D), per
  keep/erase §4.3. The exposure is **over-promising, not the
  limitation**: the candidate-facing erasure confirmation must
  disclose this limit — that wording is counsel-open (B-J5, §4 of
  this inventory) and is **not drafted here**. No build follow-on.

### 1.20 Checked and NOT processors (no outbound flow)

One line each — checked in the enumeration, with no outbound
candidate-data flow found:

- **Self-hosted whisper / Piper** — on-box speech processing; no
  external processor copy is created.
- **Local virus scanner** — heuristics only, on-box; no outbound
  flow found.
- **MemU (python)** — local SQLite; **no in-repo caller found**;
  its running state is **NOT VERIFIED**.
- **Analytics census:** **no** PostHog, Mixpanel, Google Analytics,
  Amplitude, or Hotjar exists anywhere in the repo (grep: zero
  hits). There is no analytics processor to inventory.


---

## 2. Log sinks

Same field discipline as §1. **Current state and target are never
conflated:** a "target (DESIGN)" line is a design position, not
adopted policy and not the current behaviour.

### 2.1 `console.*` → stdout/stderr → Render platform logs

- **Current state (code-verified):** **no logger library exists**
  in the repo (winston / pino / morgan: grep zero hits). Logging is
  raw `console.*`: **1,918 backend call sites across 254 files,
  plus 174 client call sites** (Scout's census against
  `origin/dev` @ `b834a8ff`). Output goes to stdout/stderr and
  therefore to the Render platform log store.
- **Data classes in this sink:** whatever each call site logs —
  identifiers, file URLs, and error context are all possible
  classes (see the bounded fix in §3 and the wider sweep, #1179).
- **Retention:** `render.yaml` contains **no** log, drain, or
  retention setting. Render-side retention is **NOT VERIFIED**.
- **Target (DESIGN, not adopted policy):** ≤30 days for sinks we
  control. Adoption of any log-retention period is boundary
  **B-J6** (§4) — it is not decided by this inventory.

### 2.2 `activity_log` (DB table)

- **Current state (code-verified):** `lib/activity-logger.js:88`
  INSERTs `user_id`, `user_email`, `ip_address`, and a `details`
  object carrying {method, path, status, duration}, written via
  the request logger (`server.js:598-599`; logger at
  `server.js:509-565`). Two path redactions already exist in that
  logger — assessment referral tokens and `/api/frames/` tokens
  (`server.js:534-543`).
- **Retention:** **no time-based prune found** → retention
  **NOT VERIFIED**.
- **Disposition design + follow-on:** retention design under
  **#1181**.

### 2.3 `ai_call_log` (DB table)

- **Current state (code-verified):** `lib/ai-call-logger.js:300`
  INSERTs rows including `user_id`, provider, model, token
  counts, and `error_message`. The column list contains **no
  prompt / transcript column**.
- **Retention:** no prune found → retention **NOT VERIFIED**.
- **Disposition design + follow-on:** retention design under
  **#1181**.

### 2.4 `notification_logs` (DB table)

- **Current state (code-verified):** `logEmail` at
  `lib/email-service.js:312ff` stores the recipient email,
  subject, and the **FULL body and FULL HTML body** of each sent
  email. This is the first-party copy paired with the Brevo row
  (§1.1), and the table itself is a GAP-F-erased first-party
  table (keep/erase E-15) — retention between erasures is the
  question here.
- **Retention:** no prune found in this inventory's evidence →
  **NOT VERIFIED** as a standing retention.
- **Disposition design + follow-on:** retention design under
  **#1181**.

### 2.5 `audit_logs` + `compliance_audit_trail` (DB tables) — KEEP-side

- **Current state (code-verified):** writers at
  `services/auditLogService.js:95` and `:364`. A **policy-driven
  purge EXISTS for `audit_logs`**
  (`services/euComplianceService.js`, `executePurge` at
  `~:487-500`; policies at `:439-485`; `dryRun` defaults true;
  admin route `routes/compliance.js:1344`).
- **Disposition:** this is **KEEP-side evidence** (keep/erase
  **K-2**). Any future log-retention shortening **EXEMPTS**
  erasure-audit / compliance logs — see forward constraint (2)
  in §3. No retention change is designed against these tables in
  this inventory.

### 2.6 `auth.log` (file)

- **Current state (code-verified):** append-only file writes via
  `appendFileSync` (`routes/auth.js:26-32`). Call sites at
  `routes/auth.js:376`, `:420`, `:425`, `:448` write **fixed
  strings only** — no credential or email interpolation was found
  at those sites.
- **Retention:** no rotation configuration found → retention
  **NOT VERIFIED**.
- **Disposition design + follow-on:** rides the log-retention
  design in **#1181**; content posture is as verified above.

### 2.7 Prometheus `/metrics`

- **Current state (code-verified):** metrics module at
  `server/middleware/prometheus.js:15`, `:77-84`, exposed at
  `server.js:552-553`.
- **Data classes:** label content is **NOT VERIFIED** — this
  inventory does not claim which label values are emitted.
- **Retention:** scrape-side retention is outside the repo →
  **NOT VERIFIED**.
- **Disposition design + follow-on:** label-content verification
  rides **#1179 / #1181** design work; no claim is made here.

### 2.8 In-memory buffers (non-persistent)

- **Current state (code-verified):** an AI-provider failure
  buffer holding the last 100 failures
  (`lib/ai-provider.js:729-753`), and the activity-logger
  recent-events buffer. Both are **in-memory only,
  non-persistent** — they create no retained copy and are
  recorded here for completeness, one line each in substance.

### 2.9 Global error handler — full stack traces to stdout

- **Fact row (code-verified):** the global error handler at
  `server.js:2299` prints **full stack traces** to stdout, i.e.
  into sink §2.1. Stack context can carry the identifiers of the
  failing request; content-level treatment of log lines is
  **#1179**'s scope, not this story's.

### 2.10 Dead code fact — second Brevo implementation

- **Fact row (code-verified):** `server/services/email-service.js`
  is a second full Brevo implementation with **no live require**;
  the only in-repo characterisation of it as dead is a test
  comment (`server/__tests__/lib/gap-f-send-guard.test.js:23`).
  It is noted in this inventory (its existence matters to a
  future reader auditing email processors) and is **not fixed or
  deleted here**.

### 2.11 Fact — `getPresignedUrl` has zero callers

- **Fact row (code-verified):** `getPresignedUrl`
  (`lib/file-storage.js:224-258`) has **zero callers** in the
  repo. Recorded because a reader of `lib/file-storage.js` would
  otherwise assume a live presigned-URL flow exists alongside
  the vision decrypt-proxy mechanism (§1, shared vision note).

---

## 3. This story's bounded code fix (for the record)

`lib/file-storage.js` — exactly four call sites changed, nothing
else: the `deleteFile` warnings at lines **280, 288, 294** and the
`deleteStorageObject` warning at line **335** (line numbers against
`origin/dev` @ `b834a8ff`) interpolated the full unrouted
`fileUrl` / `objectKey` into stdout — i.e. into sink §2.1 —
including, at the unrecognized-format site, whatever a caller had
passed (signed/external URLs included). Each now logs a **reason
code only** (no provider was parsed at those sites), with **no
portion of the URL/key, no truncation, prefix, or hash of it**.
No return-value, routing, or idempotency change. Evidence:
red-first tests in
`server/__tests__/lib/gap-j-file-storage-redaction.test.js`
(4 tests: signed-URL fixture, CV-filename-bearing `/api/files/...`
URL, malformed-encoding URL, frame key) — **failing on unmodified
code, passing after the fix** (runs recorded in the PR body).
Wider log-content findings are **#1179**'s scope.

---

## 4. Forward constraints (binding on every follow-on)

1. **Legal hold before propagation.** Any future propagation build
   checks legal hold **BEFORE** propagating. Processor copies sit
   outside the erasure ledger's fail-closed count, so a propagated
   delete against a held user would silently succeed while
   first-party rows are preserved — asymmetric destruction of held
   evidence.
2. **Audit/compliance exemption.** Log-retention shortening
   exempts erasure-audit / compliance logs (§2.5, keep/erase K-2).
3. **Redaction-at-write is not remediation of history.**
   Redaction-at-write does **NOT** remediate already-written logs;
   they age out only by sink retention (itself **NOT VERIFIED**
   where marked in §2).
4. **Erasure-confirmation wording is COUNSEL-OPEN (B-J5).**
   Candidate-facing erasure-confirmation wording is counsel-open:
   the confirmation must disclose the cannot-reach classes (§1)
   and the already-disclosed-data limit (§1.19). This document
   names the required disclosures; it does **NOT** draft the
   wording.
5. **Boundary register B-J1…B-J8 is open.** The register below is
   listed as open; vendor terms are tracked as C-P* items on the
   #788 pattern — **nothing sent, no vendor contact**.

**Boundary register (open — Sumanth's consolidated brief, not
team-decided):**

| ID | Open boundary |
|----|---------------|
| B-J1 | Processor-deletion contract wording |
| B-J2 | DPA position per processor |
| B-J3 | Expiry-only reliance per class |
| B-J4 | AI-provider retention / training acceptance |
| B-J5 | Candidate-facing erasure-confirmation wording (counsel-open; no UI/email copy ships from this story) |
| B-J6 | Any new MAY-KEEP line for a log class (exact fields + linkage + clock + ruling) |
| B-J7 | Published sub-processor list |
| B-J8 | Changing / dropping a processor |

**Follow-ons (filed by Lead, for cross-reference):** #1179
log-content redaction sweep · #1180 Sentry posture · #1181 DB
log-table retention design (design-first; builds only after a
B-J6 ruling) · #1182 processor deletion-propagation builds tracker
(per-processor, gated on terms evidence + B-J1/B-J2/B-J4).

*— Nova (build) for GAP-J (#1129), on Scout's verified enumeration
(`origin/dev` @ `b834a8ff`), the privacy engineer's design, and
Lex's field set (STOP 1, #1129). Advisory inventory + design —
not a legal determination.*
