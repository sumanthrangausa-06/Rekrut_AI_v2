# Rekrut AI — AI/ML Services & Libraries Analysis
> Comprehensive analysis of the AI/ML infrastructure for the Rekrut AI platform (HireLoop v2)
> Generated: 2026-06-05

---

## 1. Executive Summary

The AI/ML layer of Rekrut AI is built on a **multi-provider fallback architecture** with automatic failover across Polsia (Anthropic/OpenAI proxy), NVIDIA NIM, and self-hosted models. The system supports **7 modalities**: LLM, Vision, TTS, ASR, Embedding, Reranking (deprecated), and Safety. A key architectural decision is the **isolation of Quick Practice** from the main Mock Interview pipeline via forked provider files (`qp-provider.js`, `qp-ai.js`), ensuring decoupled evolution.

**Core Design Patterns:**
- **Cascade Failover**: Automatic provider switching on 401/402/429/timeout errors
- **Module-Specific Routing**: Different provider chains per module (quality for interviews, efficient for onboarding, reasoning for assessments)
- **Token Budget Management**: 100K daily token cap with OpenAI, auto-routing to NIM when exhausted
- **Defensive Programming**: Extensive fallback chains, null-guard patches, safe JSON parsing with 7 repair strategies
- **Observability**: Per-call logging with cost estimation, latency tracking, and provider health metrics

---

## 2. Core AI Provider Infrastructure (`lib/`)

### 2.1 `lib/ai-provider.js` — The Multi-Provider Backbone (106KB)

**Functionality:** Comprehensive multi-provider AI system with automatic failover across **20+ NVIDIA NIM models**, Anthropic (Claude via Polsia), and OpenAI (via Polsia). Handles 7 modalities with per-module routing preferences.

**Key Classes/Functions:**
- `AIProviderService` — Main service class managing provider initialization (Anthropic, OpenAI, NVIDIA NIM, Groq, Cerebras), failure tracking with exponential backoff, active provider tracking per modality, cumulative statistics, and persisted state loading from DB.
- `chatCompletion(messages, options)` — Core LLM method with module-specific chain selection (quality/reasoning/efficient/vision/document), parallel provider racing with `Promise.any()`, automatic retry on null/empty content (3 attempts), and JSON mode support.
- `generateEmbedding(text, options)` — Embedding generation with fallback chains
- `visionChat(messages, options)` — Vision/multimodal analysis
- `textToSpeech(text, options)` — TTS with 4 NIM models (Magpie multilingual/flow/zeroshot, FastPitch)
- `speechToText(audioBuffer, options)` — ASR with Parakeet models
- `checkSafety(text, options)` — Content moderation via Nemotron safety models

**Provider Chain Types:**
| Chain | Purpose | Primary → Fallback |
|-------|---------|-------------------|
| `quality` | Best output quality | Anthropic → OpenAI → NIM |
| `efficient` | Cost-optimized | OpenAI GPT-4o-mini → NIM |
| `reasoning` | Complex reasoning | Anthropic reasoning → OpenAI reasoning → NIM |
| `vision` | Image analysis | OpenAI GPT-4o → NIM vision |
| `document` | OCR/documents | NIM Nemotron Parse → OpenAI |

**Module-Specific Routing:**
- Mock Interview: `quality` LLM + default TTS/ASR/Vision
- Assessments: `reasoning` LLM
- Job Matching: `efficient` LLM + default embedding
- Onboarding: `efficient` LLM
- Safety: `default` safety + LLM

**NIM Model Catalog (20+ models):**
- LLM: `llama-3.3-nemotron-super-49b-v1`, `llama-3.1-nemotron-70b`, `llama-3.1-nemotron-51b`, `deepseek-r1` (reasoning), `mistralai/mixtral-8x7b-instruct`, `meta/llama-3.1-8b-instruct`
- Vision: `nvidia/nemotron-nano-12b-v2-vl`, `google/gemma-3-27b-it`
- TTS: `nvidia/magpie-tts-multilingual`, `nvidia/magpie-tts-flow`, `nvidia/fastpitch-hifigan-tts`
- ASR: `nvidia/parakeet-tdt-0.6b-v2/v3`
- Embedding: `nvidia/llama-3.2-nv-embedqa-1b-v2`, `nvidia/llama-nemotron-embed-vl-1b-v2`
- Safety: `nvidia/llama-3.1-nemotron-safety-guard-8b-v3`
- Document: `nvidia/nemotron-parse`

**Dependencies:** `@anthropic-ai/sdk`, `openai`, `node-fetch`, `form-data`, `pg`

**Integration Points:** Used by `polsia-ai.js`, `qp-ai.js`, and directly by `interview-ai.js`, `matching-engine.js`, `communication-generator.js`, `job-optimizer.js`, `document-verification.js`

**Notable Patterns/Issues:**
- **Reranking models removed** (Feb 13, 2026) — both NIM reranking models return 404, commented out
- **Parallel provider racing** with `Promise.any()` — fastest provider wins, but null/empty responses can "win" and break downstream (addressed by `null-guard.js`)
- **Self-hosted audio fallback** (whisper.cpp + Piper TTS) — Layer 2 in audio chain after OpenAI
- **Deepgram fallback** (Layer 3) — requires `DEEPGRAM_API_KEY`
- **Token budget exhaustion** causes OpenAI to be skipped entirely, routing to NIM only
- **DB persistence** for stats and verification state survives server restarts

---

### 2.2 `lib/polsia-ai.js` — AI Function Wrappers (72KB)

**Functionality:** High-level AI function wrappers providing domain-specific operations (interview questions, resume parsing, skill assessment, job matching, coaching). Primary interface between business logic and the AI provider layer.

**Key Functions:**
- `chat(message, options)` — Universal chat interface with message normalization
- `generateInterviewQuestions(jobTitle, jobDescription, count)` — Generates structured interview questions with categories/difficulty
- `analyzeInterviewResponse(question, response, keyPoints)` — Analyzes candidate responses with scoring (1-10), strengths, improvements
- `generateOverallFeedback(questionResults)` — Aggregates per-question feedback into holistic assessment
- `generateInterviewCoaching(question, response, feedback)` — Provides STAR-method coaching and improved responses
- `parseResume(resumeText)` — Extracts structured resume data (contact, experience, education, skills)
- `generateSkillAssessment(skillName, skillLevel)` — Creates technical assessments with questions/answers/rubrics
- `evaluateSkillAssessment(assessment, answers)` — Evaluates assessment answers with scoring and feedback
- `generateJobMatchScore(candidate, job)` — Calculates match scores with breakdowns and explanations
- `analyzeVideoPresentation(frames, options)` — Vision analysis for video interviews (body language, eye contact, etc.)
- `safeParseJSON(text)` — 7-strategy JSON repair (markdown fences, trailing commas, control chars, smart quotes, etc.)
- `normalizeVisionResult(parsed)` — Normalizes field name variations across different vision models

**Dependencies:** `@anthropic-ai/sdk`, `openai`, `node-fetch`, `form-data`, `ai-provider.js`, `db.js`

**Integration Points:** Used by all service modules: `interview-ai.js`, `matching-engine.js`, `communication-generator.js`, `job-optimizer.js`, `document-verification.js`, `recruiter-screener.js`

**Notable Patterns/Issues:**
- **JSON repair critical**: `safeParseJSON()` with 7 repair strategies handles malformed LLM JSON — key defensive pattern
- **Vision analysis normalization**: `normalizeVisionResult()` maps field name variations (`eyeContact` → `eye_contact`, etc.) because different models use different schemas
- **Video analysis primary path**: R2 upload → GPT-4o vision → NIM vision fallback → text-based fallback from speech metrics
- All functions use `module` and `feature` tagging for routing and analytics

