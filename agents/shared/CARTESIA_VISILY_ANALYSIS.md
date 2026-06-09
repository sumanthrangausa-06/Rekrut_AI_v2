# Cartesia.ai + Visily Feature Analysis — Rekrut AI

> **Date:** 2026-06-09
> **Agent:** Suga (CEO)
> **Scope:** Cartesia.ai voice AI integration + Visily feature gap analysis

---

## 1. Cartesia.ai Platform Overview

**What it is:** Cartesia.ai is the fastest, most emotive, ultra-realistic voice AI platform. Purpose-built for developers, it serves state-of-the-art models for both text-to-speech and speech-to-text, enabling seamless conversational AI experiences.

**Key Products:**

### 1.1 Sonic 3.5 (Text-to-Speech)
- **World's fastest, most emotive TTS** — sub-90ms first-byte latency
- **42 languages out of the box** — English, Hindi, Spanish, French, German, Japanese, Hebrew, and 35 more
- **Voice cloning** — clone any voice with full control over pronunciation and accent
- **Expressive, conversational delivery** — strong pacing and emotional range, tuned for real conversations
- **Clean audio** — no artifacts across all languages and voices
- **Context-aware pronunciation** — heteronyms like "read", "bass", "bow" land correctly
- **Alphanumerics that sound right** — order numbers, phone numbers, IDs, emails spoken naturally

### 1.2 Ink 2 (Speech-to-Text)
- **World's fastest, most accurate streaming STT** — lowest word error rate
- **Native turn detection** — built-in VAD, knows when user starts/stops speaking
- **Transcribes structured data** — phone numbers, dates, emails correctly the first time
- **Turn events lifecycle** — `turn.start`, `turn.update`, `turn.eager_end`, `turn.resume`, `turn.end`
- **No separate VAD required** — turn detection is built-in

### 1.3 Line (Voice Agents Platform)
- Platform for building and shipping enterprise voice agents
- Integrates Sonic + Ink for full conversational AI
- Enterprise-grade from the ground up

**Pricing:** Freemium model available (free tier for testing, paid for production scale)

---

## 2. How Cartesia.ai Makes Rekrut AI Better

### 2.1 Voice-Based AI Interviews (HIGH IMPACT)
**Current:** We have `mock-interview.tsx`, `video-interview.tsx`, `interview-practice.tsx` — all text-based or video recording.

**With Cartesia:**
- **Real-time voice AI interviewer** — candidate speaks, AI listens (Ink STT), thinks, responds with natural voice (Sonic TTS)
- **42 languages** — perfect for India market (Hindi, Telugu, Bengali, Tamil, Gujarati, Kannada, Malayalam, Marathi, Punjabi)
- **Sub-90ms latency** — feels like a real conversation, not a robot
- **Voice cloning** — we can clone the recruiter's voice so candidates hear the actual hiring manager
- **Turn detection** — AI knows when candidate finishes speaking, no awkward overlaps

**Implementation:**
- Frontend: WebRTC or WebSocket for audio streaming
- Backend: Cartesia WebSocket API for real-time TTS + STT
- Integration: `services/interview-ai.js` already exists — extend with Cartesia voice pipeline

### 2.2 Voice Screening (Phone Screening with AI) — HIGH IMPACT
**Current:** `screening.tsx` — text-based screening questionnaire.

**With Cartesia:**
- **AI phone screener** — calls candidates, asks questions, listens to answers, scores responses
- **Natural conversation flow** — candidate can interrupt, ask questions, clarify
- **Automatic transcription** — full transcript saved to candidate profile
- **Sentiment analysis** — detect enthusiasm, confidence, communication skills
- **Multi-language** — screen candidates in their native language

**Implementation:**
- New route: `server/routes/voice-screening.ts`
- New component: `candidate/voice-screening.tsx`
- Integration with existing `screening.tsx` data model

