# How to Obtain AI API Keys for Rekrut AI

This guide walks you through getting the necessary API keys for the AI features to work.

---

## 🚨 Security Warning
**NEVER commit your real API keys to GitHub.** The `.env` file is already in `.gitignore`.
Only commit `.env.example` (the template without real keys).

---

## Required Keys (Minimum)

To use AI features, you need **at minimum**:
1. **POLSIA_API_KEY** (Primary AI provider)
2. **DATABASE_URL** (PostgreSQL connection)

---

## Step-by-Step Guide

### 1. Polsia API Key (PRIMARY - Required)
**Purpose:** Primary AI provider for all LLM calls

**How to obtain:**
1. Visit https://polsia.com
2. Create an account or log in
3. Navigate to API section in your dashboard
4. Generate a new API key
5. Copy the key and set: `POLSIA_API_KEY=your_key_here`

**Fallback behavior without it:** System tries NVIDIA NIM → Groq → Cerebras

---

### 2. OpenAI API Key (Recommended)
**Purpose:** Fallback for LLM, TTS, ASR, embeddings

**How to obtain:**
1. Go to https://platform.openai.com
2. Sign up/Log in
3. Go to "API Keys" in the left sidebar
4. Click "Create new secret key"
5. Copy immediately (you can't see it again!)
6. Set: `OPENAI_API_KEY=sk-...`

**Cost:** Pay-as-you-go, ~$0.002-0.03 per 1K tokens

---

### 3. NVIDIA NIM API Key (Recommended)
**Purpose:** Fallback for LLM, vision, embeddings, TTS, ASR

**How to obtain:**
1. Visit https://build.nvidia.com/explore
2. Sign up/Log in with NVIDIA account
3. Click "Get API Key" on any model page
4. Generate your key
5. Set: `NVIDIA_NIM_API_KEY=nvapi-...`

**Cost:** Free tier available (10K requests/month), then pay-as-you-go

---

### 4. Groq API Key (Optional - Fast)
**Purpose:** Ultra-fast inference fallback

**How to obtain:**
1. Go to https://console.groq.com
2. Sign up with email/Google
3. Navigate to "API Keys"
4. Create new key
5. Set: `GROQ_API_KEY=gsk_...`

**Cost:** Generous free tier (up to 1M tokens/day)

---

### 5. Deepgram API Key (Required for Voice)
**Purpose:** Text-to-speech and speech-to-text

**How to obtain:**
1. Visit https://console.deepgram.com
2. Sign up (get $200 free credit)
3. Go to "Projects" → "Settings" → "API Keys"
4. Copy the key
5. Set: `DEEPGRAM_API_KEY=...`

**Cost:** $200 free credit, then ~$0.004-0.015 per minute

---

### 6. Cerebras API Key (Optional - Enterprise)
**Purpose:** Final fallback for high-performance inference

**How to obtain:**
1. Contact https://cerebras.ai for enterprise access
2. Not recommended for startups (expensive)

---

## Setup Instructions

1. **Copy the template:**
   ```bash
   cd rekrut-ai-dest
   cp .env.example .env
   ```

2. **Edit .env with your keys:**
   ```bash
   nano .env  # or use your preferred editor
   ```

3. **Never commit the real .env:**
   ```bash
   # This is already in .gitignore, but verify:
   cat .gitignore | grep .env
   ```

4. **Test the connection:**
   ```bash
   npm install
   npm start
   # Check console for: "[ai-provider] Initialized..."
   ```

---

## Cost Estimates (Monthly)

| Provider | Light Usage | Medium Usage | Heavy Usage |
|----------|-------------|--------------|-------------|
| Polsia | ? | ? | ? |
| OpenAI | $5-10 | $20-50 | $100+ |
| NVIDIA NIM | Free | $10-30 | $50+ |
| Groq | Free | Free | $20+ |
| Deepgram | Free ($200 credit) | $10-30 | $50+ |

---

## Troubleshooting

**"All providers failed" error:**
- Check that at least one API key is set correctly
- Verify keys don't have extra spaces
- Test individual provider health at `/api/ai-health`

**Rate limiting:**
- The system auto-falls back to other providers
- Add more API keys for better resilience

**Geo-blocking:**
- Some providers block certain regions
- The system detects this and circuit-breaks them for 30 min
- Use providers available in your region

---

## Free Tier Priority
If you want to minimize costs, use this priority:
1. **Groq** - 1M tokens/day free
2. **NVIDIA NIM** - 10K requests/month free
3. **Deepgram** - $200 credit
4. **OpenAI** - Pay-as-you-go (set spending limits!)

---

**Questions?** Check the `/api/ai-health` endpoint after starting the server for provider status.
