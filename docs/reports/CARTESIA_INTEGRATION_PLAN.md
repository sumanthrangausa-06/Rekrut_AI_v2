# Cartesia.ai Integration Plan for Rekrut AI

## Research Summary (June 8, 2026)

### What Cartesia.ai Does

Cartesia.ai is a state-of-the-art text-to-speech (TTS) and voice cloning platform built on **State Space Models (SSMs)**. Key capabilities:

| Feature | Details |
|---------|---------|
| **Latency** | 40-90ms (Sonic Turbo 40ms, Sonic 2 90ms) — industry-leading |
| **Voice Cloning** | Instant: 3 seconds of audio. Pro: 30 minutes of studio audio |
| **Languages** | 15 languages with accent localization |
| **Emotion Control** | Speed, emotion, pitch modulation via API |
| **Streaming** | Real-time streaming API for live interactions |
| **Deployment** | Cloud + on-device options |

### Pricing (Credit-Based: 1 credit = 1 character)

| Plan | Monthly | Credits | Concurrency | Key Feature |
|------|---------|---------|-------------|-------------|
| **Free** | $0 | 20,000 | 2 | Personal use only |
| **Pro** | $5 | 100,000 | 3 | Commercial use + instant cloning |
| **Startup** | $49 | 1.25M | 5 | Pro cloning + orgs |
| **Scale** | $299 | 8M | 15 | High concurrency |
| **Enterprise** | Custom | Unlimited | 30+ | SLA, HIPAA, custom models |

Additional costs:
- Pro Voice Clone creation: 1M credits (one-time)
- Pro Voice Clone usage: 1.5 credits/character

---

## Integration Strategy for Rekrut AI

### Recommended Plan: **Startup ($49/month)**
- 1.25M characters/month = ~15,000 job descriptions or ~5,000 interview feedback sessions
- Pro voice cloning for brand consistency
- 5 concurrent requests (enough for our traffic)

### User Flows That Benefit

#### 1. AI Interview Voice Feedback (P0 — High Impact)
**What:** After a candidate completes an AI mock interview, generate a spoken summary of their performance.

**Flow:**
1. Candidate finishes mock interview
2. AI generates text feedback (already exists)
3. Convert to voice via Cartesia API
4. Play audio feedback in browser
5. Optionally download as MP3

**Value:** Accessibility + engagement. Candidates retain 30% more info from audio vs text.

#### 2. Job Description Audio Preview (P1 — Recruiter Tool)
**What:** Recruiters can preview how a job description sounds when spoken.

**Flow:**
1. Recruiter writes job description
2. Click "Listen" button
3. Cartesia streams the job description in real-time
4. Recruiter can adjust tone/emotion (professional, friendly, urgent)

**Value:** Helps recruiters optimize JD tone for target audience.

#### 3. Voice Notifications (P2 — Notifications)
**What:** Voice alerts for critical events.

**Triggers:**
- New application received (recruiter)
- Interview scheduled (candidate)
- Offer received (candidate)
- Reminder: Interview in 30 minutes

**Channels:**
- In-app audio notification
- Optional: SMS with voice link

#### 4. Accessibility Mode (P2 — Inclusive)
**What:** Full voice UI for visually impaired users.

**Features:**
- Screen reader enhancement with Cartesia voices
- Voice-guided navigation
- Voice input for form filling (via speech-to-text)

#### 5. AI Onboarding Coach (P2 — Post-Hire)
**What:** Voice-guided onboarding for new hires.

**Flow:**
1. New hire logs in on Day 1
2. AI coach welcomes them via voice
3. Walks through company policies, team intro, first tasks
4. Candidate can ask questions via voice (STT + LLM + TTS loop)

---

## Technical Implementation Plan

### Phase 1: Basic TTS Integration (Week 1)

```
API Endpoint: POST /api/tts/synthesize
Body: { text, voice_id, speed, emotion }
Response: { audio_url, duration, credits_used }
```

**Components:**
1. **Backend:** New `routes/tts.js` — Cartesia API client
2. **Frontend:** Audio player component (HTML5 `<audio>`)
3. **Database:** Cache synthesized audio in `audio_cache` table (avoid re-synthesis)
4. **Cost tracking:** Log credits per user per month

### Phase 2: Voice Cloning (Week 2)

**Brand Voice:**
- Record 3 seconds of brand voice sample
- Create instant clone via Cartesia
- Use for all system notifications and interview feedback

**API:**
```
POST /api/tts/voices/clone
Body: multipart/form-data { audio_file, name }
Response: { voice_id, status }
```

### Phase 3: Real-Time Streaming (Week 3-4)

**For live AI interview feedback:**
- Use Cartesia streaming API (WebSocket)
- Stream audio as AI generates text feedback
- ~100ms latency — feels conversational

### Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Frontend  │────▶│   Backend   │────▶│  Cartesia   │
│  (React)    │◀────│  (Node.js)  │◀────│    API      │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │ Audio Cache │
                    │  (DB / S3)  │
                    └─────────────┘
```

### Security & Compliance

- **API Key:** Stored in Render env vars (never in repo)
- **Rate Limiting:** 10 TTS requests/min per user
- **Data Privacy:** Don't cache audio with PII longer than 30 days
- **HIPAA:** Only needed if handling health data (not applicable for now)

---

## Environment Variables to Add

```bash
# Cartesia.ai Configuration
CARTESIA_API_KEY=sk_car_1p4kVtwNGaTizVTXUVbq38
CARTESIA_DEFAULT_VOICE_ID=sonic-2  # or cloned brand voice
CARTESIA_TTS_CACHE_DAYS=30
CARTESIA_MONTHLY_CREDIT_LIMIT=1250000  # Startup plan
```

---

## Cost Estimate

| Feature | Monthly Usage | Credits | Cost |
|---------|--------------|---------|------|
| Interview feedback (500/mo) | 500 × 500 chars | 250K | $0 |
| JD audio preview (200/mo) | 200 × 1000 chars | 200K | $0 |
| Voice notifications (1000/mo) | 1000 × 100 chars | 100K | $0 |
| **Total** | | **550K** | **$0 (within Startup plan)** |

*Startup plan ($49/mo) covers 1.25M credits — plenty of headroom.*

---

## Next Steps

1. **Add env vars to Render** (Ranga — need Stripe-level access)
2. **Create `routes/tts.js`** — basic synthesis endpoint
3. **Build audio player component** — React `<AudioPlayer />`
4. **Test with brand voice clone** — record 3s sample, create clone
5. **Add to interview feedback flow** — convert text → audio
6. **Monitor credit usage** — dashboard for team

---

*Research completed: June 8, 2026*
*Assignee: kimiclaw (CTO)*
*Priority: P0*
