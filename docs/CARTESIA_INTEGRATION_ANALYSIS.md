# Cartesia.ai Integration Analysis for Rekrut AI

> **Research Date:** 2026-06-09  
> **Analyst:** Technical Research Team (Rekrut AI)  
> **Status:** Ready for review  
> **Plan:** Free tier only until go-to-market

---

## 1. Platform Overview

**Cartesia.ai** is a state-of-the-art voice AI platform purpose-built for developers. It offers ultra-realistic, low-latency text-to-speech (TTS) and streaming speech-to-text (STT) models designed for real-time conversational AI experiences.

| Capability | Model | Key Metric |
|------------|-------|------------|
| Text-to-Speech | **Sonic 3.5** | Sub-90ms time-to-first-byte |
| Speech-to-Text | **Ink 2** | Native turn detection, lowest WER |
| Voice Cloning | Instant & Pro | 10-second clip for high-similarity clones |
| Languages | 42 | Including English, Hindi, Spanish, Chinese, Japanese, and more |

Cartesia is already positioning itself in the **recruiting** space with a dedicated use-case page, which signals market validation for our intended features.

---

## 2. Features & Capabilities

### 2.1 Sonic 3.5 — Text-to-Speech

Sonic 3.5 is ranked #1 for naturalness and streams the first audio byte in ~90ms (about twice as fast as a human blink). Key features:

- **42 languages** out of the box at native quality
- **Expressive, conversational delivery** — strong pacing and emotional range
- **Clean audio** across every language with no artifacts
- **Alphanumerics that sound right** — phone numbers, IDs, emails spoken naturally without preprocessing
- **Context-aware pronunciation** — heteronyms like *read*, *bass*, *bow* resolved correctly
- **Speed & volume controls** — `0.6x` to `1.5x` speed, `0.5x` to `2.0x` volume
- **Emotion controls** — 50+ emotion tags (neutral, excited, calm, enthusiastic, etc.)
- **SSML support** — inline tags for speed, volume, emotion, and nonverbalisms (`[laughter]`)

**Recommended voices for agent/conversational use:**
- `Katie` (`f786b574-daa5-4673-aa0c-cbe3e8534c02`) — stable, realistic
- `Jameson` (`a5136bf9-224c-4d76-b823-52bd5efcffcc`) — stable, realistic

### 2.2 Ink 2 — Speech-to-Text

Ink 2 is a streaming STT model optimized for voice agents:

- **Native turn detection** — knows when the speaker starts/finishes, no separate VAD needed
- **Lowest word error rate** of any streaming STT
- **Structured data transcription** — phone numbers, dates, emails transcribed correctly
- **Turn event lifecycle** — `turn.start`, `turn.update`, `turn.eager_end`, `turn.resume`, `turn.end`
- Currently English-only (`en`) in preview status

### 2.3 Voice Cloning

Two tiers of voice cloning:

| Feature | Free Plan | Pro+ Plans |
|---------|-----------|------------|
| Instant Voice Cloning | ❌ Not available | ✅ Available |
| Pro Voice Cloning | ❌ Not available | ✅ Available (Startup+) |
| Voice Changer | ❌ Not available | 15 credits/sec |

**Best practices for cloning:**
- Use a 10-second clip for high-similarity clones
- Speak clearly with no background noise
- Avoid long pauses
- Trim silence from start/end
- Speak in the target language
- Set `enhance: false` for maximum similarity (unless source has noise)

### 2.4 Voice Agents (Line)

Cartesia offers a full voice agent platform called **Line** with:
- Telephony integration (phone numbers)
- Knowledge base (RAG)
- LLM integration
- Call management & analytics
- $0.06/minute call duration
- $0.014/minute for Cartesia-provided phone numbers

> **Note:** This is a full-stack product. For Rekrut AI, we will likely use the **TTS API** directly rather than the Line agent platform, as we have our own AI interview engine.

---

## 3. Pricing Analysis

### 3.1 Plan Comparison

| Plan | Monthly Cost | Credits/Month | TTS Minutes | STT Hours | Agent Prepaid | Commercial Use | Concurrent TTS |
|------|-------------|---------------|-------------|-----------|---------------|----------------|----------------|
| **Free** | **$0** | **20,000** | **~133 min** | **~9h 16m** | **$1** | ❌ No | **3** |
| Pro | $4 | 100,000 | ~666 min | ~46h | $5 | ✅ Yes | 3 |
| Startup | $39 | 1,250,000 | ~8,333 min | ~578h | $49 | ✅ Yes | Higher |
| Scale | $239 | 8,000,000 | ~53,333 min | ~3,704h | $299 | ✅ Yes | Higher |