### 2.3 Voice Chat with Recruiters — MEDIUM IMPACT
**Current:** `chat.tsx` — text-based chat (candidate and recruiter both have minimal chat pages).

**With Cartesia:**
- **Voice messaging** — send voice notes in chat, auto-transcribed
- **Real-time voice calls** — click-to-call with AI moderation/translation
- **Language translation** — recruiter speaks English, candidate hears Hindi, vice versa
- **Call recording + transcription** — auto-saved to application history

**Implementation:**
- Extend existing chat system with voice messages
- Add WebRTC for real-time calls
- Cartesia for TTS/STT during calls

### 2.4 Listen-to-Job Descriptions — LOW IMPACT
**Current:** Job descriptions are text-only.

**With Cartesia:**
- **Audio job descriptions** — click "Listen" to hear the job description in natural voice
- **Multiple languages** — job description in English, Hindi, Telugu, etc.
- **Accessibility** — helps visually impaired candidates

**Implementation:**
- Generate audio on-demand via Cartesia API
- Cache audio files in storage
- Add "Listen" button to `job-detail.tsx`

### 2.5 Voice Notifications — LOW IMPACT
- **Voice calls for interview reminders** — "Hi, this is Rekrut AI. Your interview with Acme Corp is in 30 minutes."
- **Voice OTP/verification** — phone verification via voice call instead of SMS
- **Status update calls** — "Your application has been moved to the next round."

---

## 3. Visily Feature Gap Analysis

Based on the Visily mockups downloaded, here's what's built vs. what's missing:

### 3.1 BUILT ✅ (Already in the app)

| Feature | File | Status |
|---------|------|--------|
| Landing page | `landing.tsx` | ✅ Built |
| Job listings | `candidate/jobs.tsx` | ✅ Built |
| Job detail | `candidate/job-detail.tsx` | ✅ Built |
| Candidate profile | `candidate/profile.tsx` | ✅ Built |
| Company profile | `candidate/company-profile.tsx` | ✅ Built |
| Recruiter dashboard | `recruiter/dashboard.tsx` | ✅ Built |
| Candidate search | `recruiter/candidates.tsx` | ✅ Built |
| Applications tracking | `candidate/applications.tsx` | ✅ Built |
| Recruiter applications | `recruiter/applications.tsx` | ✅ Built |
| AI interview practice | `candidate/mock-interview.tsx` | ✅ Built |
| Video interview | `candidate/video-interview.tsx` | ✅ Built |
| Interview analysis | `candidate/interview-analysis.tsx` | ✅ Built |
| Assessments | `candidate/assessments.tsx`, `candidate/assessment-take.tsx` | ✅ Built |
| Recruiter assessments | `recruiter/assessments.tsx`, `recruiter/job-assessment.tsx` | ✅ Built |
| Job creation | `recruiter/job-form.tsx` | ✅ Built |
| Job applicants | `recruiter/job-applicants.tsx` | ✅ Built |
| Offers | `candidate/offers.tsx`, `recruiter/offers.tsx` | ✅ Built |
| Onboarding | `candidate/onboarding.tsx`, `recruiter/onboarding.tsx` | ✅ Built |
| TrustScore | `recruiter/trustscore.tsx`, `recruiter-communications.tsx` | ✅ Built |
| Communications | `recruiter/communications.tsx` | ✅ Built |
| Public company page | `recruiter/public-company.tsx` | ✅ Built |
| Career page | `recruiter/career-page.tsx` | ✅ Built |
| Recruiter analytics | `recruiter/analytics.tsx` | ✅ Built |
| Admin dashboard | `admin/dashboard.tsx` | ✅ Built |
| Admin AI health | `admin/ai-health.tsx` | ✅ Built |
| Admin analytics | `admin/analytics.tsx` | ✅ Built |
| Admin compliance | `admin/compliance.tsx` | ✅ Built |
| Admin revenue | `admin/revenue.tsx` | ✅ Built |
| Settings | `settings.tsx` | ✅ Built |
| Login/Register | `login.tsx`, `register.tsx` | ✅ Built |
| Pricing | `pricing.tsx` | ✅ Built |
| About | `about.tsx` | ✅ Built |
| Blog | `blog.tsx` | ✅ Built |
| Contact | `contact.tsx` | ✅ Built |
| Privacy/Terms | `privacy.tsx`, `terms.tsx` | ✅ Built |
| Post-hire feedback | `candidate/post-hire-feedback.tsx` | ✅ Built |
| AI coaching | `candidate/ai-coaching.tsx`, `candidate/ai-coaching-progress.tsx` | ✅ Built |
| Documents | `candidate/documents.tsx` | ✅ Built |
| History | `candidate/history.tsx` | ✅ Built |
| Payroll | `candidate/payroll.tsx`, `recruiter/payroll.tsx` | ✅ Built |
| Omniscore | `candidate/omniscore.tsx`, `recruiter/omniscore.tsx` | ✅ Built |
| EU AI Act compliance | `admin/compliance.tsx` | ✅ Built |
| Agent dashboard | `admin/agent-dashboard.tsx`, `admin/agents.tsx` | ✅ Built |