---

### 2.3 `lib/qp-provider.js` — Quick Practice Isolated Provider (102KB)

**Functionality:** **ISOLATED fork** of `ai-provider.js` specifically for Quick Practice. Forked on 2026-02-15 (Task #32717) to decouple Quick Practice from Mock Interview pipeline changes. Changes to main `ai-provider.js` do NOT affect Quick Practice.

**Key Differences from `ai-provider.js`:**
- Same architecture but **independent failure state**
- Same NIM model catalog and module chain preferences (but separate instance)
- **Independent token budget tracking** (via `token-budget.js` integration)

**Dependencies:** Same as `ai-provider.js`: `@anthropic-ai/sdk`, `openai`, `node-fetch`, `form-data`, `pg`

**Integration Points:** Consumed exclusively by `qp-ai.js`. **Not consumed by any other module** — this is the isolation guarantee.

**Notable Patterns/Issues:**
- **Code duplication**: 102KB of duplicated logic from `ai-provider.js` (maintenance burden)
- **Token budget integration**: Checks budget before OpenAI calls, but the budget service is shared (singleton `TokenBudgetService`)
- **Independent failure tracking**: Quick Practice can fail over to NIM even if main pipeline is using Anthropic, and vice versa

---

### 2.4 `lib/qp-ai.js` — Quick Practice AI Wrappers (46KB)

**Functionality:** High-level AI wrappers for Quick Practice, mirroring `polsia-ai.js` but using the isolated `qp-provider.js`.

**Key Functions:**
- `chat(message, options)` — Same interface as `polsia-ai.js` but routes through `qp-provider`
- `analyzeInterviewResponse(question, response, keyPoints)` — Identical to `polsia-ai.js` version
- `generateInterviewCoaching(question, response, feedback)` — Identical coaching generation
- `analyzeVideoPresentation(frames, options)` — Same vision analysis with R2 → GPT-4o → NIM fallback
- `safeParseJSON(text)` — Same 7-strategy JSON repair
- `normalizeVisionResult(parsed)` — Same field normalization

**Removed Functions (not used by Quick Practice, live in `polsia-ai.js`):**
- `generateInterviewQuestions`, `generateOverallFeedback`, `parseResume`, `generateSkillAssessment`, `evaluateSkillAssessment`, `generateJobMatchScore`

**Dependencies:** `qp-provider.js`, `token-budget.js`, `@anthropic-ai/sdk`, `openai`, `node-fetch`, `form-data`

**Integration Points:** Consumed by Quick Practice routes/controllers only. Not consumed by other core services.

**Notable Patterns/Issues:**
- Good documentation with explicit `[REMOVED]` comments marking functions not used by Quick Practice
- **Identical logic duplication**: Core functions have the same implementation as `polsia-ai.js` — intentional for isolation but creates maintenance overhead
- Budget check happens inside `qp-provider.js`, not in `qp-ai.js`

---

### 2.5 `lib/token-budget.js` — Token Budget Service (15KB)

**Functionality:** Tracks OpenAI token usage across all modalities with a daily budget (default 100K tokens). When budget is exhausted, signals the AI provider to skip OpenAI and route directly to NIM providers.

**Key Class:** `TokenBudgetService` (singleton)
- `dailyBudget`: 100K tokens (configurable via `OPENAI_DAILY_TOKEN_BUDGET`)
- `tokensUsed`: Current day's usage
- `budgetExhausted`: Boolean flag
- `modalityBreakdown`: Per-modality tracking (llm, tts, asr, vision, embedding, other)
- `providerBreakdown`: Per-provider tracking (openai, nim, other)
- `history`: Last 7 days of usage
- `exhaustedAt`: Timestamp when budget hit
- `resetAt`: Next midnight UTC reset time

**Key Methods:**
- `checkBudget()` — Returns `true` if budget exhausted, `false` if available
- `recordUsage(tokens, modality, provider)` — Records usage with debounced DB persistence (every 10 calls)
- `getStatus()` — Returns current budget status with predictions
- `getPredictions()` — Estimates when budget will exhaust based on burn rate (last 30 minutes)
- `_performReset(newDay)` — Midnight UTC reset with history archival
- `_loadFromDb()` / `_persistToDb()` — Loads/saves state from `ai_token_budget_daily` table

**Dependencies:** `pg` (PostgreSQL pool for persistence)

**Integration Points:** Used by `ai-provider.js` and `qp-provider.js` (via `checkBudget()` before OpenAI calls). Also used by `ai-call-logger.js` for cost correlation.

**Notable Patterns/Issues:**
- **Singleton pattern**: Shared across all AI provider instances (main + Quick Practice)
- **Debounced DB writes**: Every 10 calls to reduce DB load
- **Midnight UTC reset**: Automatic day rollover with 60-second polling
- **Burn rate prediction**: Calculates `burnRatePerMinute` from last 30 minutes to predict exhaustion time
- **Budget exhaustion signal**: When exhausted, OpenAI is skipped entirely in provider chains

---

### 2.6 `lib/ai-call-logger.js` — AI Call Logging (20KB)

**Functionality:** Comprehensive per-call logging for all AI operations. Tracks module, feature, modality, provider, model, tokens, latency, success/failure, cost estimate, and fallback chain. Provides real-time metrics for the admin dashboard.

**Cost Rates (per 1K tokens):**
| Provider | Input | Output |
|----------|-------|--------|
| OpenAI (GPT-4o-mini) | $0.00015 | $0.0006 |
| OpenAI Vision (GPT-4o) | $0.0025 | $0.01 |
| OpenAI TTS | $0.015 | $0 |
| OpenAI Whisper | $0.006 | $0 |
| Anthropic (Claude) | $0.003 | $0.015 |
| NIM | $0.0001 | $0.0004 |

**Key Functions:**
- `logAICall(params)` — Logs a single AI call with full metadata
- `getMetrics()` — Returns aggregated metrics for dashboard
- `getHourlyTrends()` — Returns hourly usage breakdown
- `predictBudgetExhaustion()` — Predicts when budget will run out
- `rebuildMetricsFromDb()` — Reconstructs in-memory state from DB on startup

**Dependencies:** `pg` (PostgreSQL pool)

**Integration Points:** Called by `ai-provider.js` and `qp-provider.js` after every AI call. Consumed by admin dashboard via `/api/admin/ai-metrics` endpoint.

**Notable Patterns/Issues:**
- **Cost estimation is approximate**: Uses hardcoded rates, may not match actual billing
- **NIM costs assumed very low**: $0.0001/$0.0004 per 1K — may be inaccurate for some NIM models
- **Async logging**: Non-blocking DB writes to prevent AI latency impact
- **Buffer size**: 500 calls in-memory, oldest dropped

---

### 2.7 `lib/activity-logger.js` — Centralized Event Logging (16KB)

**Functionality:** Centralized event logging for the admin activity feed. Captures ALL platform events: user actions, AI calls, auth events, system events, recruiter actions, interview events, onboarding events.

**Key Features:**
- **Categories**: user, ai, auth, system, recruiter, interview, onboarding, error
- **Severity levels**: info, warning, error
- **In-memory buffer**: Last 200 events for real-time streaming
- **DB persistence**: `activity_log` table with async writes
- **Startup loading**: Loads recent events from DB on startup

**Key Functions:**
- `logActivity(event)` — Logs an event with type, category, severity, user, details, IP
- `getRecentEvents()` — Returns in-memory buffer for real-time feed
- `getActivityStats()` — Returns aggregate statistics
- `_loadRecentFromDb()` — Loads last 200 events on startup

**Dependencies:** `pg` (PostgreSQL pool). Exports `SERVER_START_TIME` for uptime tracking in `metrics-collector.js`.

**Integration Points:** Used by all modules for event logging. Consumed by admin dashboard activity feed.

**Notable Patterns/Issues:**
- **Fail-safe**: Catches and logs DB errors without throwing
- **Non-blocking**: Async DB writes don't block request processing

---

### 2.8 `lib/distributed-rate-limiter.js` — Distributed Rate Limiting (5KB)

**Functionality:** PostgreSQL-backed rate limiting for multi-instance deployments (Render, etc.). Replaces in-memory Maps with database-backed buckets.

**Key Class:** `DistributedRateLimiter`
- `checkLimit(key, windowMs, max)` — Returns `{allowed, count, retryAfter, resetAt}`
- `cleanup()` — Removes expired buckets (5-minute grace period)
- `_initTable()` — Creates `rate_limit_buckets` table with index

**Key Features:**
- **Upsert pattern**: `INSERT ... ON CONFLICT` with conditional reset when expired
- **Fail-open**: Returns `allowed: true` if DB is down
- **Automatic cleanup**: Removes buckets expired >5 minutes ago

**Dependencies:** `pg` (PostgreSQL pool)

**Integration Points:** Used as Express middleware for API rate limiting. Replaces in-memory rate limiters for horizontal scaling.

**Notable Patterns/Issues:**
- **Fail-open design**: If DB is down, requests are allowed — security/availability tradeoff
- **No distributed locking**: The upsert pattern relies on PostgreSQL's atomicity, but concurrent requests could theoretically exceed limits slightly

---

### 2.9 `lib/email-service.js` — Transactional Email (21KB)

**Functionality:** Transactional email sending with templates, rate limiting, retry logic, and error handling. Supports Nodemailer SMTP with major providers (SendGrid, Mailgun, SES).

**Key Features:**
- **Template system**: Variable interpolation with `{{variable}}` syntax
- **Rate limiting**: Per-minute and per-hour caps with automatic throttling
- **Retry logic**: Exponential backoff with jitter
- **Email logging**: `email_log` table for delivery tracking
- **Template cache**: In-memory template storage with DB fallback

**Key Functions:**
- `initializeTransporter()` — Sets up Nodemailer with env credentials
- `sendEmail({ to, subject, template, variables })` — Sends templated email
- `sendRawEmail({ to, subject, html, text })` — Sends raw email
- `getTemplate(name)` — Loads template from cache or DB
- `checkRateLimit()` — Enforces per-minute/hour limits

**Dependencies:** `nodemailer` (SMTP transport), `pg` (PostgreSQL pool for template/log storage)

**Integration Points:** Used by `interview-ai.js` for interview reminders, `communication-generator.js` for outreach emails, and auth system for password resets/verification emails.

**Notable Patterns/Issues:**
- **Template loading**: Templates can be loaded from DB (hot-updatable) or filesystem
- **Graceful degradation**: If email fails, logs error but doesn't break core functionality

---

### 2.10 `lib/metrics-collector.js` — Infrastructure Monitoring (12KB)

**Functionality:** Comprehensive infrastructure monitoring collecting server, database, API, and user/interview session metrics.

**Key Features:**
- **Server metrics**: CPU, memory, uptime, active connections
- **Database metrics**: Pool size, query stats, slow queries, table sizes
- **API metrics**: Request counts, error rates, latency percentiles (p50, p95, p99), requests/minute
- **User metrics**: Practice sessions, mock interviews, completed/abandoned rates
- **Rolling window**: 1-hour rolling window for request metrics

**Key Classes/Functions:**
- `RequestMetrics` — Rolling window request tracking with percentile calculation
- `setHttpServer(server)` — Attaches connection tracking to HTTP server
- `getMetrics()` — Returns comprehensive metrics snapshot
- `getSystemMetrics()` — CPU, memory, uptime
- `getDatabaseMetrics()` — Pool, query stats, table sizes
- `getUserMetrics()` — Session/interview statistics

**Dependencies:** `os` (system metrics), `pg` (database metrics), `activity-logger.js` (SERVER_START_TIME)

**Integration Points:** Exposed via `/api/admin/metrics` endpoint. Consumed by admin dashboard for real-time infrastructure view.

**Notable Patterns/Issues:**
- **Per-endpoint tracking**: Tracks p50/p95/p99 latency per endpoint
- **Memory-conscious**: Prunes old entries every 100 requests, keeps last 500 durations per endpoint
- **CPU usage calculation**: Uses `os.loadavg()` / `os.cpus().length` — accurate for Linux, less so for containerized environments

---

### 2.11 `lib/null-guard.js` — Null Response Patch (4KB)

**Functionality:** **Critical defensive patch** that intercepts `ai-provider.js` module loading via `Module._load` to wrap `chatCompletion()` and detect null/empty responses. Retries up to 3 times with progressively simpler options.

**Root Cause:** Some AI providers (NIM models) return `null` content when `response_format: { type: 'json_object' }` is passed. The fastest provider to respond wins the `Promise.any()` parallel race, even with null content, causing `analyzeInterviewResponse()` and `generateInterviewCoaching()` to fail with "Content analysis failed".

**Fix Strategy:**
- **Retry 1**: Remove `response_format`, switch to different module chain (mock_interview → coaching, or onboarding)
- **Retry 2**: Minimal options (only system prompt + maxTokens)
- **Throw**: If all 3 attempts fail

**Deployment:** Preloaded via `NODE_OPTIONS=-r /opt/render/project/src/lib/null-guard.js`. Deployed Feb 15, 2026 (Task #32627).

**Dependencies:** `module` (Node.js internal for `Module._load` interception)

**Integration Points:** Patches `ai-provider.js` at module load time. Affects all calls to `chatCompletion()` system-wide.

**Notable Patterns/Issues:**
- **Monkey-patching**: Uses `Module._load` interception — fragile if module paths change
- **Global effect**: Patches ALL instances of `ai-provider.js`, including Quick Practice if it uses the same module path
- **Retry module switching**: Changes `module` option on retry to route through different provider chains
- **Hardcoded feature suffix**: Appends `_retry` to feature name for tracking

---

### 2.12 `lib/recruiter-screener.js` — Recruiter AI Screener (11KB)

**Functionality:** AI-powered candidate screening for recruiters. Leverages the same `chat()` function from `polsia-ai.js` but with screening-specific prompts.

**Key Functions:**
- `screenCandidate(candidate, job, options)` — Main screening function analyzing candidate against job requirements. Returns: fit score, fit breakdown, matched/missing skills, strengths, concerns, red flags, screening questions, interview focus areas, recommendation, estimated success probability, next steps.

**Screening Output:**
- `fit_score`: 0-100 overall match
- `recommendation`: "interview" | "reject" | "more_info" | "hold"
- `red_flags`: Array of concerns with severity, description, follow-up
- `screening_questions`: Tailored questions based on candidate profile gaps
- `estimated_success_probability`: 0-100

**Dependencies:** `polsia-ai.js` (`chat`, `safeParseJSON`), `pg` (PostgreSQL pool)

**Integration Points:** Used by recruiter dashboard for candidate screening. Consumed by candidate detail views for fit scoring.

**Notable Patterns/Issues:**
- **Reuses existing infrastructure**: Uses same `chat()` and `safeParseJSON()` as interview/coaching functions
- **Structured JSON output**: Enforces strict JSON schema with `safeParseJSON` fallback
- **No DB writes**: Pure analysis function, results computed on-demand

---

### 2.13 `lib/self-hosted-audio.js` — Self-Hosted Audio Processing (10KB)

**Functionality:** CPU-based TTS/STT requiring zero API keys. Layer 2 in the audio fallback chain: OpenAI → Self-hosted → Deepgram.

**STT**: whisper.cpp (tiny.en model, ~75MB, English-only, fastest CPU inference)
**TTS**: Piper TTS (en_US-lessac-medium voice, ~35MB, natural-sounding)

**Key Functions:**
- `initialize()` — Checks binary availability AND runtime executability (catches missing shared libs)
- `stt(audioBuffer, options)` — Speech-to-text via whisper.cpp subprocess
- `tts(text, options)` — Text-to-speech via Piper subprocess
- `runProcess(command, args, opts)` — Subprocess runner with timeout

**Binary Paths:**
- `whisper-cli`: `bin/audio/whisper-cli`
- `whisper model`: `bin/audio/models/ggml-tiny.en.bin`
- `piper`: `bin/audio/piper/piper`
- `piper model`: `bin/audio/models/en_US-lessac-medium.onnx`

**Dependencies:** `child_process` (spawn, execFileSync), `fs`, `path`, `os`, `crypto`

**Integration Points:** Used by `ai-provider.js` and `qp-provider.js` as Layer 2 audio fallback. Called when OpenAI audio fails or is unavailable.

**Notable Patterns/Issues:**
- **Runtime verification**: Checks if binaries actually execute (not just exist) — catches missing shared libraries on Render
- **Subprocess-based**: No in-process memory overhead, but slower than API calls
- **English-only**: whisper.cpp tiny.en model is English-only
- **Not automatically installed**: Binaries must be present in `bin/audio/` directory

---

### 2.14 `lib/auth.js` — JWT Authentication (5KB)

**Functionality:** JWT-based authentication with access tokens (15-minute expiry) and refresh tokens (30-day expiry with rotation and family-based revocation).

**Key Functions:**
- `generateToken(user)` — Short-lived access token (15m)
- `generateLongToken(user)` — Long-lived token (7d, backwards compatibility)
- `verifyToken(token)` — Verifies access token
- `generateRefreshToken(userId)` — Creates refresh token with family ID
- `rotateRefreshToken(refreshToken)` — Validates, rotates, and detects reuse (revokes entire family on reuse)

**Dependencies:** `jsonwebtoken` (JWT signing/verification), `crypto` (random token generation), `pg` (refresh token storage)

**Integration Points:** Used by all authenticated API routes. Refresh token rotation used by auth middleware.

**Notable Patterns/Issues:**
- **Token family revocation**: If a refresh token is reused (stolen), the entire family is revoked — good security
- **Short access tokens**: 15-minute expiry with rotation minimizes window of compromise

---

### 2.15 `lib/db.js` — PostgreSQL Connection Pool (1KB)

**Functionality:** Simple PostgreSQL connection pool with query statistics and slow query tracking.

**Key Features:**
- **Pool size**: 25 connections max
- **SSL**: `rejectUnauthorized: false` (for Render/Neon compatibility)
- **Query interception**: Wraps `pool.query()` to track total queries, slow queries (>200ms), and queries/minute
- **Statistics**: `getQueryStats()` returns `{totalQueries, slowQueries, queriesPerMinute}`

**Dependencies:** `pg` (PostgreSQL client)

**Integration Points:** Used by ALL modules (lib/ and services/). Single shared pool instance.

**Notable Patterns/Issues:**
- **SSL disabled**: `rejectUnauthorized: false` is required for some cloud providers but reduces security
- **Query tracking overhead**: Intercepting every query adds minimal overhead but provides valuable metrics

---

## 3. AI/ML Services (`services/`)

### 3.1 `services/matching-engine.js` — Job-Candidate Matching (21KB)

**Functionality:** Vector-based job-candidate matching system using PostgreSQL pgvector embeddings. Generates embeddings for candidate profiles and job descriptions, then performs cosine similarity search.

**Key Functions:**
- `generateEmbedding(text)` — Generates vector embedding via `ai-provider.js`
- `updateCandidateEmbedding(userId)` — Fetches profile, generates embedding, upserts to `candidate_embeddings`
- `updateJobEmbedding(jobId)` — Fetches job, generates embedding, upserts to `job_embeddings`
- `findMatchingCandidates(jobId, options)` — Cosine similarity search for top candidates
- `findMatchingJobs(userId, options)` — Reverse search for top jobs matching candidate
- `generateMatchExplanation(candidate, job)` — AI-generated explanation of why a match is good/bad
- `compareSkills(candidateSkills, jobRequirementsText)` — Keyword-based skill matching
- `cosineSimilarity(vecA, vecB)` — Manual cosine similarity calculation

**Database Schema:**
- `candidate_embeddings`: `user_id`, `embedding` (vector), `profile_text`, `skills_summary`, `experience_summary`
- `job_embeddings`: `job_id`, `embedding` (vector), `job_text`, `requirements_summary`

**Embedding Pipeline:**
1. Fetch candidate profile (skills, experience, education) or job details
2. Build text representation (`buildCandidateProfileText()`, `buildJobText()`)
3. Generate embedding via `ai-provider.generateEmbedding()` (NIM embedding model)
4. Upsert to DB with `toSql()` vector formatting
5. Search via `cosineSimilarity()` or `pgvector` distance operators

**Dependencies:** `ai-provider.js` (for embedding generation), `db.js` (PostgreSQL pool), `pgvector/pg` (optional, fallback to manual vector string formatting)

**Integration Points:** Used by job recommendation API routes, recruiter dashboard for candidate matching, and candidate dashboard for job recommendations.

**Notable Patterns/Issues:**
- **pgvector optional**: Has fallback to manual vector string formatting if `pgvector/pg` is not installed
- **Manual cosine similarity**: If pgvector is not available, falls back to JavaScript calculation (slower for large datasets)
- **Connection pooling**: Uses `pool.connect()` for transaction-like operations (embedding + upsert)
- **Empty profile handling**: Skips embedding generation if profile text is empty
- **No embedding cache**: Regenerates embeddings on every profile/job update — could be expensive

---

### 3.2 `services/interview-ai.js` — Interview AI Service (19KB)

**Functionality:** Smart scheduling, AI screening evaluation, and multi-agent scoring for interviews. Combines calendar logic with AI-powered screening and evaluation.

**Key Sections:**

**Smart Scheduling:**
- `suggestSlots(recruiterId, candidateTimezone, options)` — Suggests optimal interview slots based on recruiter preferences and candidate availability
- `createReminders(interviewId, candidateId, recruiterId, scheduledAt)` — Creates 1-day and 1-hour reminders
- `suggestRescheduleSlots(interviewId)` — Suggests alternative slots for rescheduling

**Screening Templates & Sessions:**
- `generateScreeningQuestions(jobTitle, jobDescription, options)` — AI-generated screening questions (6-8 questions, mixed types: behavioral, technical, situational, competency)
- `generateScreeningReport(session)` — Structured evaluation report from screening responses

**Multi-Agent Evaluation:**
- `runMultiEvaluation(candidateId, jobId, companyId, context)` — Runs 3 independent AI evaluators + synthesis
- `evaluateWithSingleAI(context)` — Single AI evaluator (fallback)
- `generateSingleEvaluationReport(context)` — Basic report generation
- `storeEvaluationReport(report)` — Persists evaluation to DB

**Evaluation Report Structure:**
- `question_scores`: Per-question score + feedback
- `communication_clarity`: Score + assessment
- `technical_depth`: Score + assessment
- `confidence_enthusiasm`: Score + indicators
- `red_flags`: Inconsistencies, evasiveness, concerns
- `strengths`: Top 3-5 strengths
- `overall_score`: 0-100
- `recommendation`: "advance" | "consider" | "decline"

**Dependencies:** `ai-provider.js` (for question generation and report evaluation), `omniscore.js` (for candidate scoring integration), `db.js` (PostgreSQL pool)

**Integration Points:** Used by interview scheduling API routes, screening session API routes, and evaluation report API routes.

**Notable Patterns/Issues:**
- **AI question generation fallback**: If AI fails, returns 6 hardcoded fallback questions
- **AI report generation fallback**: If AI fails, returns basic report based on completion rate and response length
- **Multi-agent evaluation**: 3 independent evaluators + synthesis — but `runMultiEvaluation` is stubbed/partial in the read content
- **Reminder creation**: Only creates future reminders (checks if reminder time > now)
- **Timezone handling**: Hardcoded "America/New_York" in some places — may need dynamic timezone

---

### 3.3 `services/omniscore.js` — Candidate Credit Score (11KB)

**Functionality:** Candidate credit score calculation (300-850 scale, FICO-style) based on interview performance, technical assessments, resume quality, and platform behavior.

**Score Ranges:**
| Tier | Range | Label |
|------|-------|-------|
| Exceptional | 800-850 | Exceptional |
| Excellent | 740-799 | Excellent |
| Good | 670-739 | Good |
| Fair | 580-669 | Fair |
| Needs Work | 300-579 | Needs Work |

**Score Components (weights):**
| Component | Max Points | Weight | Description |
|-----------|-----------|--------|-------------|
| Interview | 200 | 0.24 | Interview performance (max 5 interviews × 40 pts) |
| Technical | 200 | 0.24 | Skill assessments (max 5 assessments × 40 pts) |
| Resume | 200 | 0.24 | Resume quality score |
| Behavior | 100 | 0.12 | Platform activity (logins, practice, profile completion) |

**Key Functions:**
- `getOrCreateScore(userId)` — Gets or creates score entry for user
- `calculateScore(userId)` — Calculates total score from components with time decay
- `addInterviewComponent(userId, interviewId, score)` — Adds interview score component
- `addTechnicalComponent(userId, assessmentId, score)` — Adds assessment score component
- `addResumeComponent(userId, score)` — Adds resume score component (upserts — only keeps latest)
- `addBehaviorComponent(userId, reason, points)` — Adds behavior score component
- `getScoreBreakdown(userId)` — Returns detailed score breakdown with history
- `generateRecommendations(scores)` — Generates improvement recommendations
- `updateRoleScore(userId, roleName, interviewScore)` — Updates role-specific score
- `getRoleScores(userId)` — Returns role-specific scores

**Time Decay:** Components decay over time using `POWER(decay_rate, days/30)`. Default decay rate: 0.95 (5% per month).

**Database Schema:**
- `omniscore_results`: `user_id`, `overall_score`, `technical_score`, `behavioral_score`, `experience_score`, `score_tier`, `last_updated`
- `score_components`: `user_id`, `component_type`, `source_type`, `source_id`, `points`, `max_points`, `created_at`
- `score_history`: `user_id`, `previous_score`, `new_score`, `change_amount`, `change_reason`, `component_type`, `created_at`
- `role_scores`: `user_id`, `role_name`, `score`, `interview_count`, `last_updated`

**Dependencies:** `db.js` (PostgreSQL pool)

**Integration Points:** Used by `interview-ai.js` for scoring integration, `recruiter-screener.js` for candidate fit analysis, candidate dashboard for score display, and profile pages for recommendations.

**Notable Patterns/Issues:**
- **FICO-style scale**: Familiar 300-850 range makes scores intuitive
- **Time decay**: Older components lose weight, encouraging continued engagement
- **Component caps**: Maximum 5 interviews and 5 assessments (prevents gaming)
- **Resume upsert**: Only keeps latest resume score (overwrites previous)
- **Role-specific scores**: Separate scoring per role allows targeted improvement
- **Recommendation engine**: Generates actionable tips based on weak areas

---

### 3.4 `services/communication-generator.js` — AI Communication Generator (17KB)

**Functionality:** AI-powered drafting of recruiter communications: outreach, follow-ups, rejections, and offer letters. Uses `polsia-ai.js` for all generation.

**Key Functions:**
- `generateOutreach({ candidate, job, tone, companyName, recruiterName })` — Personalized candidate outreach
- `generateFollowUp({ candidate, job, previousComms, daysSinceLastContact, tone })` — Follow-up messages with new value angles
- `generateRejection({ candidate, job, reason, feedback, tone })` — Professional rejection with relationship maintenance
- `generateOfferLetter({ candidate, job, salary, startDate, companyName })` — Formal offer letter
- `generateInterviewInvite({ candidate, job, slots, companyName })` — Interview invitation with scheduling
- `generateOnboardingMessage({ candidate, job, startDate, companyName })` — Welcome/onboarding message

**Tone Options:** Outreach (professional, casual, enthusiastic), Follow-up (friendly, urgent, value-add), Rejection (empathetic, direct, encouraging), Offer (formal, warm, exciting)

**Output Format:** All functions return JSON with `subject`, `body`, `personalization_notes`, `confidence_score` (1-10), and `strategy` (for follow-ups).

**Dependencies:** `polsia-ai.js` (`chat`, `safeParseJSON`), `db.js` (PostgreSQL pool)

**Integration Points:** Used by recruiter communication API routes, automated outreach workflows, and offer management system.

**Notable Patterns/Issues:**
- **Context-aware**: References specific candidate details (skills, experience, achievements)
- **Tone variety**: Multiple tones for different relationship stages
- **JSON enforcement**: All outputs must be valid JSON with `safeParseJSON` fallback
- **Word count targets**: Enforces specific length ranges (150-250 words for outreach, 80-120 for follow-ups)

---

### 3.5 `services/job-optimizer.js` — Job Description Optimizer (16KB)

**Functionality:** AI-powered job description analysis and optimization. Analyzes job postings for authenticity, completeness, and clarity, then generates optimized versions.

**Key Functions:**
- `analyzeJobPosting(jobData)` — Returns authenticity, completeness, clarity, and overall scores with issues/flags
- `optimizeJobDescription(jobData, targetAudience)` — Generates optimized title, description, requirements, and keywords
- `generateSalaryAssessment(jobTitle, location, salaryRange)` — Assesses salary competitiveness
- `extractKeywords(jobDescription)` — Extracts searchable keywords

**Analysis Scores:** `authenticity_score` (0-100), `completeness_score` (0-100), `clarity_score` (0-100), `overall_score` (weighted average), `salary_assessment` (appropriate | low | high | missing), `red_flags` (potential concerns)

**Optimization Output:** `optimized_title`, `optimized_description` (3-4 paragraphs), `optimized_requirements`, `suggested_salary_range`, `key_selling_points` (3-5), `keywords`, `preview_snippet` (2 sentences)

**Dependencies:** `polsia-ai.js` (`chat`), `db.js` (PostgreSQL pool)

**Integration Points:** Used by job posting creation/editing routes and recruiter dashboard for job quality feedback.

**Notable Patterns/Issues:**
- **JSON parsing fallback**: If JSON parse fails, extracts JSON block with regex and falls back to default scores
- **Target audience customization**: General, technical, executive, entry-level audiences
- **Salary assessment**: Based on title/location market data (AI-estimated, not real-time)

---

### 3.6 `services/document-verification.js` — Document Verification (16KB)

**Functionality:** Handles OCR, fraud detection, authenticity scoring, and consistency checks for uploaded documents (resumes, certificates, IDs, employment letters).

**Key Functions:**
- `processDocumentOCR(fileUrl, documentType)` — Extracts text and structured data via GPT-4o vision
- `calculateAuthenticityScore(extractedData, documentType, fileUrl)` — Analyzes document for tampering/forgery signs
- `verifyDocumentConsistency(documentData, candidateProfile)` — Cross-checks document data against candidate profile
- `verifyEmploymentHistory(experience, documents)` — Verifies employment claims against uploaded letters
- `verifyEducationCredentials(education, documents)` — Verifies education claims against certificates

**Document Types:** `resume` (authenticity_weight: 0.7), `education_certificate` (1.0), `employment_letter` (0.9), `id_document` (1.0), `certification` (0.85). Each has configurable required fields.

**Dependencies:** `openai` (direct GPT-4o for vision OCR), `crypto` (hashing for tamper detection), `db.js` (PostgreSQL pool)

**Integration Points:** Used by document upload API routes, candidate verification workflows, and recruiter document review dashboard.

**Notable Patterns/Issues:**
- **Direct OpenAI usage**: Uses direct OpenAI client (not `ai-provider.js`) for GPT-4o vision — bypasses failover cascade
- **Document type configs**: Configurable required fields and authenticity weights per document type
- **Fraud detection**: GPT-4o analyzes for tampering signs (fonts, alignment, metadata)
- **Consistency checking**: Cross-references document data against profile data for discrepancies

---

### 3.7 `services/trustscore.js` — Employer Trust Score (11KB)

**Functionality:** Employer credit score calculation (0-1000 scale) for candidate protection. Scores companies based on verification, job authenticity, hiring practices, and candidate feedback.

**Score Components (0-1000 scale):**
| Component | Max | Weight | Description |
|-----------|-----|--------|-------------|
| Verification | 200 | 0.20 | Email domain, LinkedIn, website confirmation |
| Job Authenticity | 250 | 0.25 | Complete descriptions, realistic salaries, clear requirements |
| Hiring Ratio | 250 | 0.25 | Interview-to-offer ratio |
| Feedback | 200 | 0.20 | Candidate ratings from interviews |
| Behavior | 100 | 0.10 | Response times, profile completeness, activity |

**Key Functions:**
- `getOrCreateTrustScore(companyId)` — Gets or creates score entry
- `calculateTrustScore(companyId)` — Calculates total score from components with time decay
- `addVerificationComponent(companyId, points)` — Adds verification points
- `addJobAuthenticityComponent(companyId, points)` — Adds job quality points
- `addHiringRatioComponent(companyId, interviews, offers)` — Adds ratio-based points
- `addFeedbackComponent(companyId, rating)` — Adds candidate feedback points
- `addBehaviorComponent(companyId, points)` — Adds platform behavior points

**Time Decay:** Same formula as OmniScore: `POWER(decay_rate, days/30)`. Default decay rate: 0.95.

**Dependencies:** `db.js` (PostgreSQL pool)

**Integration Points:** Used by company profile pages, job listings for trust badges, and candidate decision-making UI.

**Notable Patterns/Issues:**
- **Mirrors OmniScore architecture**: Same component-based design with time decay
- **Candidate protection**: Lower scores warn candidates about potentially problematic employers
- **Hiring ratio component**: Rewards companies that make offers (not just collect interviews)
- **Feedback component**: Candidates rate interview experience — affects employer score

---

### 3.8 `services/memory-service.js` — AI Memory Service (6KB)

**Functionality:** MemGPT-style AI memory system storing and retrieving AI-extracted insights per user across all sessions. Enables personalized AI interactions based on historical observations.

**Memory Types:** `observation` ("User prefers remote roles"), `preference` ("Likes fintech companies"), `behavior` ("Always applies within 24hrs"), `skill_insight` ("Strong in React, learning Go"), `career_goal` ("Wants to transition to management"), `interaction` ("Applied to 3 jobs at TechCorp"), `recruiter_pattern` ("Typically hires 5+ years exp")

**Key Functions:**
- `addMemory(userId, { type, key, value, source, confidence })` — Adds or updates memory (upsert on `user_id, memory_key` with `GREATEST(old_confidence, new_confidence)`)
- `getMemories(userId, { type, limit })` — Retrieves memories with access count tracking
- `buildMemoryContext(userId)` — Builds memory context string for AI prompts
- `getMemoryInsights(userId)` — Returns aggregated insights by type
- `consolidateMemories(userId)` — Merges related memories and removes stale entries

**Database Schema:** `user_memory`: `user_id`, `memory_type`, `memory_key`, `memory_value`, `source`, `confidence`, `access_count`, `last_accessed`, `created_at`, `updated_at`

**Dependencies:** `db.js` (PostgreSQL pool)

**Integration Points:** Used by AI prompt construction for personalized responses, candidate profile enrichment, and recruiter pattern detection.

**Notable Patterns/Issues:**
- **Upsert with confidence update**: `GREATEST(old_confidence, new_confidence)` — highest confidence wins
- **Access count tracking**: Memories are ranked by confidence and access frequency
- **Context building**: `buildMemoryContext()` formats memories as structured prompt context
- **Consolidation**: Merges similar memories and removes low-confidence old entries

---

### 3.9 `services/biasDetection.js` — Bias Detection (7KB)

**Functionality:** Analyzes demographic parity across OmniScore results to identify biased patterns in scoring.

**Key Functions:**
- `analyzeDemographicParity()` — Checks score distribution across gender, ethnicity, age groups
- `calculateDisparity(rows, groupField)` — Calculates disparity metrics for a demographic category
- `detectBiasPatterns()` — Identifies specific biased patterns (score gaps, skewed distributions)
- `generateBiasReport()` — Generates comprehensive bias report with recommendations

**Disparity Metrics:** `max_avg_score` / `min_avg_score` (highest/lowest group averages), `score_stddev` (standard deviation within groups), `flaggedPatterns` (significant gaps >10 points between groups)

**Dependencies:** `db.js` (PostgreSQL pool)

**Integration Points:** Used by admin dashboard for compliance monitoring and audit reports for fairness certification.

**Notable Patterns/Issues:**
- **Demographic data required**: Depends on candidates providing optional demographic data (gender, ethnicity, age)
- **10-point gap threshold**: Flags gaps >10 points as potentially biased
- **Statistical analysis**: Uses `PERCENTILE_CONT`, `STDDEV`, `AVG` for robust analysis

---

### 3.10 `services/scoreExplainer.js` — Score Explainability (11KB)

**Functionality:** Provides transparent, human-readable explanations for OmniScore and assessment results. Enables candidates to understand their scores and how to improve.

**Key Functions:**
- `explainOmniScore(userId)` — Generates detailed score breakdown with component history
- `explainAssessmentScore(assessmentId)` — Explains assessment score with question-level feedback
- `generateImprovementPlan(scoreBreakdown)` — Creates actionable improvement plan
- `getScoreTrends(userId)` — Returns score history trends

**Explanation Structure:** `overall_score` (with tier label), `score_breakdown` (Technical 40%, Behavioral 30%, Experience 30%), `recent_changes` (last 10 changes with reasons), `strengths` (top 3-5), `improvement_areas` (with specific recommendations), `peer_comparison` (percentile ranking), `next_milestones` (score targets and how to reach them)

**Dependencies:** `db.js` (PostgreSQL pool)

**Integration Points:** Used by candidate dashboard score detail view and score improvement recommendations.

**Notable Patterns/Issues:**
- **Transparency focus**: Detailed component breakdown with source, points, weight, date
- **Actionable recommendations**: Each improvement area has specific actions and potential gain estimates
- **Milestone tracking**: Shows next score targets and progress paths

---

### 3.11 `services/autofill-service.js` — Auto-Fill Service (8KB)

**Functionality:** "Fill it once, use it everywhere" — Pulls stored data from profile, previous applications, and screening answers to pre-populate forms.

**Key Functions:**
- `getCandidateAutoFill(userId)` — Returns all known candidate data for form pre-population
- `getRecruiterAutoFill(userId)` — Returns recruiter data for job posting forms
- `calculateCompleteness(profile, skills, experience, education)` — Calculates profile completeness percentage
- `suggestMissingFields(userId)` — Identifies missing profile fields

**Data Sources:** Profile (name, email, phone, location, headline, bio, links, salary, availability), Experience (last 5 roles), Skills (all with levels/categories), Education (last 3 degrees), Screening answers (with reuse counts), Recent applications (cover letters, resume URLs, job patterns)

**Dependencies:** `db.js` (PostgreSQL pool)

**Integration Points:** Used by job application forms for pre-population, profile editing for completeness tracking, and recruiter job posting for template loading.

**Notable Patterns/Issues:**
- **Completeness scoring**: Calculates percentage based on filled fields (not all fields weighted equally)
- **Screening answer reuse**: Tracks how many times an answer has been reused across applications
- **Pattern detection**: Recent applications show job patterns (company types, role preferences)

---

### 3.12 `services/payroll-calculator.js` — Payroll Calculator (9KB)

**Functionality:** Handles salary calculations, tax withholding, and paycheck generation. US-focused with 2026 federal tax brackets.

**Key Functions:**
- `calculateGrossPay(config, hoursWorked)` — Calculates gross pay from salary/hourly config
- `calculateFederalTax(grossPay, filingStatus, allowances)` — Federal income tax withholding
- `calculateStateTax(grossPay, state)` — State income tax (simplified: CA=5%, NY=4.5%, TX=0%, FL=0%, others default 4%)
- `calculateSocialSecurity(grossPay, ytdGross)` — Social Security tax with wage base limit ($168,600 for 2026)
- `calculateMedicare(grossPay, ytdGross)` — Medicare tax with additional 0.9% over $200k
- `calculatePaycheck(config)` — Full paycheck calculation with all deductions
- `generatePaystub(config, payDate)` — Generates paystub with breakdown

**2026 Federal Tax Brackets (Single):** $0-11,600 (10%), $11,600-47,150 (12%), $47,150-100,525 (22%), $100,525-191,950 (24%), $191,950-243,725 (32%), $243,725-609,350 (35%), $609,350+ (37%). Standard deduction: $14,600 single / $29,200 married.

**Dependencies:** None (pure calculation, no external dependencies)

**Integration Points:** Used by offer management for salary calculations and payroll dashboard for paycheck generation.

**Notable Patterns/Issues:**
- **US-only**: Hardcoded US federal and state tax brackets
- **Simplified state taxes**: Only 5 states defined, others default to 4%
- **No local tax**: Does not handle city/county taxes
- **Social Security wage base**: $168,600 (2026 limit)

---

### 3.13 `services/auditLogger.js` — Audit Logger (4KB)

**Functionality:** Tracks all AI decisions, recruiter actions, and compliance-relevant events for audit trails.

**Key Functions:**
- `log({ actionType, userId, targetType, targetId, metadata, req })` — Logs an action
- `query({ userId, actionType, targetType, startDate, endDate, limit, offset })` — Queries logs with filters
- `exportLogs({ startDate, endDate, format })` — Exports logs for compliance reporting (JSON/CSV)
- `middleware()` — Express middleware for automatic audit logging

**Database Schema:** `audit_logs`: `action_type`, `user_id`, `target_type`, `target_id`, `metadata`, `ip_address`, `user_agent`, `created_at`

**Dependencies:** `db.js` (PostgreSQL pool)

**Integration Points:** Used by all AI decision endpoints for compliance logging, admin dashboard for audit trail viewing, and compliance reporting for exports.

**Notable Patterns/Issues:**
- **Fail-safe**: Catches errors without breaking core functionality
- **IP/user-agent tracking**: Captures request metadata for compliance
- **Flexible querying**: Supports filtering by user, action type, target type, date range
- **CSV export**: Converts JSON metadata to CSV format for compliance reports

---

### 3.14 `services/country-config.js` — Country Configuration (12KB)

**Functionality:** Country-specific configuration for hiring compliance, tax rules, and localization. Supports 20+ countries with region-specific settings.

**Key Features:** Tax configurations, compliance requirements (required documents, background checks, notice periods), currency formatting, date formats, language support, holiday calendars.

**Key Functions:**
- `getCountryConfig(countryCode)` — Returns full country configuration
- `getTaxConfig(countryCode)` — Returns tax-specific configuration
- `getComplianceRequirements(countryCode)` — Returns required hiring documents
- `getHolidays(countryCode, year)` — Returns public holidays for scheduling
- `formatCurrency(amount, currency, locale)` — Locale-aware currency formatting

**Supported Countries:** US, CA, UK, DE, FR, ES, IT, NL, AU, JP, SG, IN, BR, MX, AE, SA, KR, CN, SE, CH, IE, PL, CZ, RO, HU, BG, HR, SI, SK, LT, LV, EE, MT, CY, LU, IS, LI, NO, TR, RU, UA, BY, MD, GE, AM, AZ, KZ, UZ, KG, TJ, TM, AF, PK, BD, LK, MM, TH, VN, PH, ID, MY, BN, KH, LA, MN, KP, KR, JP, TW, HK, MO, and many more.

**Dependencies:** None (pure data, no external dependencies)

**Integration Points:** Used by job posting forms for compliance requirements, payroll calculations for tax rules, and scheduling for holiday awareness.

**Notable Patterns/Issues:**
- **Hardcoded configurations**: Country data is static, not dynamically updated
- **Tax rules simplified**: May not cover all edge cases for complex tax jurisdictions
- **Holiday calendars**: Static lists, may not account for regional variations within countries

---

## 4. Architecture Overview

### 4.1 Dependency Graph

```
┌─────────────────────────────────────────────────────────────┐
│                        API Routes                            │
└────────────────────┬────────────────────────────────────────┘
                     │
    ┌────────────────┼────────────────┐
    │                │                │
┌───▼────┐    ┌─────▼──────┐   ┌───▼────────┐
│polsia  │    │   qp-ai    │   │  interview │
│-ai.js  │    │  (isolated)│   │    -ai.js  │
└───┬────┘    └─────┬──────┘   └─────┬──────┘
    │               │                  │
┌───▼────┐    ┌─────▼──────┐   ┌──────▼─────┐
│ai-     │    │  qp-       │   │  matching  │
│provider│    │ provider   │   │  -engine   │
│(main)  │    │ (isolated) │   │            │
└───┬────┘    └─────┬──────┘   └──────┬─────┘
    │               │                  │
    └───────────────┼──────────────────┘
                    │
            ┌───────▼────────┐
            │  token-budget  │
            │   (singleton)  │
            └───────┬────────┘
                    │
    ┌───────────────┼───────────────┐
    │               │               │
┌───▼────┐    ┌─────▼──────┐   ┌───▼────────┐
│ai-call │    │  activity  │   │   db.js    │
│-logger │    │  -logger   │   │  (shared)  │
└────────┘    └────────────┘   └────────────┘
```

### 4.2 Key Architectural Decisions

1. **Multi-provider fallback**: Primary (Anthropic/OpenAI) → NIM → Self-hosted → Error. Ensures high availability even if major providers fail.

2. **Quick Practice isolation**: Forked `qp-provider.js` and `qp-ai.js` from main pipeline to prevent Quick Practice changes from affecting Mock Interview stability. Trade-off: 150KB of code duplication.

3. **Token budget management**: Shared singleton `TokenBudgetService` tracks OpenAI usage across all modalities. When budget exhausted (100K tokens/day), auto-routes to NIM only.

4. **Defensive JSON parsing**: `safeParseJSON()` with 7 repair strategies handles malformed LLM JSON. Critical for production reliability.

5. **Null-guard patch**: Monkey-patches `ai-provider.js` at module load time to detect and retry null/empty responses. Deployed as preloaded module via `NODE_OPTIONS`.

6. **Embedding-based matching**: Uses PostgreSQL pgvector for cosine similarity search. Fallback to manual JavaScript calculation if pgvector unavailable.

7. **FICO-style scoring**: OmniScore (300-850) and TrustScore (0-1000) use familiar credit score metaphors for intuitive user understanding.

8. **Time decay**: Both scoring systems use 5% monthly decay to encourage continued engagement and prevent gaming.

### 4.3 Notable Issues & Technical Debt

| Issue | Severity | Description |
|-------|----------|-------------|
| Code duplication (qp-*) | Medium | 150KB duplicated between main and Quick Practice pipelines |
| Monkey-patching (null-guard) | Medium | `Module._load` interception is fragile if module paths change |
| Direct OpenAI usage (document-verification) | Low | Bypasses failover cascade for GPT-4o vision OCR |
| Hardcoded timezone (interview-ai) | Low | "America/New_York" hardcoded in some places |
| US-only payroll | Low | Tax calculations only support US federal/state brackets |
| SSL disabled (db.js) | Low | `rejectUnauthorized: false` for cloud provider compatibility |
| Reranking models dead | Low | NIM reranking models removed Feb 13, 2026 (404) |
| NIM cost estimates | Low | Hardcoded $0.0001/$0.0004 per 1K may be inaccurate |
| pgvector optional | Low | Falls back to manual JS calculation if not installed |
| Self-hosted audio not auto-installed | Low | Binaries must be manually present in `bin/audio/` |

---

## 5. Environment Variables

### 5.1 AI Provider Configuration

| Variable | Purpose | Used By |
|----------|---------|---------|
| `NIM_VISION_FALLBACK_MODEL` | Vision fallback model | `ai-provider.js`, `qp-provider.js` |
| `NIM_VISION_GEMMA` | Gemma vision model | `ai-provider.js`, `qp-provider.js` |
| `NIM_ASR_MODEL` | ASR model | `ai-provider.js`, `qp-provider.js` |
| `NIM_ASR_V3` | ASR v3 model | `ai-provider.js`, `qp-provider.js` |
| `NIM_EMBED_MODEL` | Embedding model | `ai-provider.js`, `qp-provider.js` |
| `NIM_EMBED_VL` | Vision embedding model | `ai-provider.js`, `qp-provider.js` |
| `NIM_SAFETY_MODEL` | Safety model | `ai-provider.js`, `qp-provider.js` |
| `NIM_SAFETY_REASONING` | Safety reasoning model | `ai-provider.js`, `qp-provider.js` |
| `NIM_DOCUMENT_MODEL` | Document OCR model | `ai-provider.js`, `qp-provider.js` |
| `NIM_MAGPIE_MULTI_BASE_URL` | Magpie TTS base URL | `ai-provider.js`, `qp-provider.js` |
| `OPENAI_BASE_URL` | OpenAI API base URL | `document-verification.js`, `polsia-ai.js` |
| `OPENAI_API_KEY` | OpenAI API key | `document-verification.js`, `polsia-ai.js`, `ai-provider.js` |
| `OPENAI_DAILY_TOKEN_BUDGET` | Token budget (default 100K) | `token-budget.js` |
| `DEEPGRAM_API_KEY` | Deepgram ASR fallback | `ai-provider.js`, `qp-provider.js` |
| `JWT_SECRET` | JWT signing secret | `auth.js` |
| `DATABASE_URL` | PostgreSQL connection string | `db.js` |

---

## 6. Database Schema Summary

### 6.1 Core AI Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `candidate_embeddings` | Vector embeddings for candidates | `user_id`, `embedding` (vector), `profile_text`, `skills_summary`, `experience_summary` |
| `job_embeddings` | Vector embeddings for jobs | `job_id`, `embedding` (vector), `job_text`, `requirements_summary` |
| `omniscore_results` | Candidate scores | `user_id`, `overall_score`, `technical_score`, `behavioral_score`, `experience_score`, `score_tier`, `last_updated` |
| `score_components` | Score component details | `user_id`, `component_type`, `source_type`, `source_id`, `points`, `max_points`, `created_at` |
| `score_history` | Score change history | `user_id`, `previous_score`, `new_score`, `change_amount`, `change_reason`, `component_type`, `created_at` |
| `role_scores` | Role-specific scores | `user_id`, `role_name`, `score`, `interview_count`, `last_updated` |
| `trust_scores` | Employer trust scores | `company_id`, `overall_score`, `verification_score`, `authenticity_score`, `hiring_ratio_score`, `feedback_score`, `behavior_score`, `last_updated` |
| `user_memory` | AI memory insights | `user_id`, `memory_type`, `memory_key`, `memory_value`, `source`, `confidence`, `access_count`, `last_accessed`, `created_at`, `updated_at` |
| `ai_call_log` | AI operation logs | `module`, `feature`, `modality`, `provider`, `model`, `tokens`, `latency_ms`, `success`, `cost_estimate`, `fallback_chain`, `created_at` |
| `ai_token_budget_daily` | Token budget state | `date`, `tokens_used`, `budget_exhausted`, `modality_breakdown`, `provider_breakdown`, `exhausted_at`, `reset_at` |
| `activity_log` | Platform events | `event_type`, `category`, `severity`, `user_id`, `details`, `ip_address`, `created_at` |
| `audit_logs` | Compliance audit trail | `action_type`, `user_id`, `target_type`, `target_id`, `metadata`, `ip_address`, `user_agent`, `created_at` |
| `email_log` | Email delivery tracking | `recipient`, `subject`, `template`, `status`, `error`, `created_at` |
| `rate_limit_buckets` | Rate limiting state | `key`, `count`, `window_start`, `reset_at` |

---

## 7. Conclusion

The Rekrut AI AI/ML infrastructure is a **production-ready, multi-provider system** with robust fallback mechanisms, comprehensive observability, and defensive programming patterns. The architecture prioritizes **availability** (cascade failover), **cost control** (token budget management), and **transparency** (FICO-style scoring, audit trails, bias detection).

**Key Strengths:**
- Multi-provider failover ensures high availability
- Token budget management prevents runaway costs
- Comprehensive logging and metrics for observability
- FICO-style scoring makes AI decisions intuitive for users
- Bias detection and audit trails for compliance

**Key Areas for Improvement:**
- Consolidate Quick Practice and main pipelines to reduce code duplication
- Replace monkey-patching with a cleaner null-handling approach in `ai-provider.js`
- Add dynamic timezone support for interview scheduling
- Expand payroll support beyond US tax brackets
- Consider caching embeddings to reduce regeneration costs
- Implement automated binary installation for self-hosted audio

---

*Analysis generated by Suga (Kimi Claw) for Rekrut AI CTO review.*