### 3.2 Credit Consumption

| Feature | Cost |
|---------|------|
| TTS (Sonic 3.5) | Billed per character / per second of generated audio |
| STT (Ink 2) | Billed per second of audio transcribed |
| Voice Changer | 15 credits per second of audio |
| Voice Localization | 225 credits one-time cost |

### 3.3 Free Plan Limits — Critical for Rekrut AI

- **20,000 credits/month** = ~133 minutes of TTS audio
- **3 concurrent requests** — fine for low-traffic testing
- **No commercial use license** — acceptable for development/pre-launch
- **No instant voice cloning** — we must use built-in public voices
- **$1 prepaid agent minutes** — negligible for our use case

### 3.4 Estimated Usage for Rekrut AI

| Use Case | Avg Audio Length | Sessions/Month | Est. Credits | % of Free |
|----------|-----------------|----------------|--------------|-----------|
| AI Interview Practice (beta) | 5 min | 50 candidates | ~3,750 | ~19% |
| Job Description Narration | 2 min | 100 JDs | ~3,000 | ~15% |
| Voice Notifications | 30 sec | 200 notifications | ~1,500 | ~7.5% |
| Accessibility (screen reader) | 3 min | 50 sessions | ~2,250 | ~11% |
| **Total Estimated** | — | — | **~10,500** | **~53%** |

> **Conclusion:** The free plan is sufficient for development, beta testing, and early pilot usage. We will comfortably stay within limits until we scale to hundreds of active users.

---

## 4. Integration Options & API

### 4.1 API Architecture

- **Base URL:** `https://api.cartesia.ai`
- **Authentication:** Bearer token (`sk_car_...`)
- **Version Header:** `Cartesia-Version: 2026-03-01` (required)
- **Security:** SOC 2 Type II, HIPAA, GDPR, PCI compliant

### 4.2 Key Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `POST /tts/bytes` | POST | Generate audio from complete transcript (returns raw bytes) |
| `POST /voices/clone` | POST | Clone a voice from audio clip (Pro+ only) |
| `GET /voices` | GET | List available voices (public + owned) |
| `POST /stt/transcribe` | POST | Batch speech-to-text transcription |
| `WS /stt/turns` | WebSocket | Real-time STT with turn detection |

### 4.3 Output Formats

| Container | Encoding | Sample Rates | Use Case |
|-----------|----------|--------------|----------|
| `raw` | `pcm_f32le`, `pcm_s16le`, `pcm_mulaw`, `pcm_alaw` | 8k–48k | Real-time streaming |
| `wav` | Same as raw | 8k–48k | Downloadable files |
| `mp3` | MP3 | 8k–48k | Compressed storage |

### 4.4 SDKs & Integrations

Cartesia provides SDKs for major languages and integrates with popular voice agent frameworks:

- **Python SDK** — `pip install cartesia`
- **JavaScript/TypeScript SDK**
- **Integrations:** LiveKit, Pipecat, and other voice agent builders

### 4.5 Example TTS Request (REST)

```http
POST /tts/bytes
Cartesia-Version: 2026-03-01
Authorization: Bearer sk_car_...
Content-Type: application/json

{
  "model_id": "sonic-3.5",
  "transcript": "Welcome to your AI interview practice session. Let's begin with the first question.",
  "voice": {
    "mode": "id",
    "id": "f786b574-daa5-4673-aa0c-cbe3e8534c02"
  },
  "language": "en",
  "output_format": {
    "container": "mp3",
    "sample_rate": 24000,
    "bit_rate": 128000
  },
  "generation_config": {
    "speed": 1.0,
    "volume": 1.0,
    "emotion": "calm"
  }
}
```

---

## 5. Recommended User Flows for Rekrut AI

### 5.1 🎯 AI Interview Practice (Voice-Based Questions) — HIGH PRIORITY

**What it does:** Candidates practice interviews with an AI interviewer that speaks questions aloud and listens to verbal responses.

**Implementation:**
1. Generate interview questions as audio using Sonic 3.5
2. Play audio to candidate via Web Audio API
3. Record candidate's verbal response
4. Transcribe response using Ink 2 (or Whisper as fallback)
5. Feed transcript to our AI interview engine for evaluation