### 3.2 MISSING ❌ (Not yet built — from Visily mockups)

| Feature | Priority | Description | Complexity |
|---------|----------|-------------|------------|
| **Profile Analytics** | HIGH | Profile views, impressions, searches, viewer analytics | Medium |
| **Skills with Endorsements** | HIGH | Skills section with endorsements from connections | Medium |
| **Work Experience Timeline** | HIGH | Visual timeline of work history with companies, dates, descriptions | Low |
| **Education Section** | HIGH | Schools, degrees, dates, field of study | Low |
| **Connections/Network** | MEDIUM | Connection requests, mutual connections, network size | Medium |
| **Direct Messaging** | HIGH | Real-time chat between candidates and recruiters | High |
| **File Sharing in Chat** | MEDIUM | Share PDFs, images, documents in chat | Medium |
| **Audio/Video Calls** | HIGH | Real-time voice/video calls between candidates and recruiters | High |
| **Video Conferencing** | MEDIUM | Multi-participant video meetings with screen sharing | Very High |
| **In-Meeting Chat** | LOW | Chat during video calls | Medium |
| **Screen Sharing** | MEDIUM | Share screen during video calls | High |
| **Meeting Recording** | LOW | Record video calls with transcript | High |
| **Advanced Search Filters** | MEDIUM | Filter by location, experience, industry, company type | Medium |
| **"Open to Work" Badge** | LOW | Badge on profile indicating availability | Low |
| **Company Verification (Multi-step)** | HIGH | Multi-step business verification wizard with ID upload | Medium |
| **ID Document Upload** | MEDIUM | Upload front/back of ID for KYC | Medium |
| **Business Information Form** | MEDIUM | Company name, type, address, phone, email, owner info | Low |
| **Promotional Banners** | LOW | Promotional sidebar on search results | Low |
| **Newsletter Subscription** | LOW | Subscribe to newsletter in footer | Low |
| **Language Selector** | LOW | Change language in footer | Low |
| **Social Media Links** | LOW | Follow social media links in footer | Low |
| **Blog/Articles** | LOW | Blog section with articles, authors, dates | Medium |
| **Call History** | LOW | Audio/video call history in chat | Medium |
| **Online/Presence Status** | MEDIUM | Online/offline indicator in chat | Low |
| **Unread Message Indicators** | MEDIUM | Unread badge on conversation list | Low |
| **Message Search** | LOW | Search through conversation history | Medium |
| **Emoji/Rich Text Input** | LOW | Emoji picker, rich text formatting in chat | Low |
| **Pagination** | LOW | Pagination on candidate/job search results | Low |
| **Breadcrumbs** | LOW | Breadcrumb navigation | Low |
| **Footer Navigation** | LOW | Full footer with multiple columns | Low |
| **Hero Video/Play Button** | LOW | Video play button on landing page | Low |