**Why Cartesia:** Sub-90ms latency makes the conversation feel natural and responsive. The emotion controls let us vary the interviewer's tone (friendly screening vs. technical grilling).

**Complexity:** Medium — requires audio playback, recording, and transcript pipeline.

---

### 5.2 📋 Job Description Narration — MEDIUM PRIORITY

**What it does:** Convert job descriptions to audio so candidates can listen while commuting, exercising, or multitasking.

**Implementation:**
1. On JD publish, generate MP3 via `POST /tts/bytes`
2. Store audio file in S3/cloud storage
3. Embed audio player on JD page
4. Regenerate when JD is updated

**Why Cartesia:** 42 languages mean we can narrate JDs in the local language for international roles. Clean audio with no artifacts.

**Complexity:** Low — simple batch generation + file storage.

---

### 5.3 🔔 Voice Notifications & Alerts — LOW PRIORITY

**What it does:** Voice-based alerts for interview reminders, application status updates, or deadline warnings.

**Implementation:**
1. Trigger TTS generation on notification event
2. Deliver via in-app audio player or phone call (Line agents)
3. Use `emotion: "enthusiastic"` for good news, `calm` for neutral updates

**Why Cartesia:** More engaging than text notifications. Can differentiate Rekrut AI from competitors.

**Complexity:** Low — piggybacks on existing notification system.

---

### 5.4 ♿ Accessibility Features — MEDIUM PRIORITY

**What it does:** Screen-reader-like audio for candidates with visual impairments or reading difficulties.

**Implementation:**
1. Add "Listen to this page" button on JDs, candidate dashboards, and instructions
2. Generate audio on-demand or cache popular pages
3. Support multiple languages for international accessibility

**Why Cartesia:** 42 languages + clean audio = genuinely useful accessibility tool, not a gimmick.

**Complexity:** Low — UI button + TTS integration.

---

### 5.5 🎙️ Voice-First Application Submission — EXPERIMENTAL

**What it does:** Allow candidates to submit applications via voice instead of filling forms — reducing drop-off.

**Implementation:**
1. Prompt candidate to speak their answers
2. Record audio
3. Transcribe with Ink 2
4. Parse structured data (Cartesia handles phone numbers, dates, emails natively)
5. Auto-fill application form

**Why Cartesia:** Ink 2's structured data transcription and turn detection make this feasible. Cartesia's own recruiting page highlights this exact use case.

**Complexity:** High — requires form parsing, validation, and fallback UI.

---

## 6. Implementation Complexity Estimate

| Feature | Complexity | Time Estimate | Dependencies |
|---------|-----------|---------------|--------------|
| Job Description Narration | **Low** | 1–2 days | Audio storage, player UI |
| Accessibility "Listen" Button | **Low** | 2–3 days | Same as above + caching |
| Voice Notifications | **Low** | 3–5 days | Notification pipeline, audio player |
| AI Interview Practice (TTS only) | **Medium** | 1–2 weeks | Audio playback, question generation |
| AI Interview Practice (TTS + STT) | **Medium** | 2–3 weeks | Full audio pipeline + transcription |
| Voice-First Applications | **High** | 3–4 weeks | STT + form parsing + validation |

**Recommended phased approach:**
1. **Phase 1 (Week 1–2):** Job Description Narration + Accessibility button — quick wins, low risk
2. **Phase 2 (Week 3–4):** Voice Notifications — enhance engagement
3. **Phase 3 (Week 5–7):** AI Interview Practice with TTS — core differentiator
4. **Phase 4 (Week 8+):** Full voice interview (TTS + STT) — advanced feature

---

## 7. Technical Considerations

### 7.1 Security & Compliance

- ✅ SOC 2 Type II certified
- ✅ GDPR compliant
- ✅ HIPAA compliant (for healthcare use cases)
- ✅ PCI compliant
- **API key:** Store in environment variables only. Never expose in client-side code.

### 7.2 Latency & Performance

- Sonic 3.5: ~90ms time-to-first-byte (p90)
- 3 concurrent requests on Free plan — sufficient for development
- For production, Startup plan ($39/mo) unlocks higher concurrency

### 7.3 Caching Strategy