---

## 4. Recommended Priority Order

### Phase 1: Must-Have for Launch (Week 1-2)
1. **Work Experience Timeline** — Low complexity, high impact for profile
2. **Education Section** — Low complexity, standard profile feature
3. **Skills with Endorsements** — Medium complexity, differentiator
4. **Direct Messaging** — High complexity, but essential for recruiter-candidate communication
5. **Profile Analytics** — Medium complexity, shows platform activity

### Phase 2: Differentiators (Week 3-4)
6. **Company Verification (Multi-step)** — Multi-step wizard for business verification
7. **ID Document Upload** — KYC for company verification
8. **"Open to Work" Badge** — Simple but effective
9. **Advanced Search Filters** — Filter by location, experience, industry
10. **Cartesia Voice AI Integration** — Voice-based interviews and screening

### Phase 3: Nice-to-Have (Post-Launch)
11. **Audio/Video Calls** — Real-time communication
12. **Video Conferencing** — Multi-participant meetings
13. **File Sharing in Chat** — PDF sharing, document collaboration
14. **Blog/Articles** — Content marketing
15. **Newsletter Subscription** — Lead generation

---

## 5. Cartesia Integration Plan

### Step 1: Environment Setup (15 min)
- ✅ Store `CARTESIA_API_KEY` in `.credentials.env`
- ✅ Add to `.env` file
- ✅ Add to production env vars via Render API

### Step 2: Backend Service (2-3 hours)
- Create `services/cartesia-voice.js` — wrapper around Cartesia API
- Implement: `textToSpeech()`, `speechToText()`, `voiceClone()`, `streamAudio()`
- Add to `lib/ai-provider.js` as a new voice provider
- WebSocket handlers for real-time streaming

### Step 3: Voice Interview Feature (4-6 hours)
- Extend `candidate/mock-interview.tsx` with voice mode
- Add WebSocket for real-time audio streaming
- Cartesia Sonic for AI interviewer voice
- Cartesia Ink for candidate speech transcription
- Save transcript + audio recording to database
- Add voice analytics (confidence, clarity, sentiment)

### Step 4: Voice Screening (3-4 hours)
- New page: `candidate/voice-screening.tsx`
- AI phone screener that calls candidates
- Asks screening questions, listens to answers
- Scores responses, saves transcript
- Recruiter can review recordings + transcripts

### Step 5: Voice Chat (2-3 hours)
- Extend existing chat with voice messages
- Add voice note recording + playback
- Auto-transcribe voice messages
- Real-time voice calls (WebRTC + Cartesia)

---

## 6. Environment Variables Needed

```env
# Cartesia AI (Voice)
CARTESIA_API_KEY=sk_car_1p4kVtwNGaTizVTXUVbq38
CARTESIA_API_URL=https://api.cartesia.ai
CARTESIA_WEBSOCKET_URL=wss://api.cartesia.ai/websocket
CARTESIA_TTS_MODEL=sonic-3.5
CARTESIA_STT_MODEL=ink-2
CARTESIA_VOICE_ID=f786b574-daa5-4673-aa0c-cbe3e8534c02  # Katie (default)
```

---

## 7. Next Steps

1. **Ranga to approve:** Which Cartesia features to prioritize?
2. **Ranga to approve:** Which Visily missing features to build first?
3. **Suga to delegate:** Spawn frontend-developer for Visily features
4. **Suga to delegate:** Spawn backend-architect for Cartesia integration
5. **Suga to delegate:** Spawn ai-engineer for voice interview pipeline

**Recommendation:** Start with Phase 1 Visily features (profile timeline, education, messaging) + Cartesia voice interviews. These are the highest-impact items for the launch.

---

*Document generated by Suga, CEO of Rekrut AI*