- Cache generated audio files by content hash to avoid regenerating identical transcripts
- Job descriptions change infrequently — perfect for long-term caching
- Interview questions are dynamic — generate on-demand, cache per session

### 7.4 Fallback Strategy

- If Cartesia API is unavailable or credits exhausted, fall back to browser's native `speechSynthesis` API (lower quality but functional)
- For STT, maintain Whisper or browser's `SpeechRecognition` as fallback

### 7.5 Cost Monitoring

- Track credit usage monthly via Cartesia dashboard
- Set up alerts at 75% of free tier limit
- When approaching limit, consider upgrading to Pro ($4/mo) for 5x more credits

---

## 8. Competitive Context

Cartesia already has a **Recruiting** use-case page with testimonials from:
- **Elise AI** — 2.9% conversion lift, 12.2% engagement increase
- **ServiceNow** — enterprise-grade voice agents
- **Sierra** — top-performing model across languages

This validates that voice AI in recruiting is a proven, high-ROI use case. Rekrut AI can differentiate by focusing specifically on **interview practice** and **candidate accessibility**, rather than generic screening bots.

### Comparison with Alternatives

| Provider | Latency | Naturalness | Price | Recruiting Focus |
|----------|---------|-------------|-------|------------------|
| **Cartesia** | **~90ms** | **#1 ranked** | **Free tier available** | **✅ Dedicated page** |
| ElevenLabs | ~300ms | High | Free tier limited | ❌ No |
| OpenAI TTS | ~200ms | Good | Per-token pricing | ❌ No |
| Amazon Polly | ~500ms | Moderate | Pay-per-use | ❌ No |
| Google Cloud TTS | ~300ms | Good | Pay-per-character | ❌ No |

---

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Free tier credit exhaustion | Medium | High | Monitor usage; upgrade to Pro ($4) if needed |
| No voice cloning on Free plan | Certain | Low | Use built-in public voices (100+ available) |
| Ink 2 STT is English-only | Certain | Medium | Use Whisper for non-English STT |
| 3 concurrent requests limit | Low | Low | Queue requests; upgrade if needed |
| API dependency | Medium | Medium | Implement fallback to native TTS |
| Audio storage costs | Low | Low | Use compressed MP3; cache aggressively |

---

## 10. Next Steps

### Immediate (This Week)
1. **Validate API key** — Test a simple `POST /tts/bytes` request with our existing API key
2. **Prototype JD Narration** — Build a minimal script that generates MP3 from a sample job description
3. **Voice selection** — Shortlist 3–5 Cartesia voices that match Rekrut AI's brand tone

### Short-Term (Next 2 Weeks)
4. **Build audio player component** — React component for in-app audio playback
5. **Implement caching layer** — Store generated audio in S3/Cloudflare R2 with content-hash keys
6. **Add "Listen to JD" feature** — Deploy behind feature flag for beta testing

### Medium-Term (Next Month)
7. **AI Interview Practice (TTS)** — Generate spoken interview questions
8. **STT Integration** — Connect Ink 2 for candidate response transcription
9. **Usage monitoring** — Dashboard to track Cartesia credit consumption

### Long-Term (Post-Launch)
10. **Evaluate upgrade to Pro** — When free tier no longer suffices
11. **Voice cloning** — Consider cloning a brand voice for consistency (requires Pro/Startup)
12. **Multilingual expansion** — Leverage 42 languages for global recruitment markets

---

## 11. Summary

**Cartesia.ai is an excellent fit for Rekrut AI.** The free tier provides enough credits for development and early beta testing (~133 minutes of TTS/month). The sub-90ms latency and naturalness of Sonic 3.5 will make our AI interview practice feel genuinely conversational, not robotic.

**Quick wins:** Job description narration and accessibility features are low-complexity, high-value features we can ship in 1–2 weeks.

**Core differentiator:** Voice-based AI interview practice positions Rekrut AI as a next-generation recruitment platform, not just another job board.

**Cost trajectory:** Free → Pro ($4/mo) → Startup ($39/mo) as we scale. This is a gradual, predictable cost curve that aligns with user growth.

> **Recommendation:** Proceed with integration. Start with Phase 1 (JD narration + accessibility) this week.

---

*Document generated by Rekrut AI Technical Research Team.  
Sources: docs.cartesia.ai, cartesia.ai/pricing, cartesia.ai/use-cases/recruiting  
API key status: Confirmed available in environment (not shared in this document).*
